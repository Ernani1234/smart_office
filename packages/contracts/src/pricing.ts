import { z } from 'zod';
import type { BillingMode } from './enums';
import { MICROS_PER_USD } from './money';

// pricing.yaml — tabela de preços. Também é configuração: quando a OpenAI mudar
// preço ou lançar modelo, edita-se o arquivo, não o código.

export const ModelPriceSchema = z.object({
  tier: z.string().optional(),
  label: z.string().optional(),
  /** USD por milhão de tokens de entrada. */
  input: z.number().min(0),
  /** USD por milhão de tokens de entrada lidos do cache (padrão: 10% da entrada). */
  cachedInput: z.number().min(0).optional(),
  /** USD por milhão de tokens gravados no cache (padrão: preço da entrada). */
  cacheWrite: z.number().min(0).optional(),
  /** USD por milhão de tokens de saída (raciocínio é cobrado como saída). */
  output: z.number().min(0),
  /** No Astra, o dobro do contexto longo vale até para a entrada em cache. */
  longContextAppliesToCached: z.boolean().default(false),
  contextWindow: z.number().int().positive().optional(),
});

export const PricingSchema = z.object({
  currency: z.literal('USD'),
  checkedAt: z.string(),
  longContext: z.object({
    thresholdTokens: z.number().int().positive(),
    inputMultiplier: z.number().positive(),
    outputMultiplier: z.number().positive(),
  }),
  billingMultipliers: z.object({
    standard: z.number().positive(),
    flex: z.number().positive(),
    batch: z.number().positive(),
  }),
  models: z.record(z.string(), ModelPriceSchema),
  images: z.record(z.string(), z.object({ perImage: z.number().min(0) })).default({}),
  tools: z.object({
    webSearchPer1k: z.number().min(0),
    tavilyPerCall: z.number().min(0).default(0),
    firecrawlPerPage: z.number().min(0).default(0),
  }),
  sandbox: z.object({
    perGbPer20Min: z.number().min(0),
    defaultGb: z.number().positive(),
    sizesGb: z.record(z.string(), z.number().positive()).default({}),
  }),
});

export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export type Pricing = z.infer<typeof PricingSchema>;

export interface TokenUsage {
  inputTokens: number;
  /** Subconjunto da entrada lido do cache. */
  cachedTokens: number;
  /** Subconjunto da entrada gravado no cache. */
  cacheWriteTokens: number;
  /** Saída total, já incluindo raciocínio. */
  outputTokens: number;
  /** Subconjunto da saída gasto em raciocínio (informativo). */
  reasoningTokens: number;
  webSearchCalls: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  webSearchCalls: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    webSearchCalls: a.webSearchCalls + b.webSearchCalls,
  };
}

export class UnknownModelError extends Error {
  constructor(public readonly model: string) {
    super(`Modelo sem preço em pricing.yaml: ${model}. Dinheiro é contado por código — cadastre o preço antes de usar.`);
    this.name = 'UnknownModelError';
  }
}

export interface CostBreakdown {
  micros: number;
  longContext: boolean;
  parts: {
    uncachedInputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
    toolsUsd: number;
  };
  billingMultiplier: number;
}

/**
 * Custo exato de uma chamada de modelo, em micro-dólares.
 * - entrada sem cache, lida do cache e gravada no cache têm preços diferentes;
 * - acima de `thresholdTokens` a requisição inteira vai para a tabela de contexto
 *   longo (entrada ×2, saída ×1,5; no Astra o ×2 vale até para o cache);
 * - flex/batch aplicam o desconto sobre os tokens; ferramentas (busca) não têm desconto.
 */
export function llmCost(pricing: Pricing, model: string, usage: TokenUsage, billing: BillingMode): CostBreakdown {
  const p = pricing.models[model];
  if (!p) throw new UnknownModelError(model);
  const lc = pricing.longContext;
  const long = usage.inputTokens > lc.thresholdTokens;
  const inMul = long ? lc.inputMultiplier : 1;
  const outMul = long ? lc.outputMultiplier : 1;
  const cachedMul = long && p.longContextAppliesToCached ? lc.inputMultiplier : 1;

  const cached = Math.max(0, usage.cachedTokens);
  const written = Math.max(0, usage.cacheWriteTokens);
  const uncached = Math.max(0, usage.inputTokens - cached - written);
  const cachedPrice = p.cachedInput ?? p.input * 0.1;
  const writePrice = p.cacheWrite ?? p.input;
  const billingMultiplier = pricing.billingMultipliers[billing];

  const uncachedInputUsd = ((uncached * p.input * inMul) / 1e6) * billingMultiplier;
  const cachedInputUsd = ((cached * cachedPrice * cachedMul) / 1e6) * billingMultiplier;
  const cacheWriteUsd = ((written * writePrice * inMul) / 1e6) * billingMultiplier;
  const outputUsd = ((usage.outputTokens * p.output * outMul) / 1e6) * billingMultiplier;
  const toolsUsd = (usage.webSearchCalls * pricing.tools.webSearchPer1k) / 1000;

  const totalUsd = uncachedInputUsd + cachedInputUsd + cacheWriteUsd + outputUsd + toolsUsd;
  return {
    micros: Math.round(totalUsd * MICROS_PER_USD),
    longContext: long,
    parts: { uncachedInputUsd, cachedInputUsd, cacheWriteUsd, outputUsd, toolsUsd },
    billingMultiplier,
  };
}

/** Pior caso de uma chamada (sem cache), usado pelo guarda de orçamento antes de chamar. */
export function maxCallCostMicros(
  pricing: Pricing,
  model: string,
  estInputTokens: number,
  maxOutputTokens: number,
  billing: BillingMode,
): number {
  const usage = { ...ZERO_USAGE, inputTokens: estInputTokens, outputTokens: maxOutputTokens };
  return llmCost(pricing, model, usage, billing).micros;
}

/** Sandbox hospedada: US$ X por GB a cada sessão de 20 minutos (arredonda para cima). */
export function sandboxCostMicros(pricing: Pricing, gb: number, minutes: number): number {
  const sessions = Math.max(1, Math.ceil(minutes / 20));
  return Math.round(gb * pricing.sandbox.perGbPer20Min * sessions * MICROS_PER_USD);
}

export function imageCostMicros(pricing: Pricing, model: string, count: number): number {
  const p = pricing.images[model];
  if (!p) throw new UnknownModelError(model);
  return Math.round(p.perImage * count * MICROS_PER_USD);
}

/** Multiplicador relativo de custo entre dois modelos (ex.: Astra custa 100× o Luna). */
export function relativeCost(pricing: Pricing, model: string, baseline: string): number | null {
  const a = pricing.models[model];
  const b = pricing.models[baseline];
  if (!a || !b || b.input === 0) return null;
  return a.input / b.input;
}
