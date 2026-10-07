import { describe, expect, it } from 'vitest';
import { llmCost, maxCallCostMicros, PricingSchema, relativeCost, sandboxCostMicros, UnknownModelError, ZERO_USAGE } from './pricing';
import { microsToUsd } from './money';

const pricing = PricingSchema.parse({
  currency: 'USD',
  checkedAt: '2026-10-05',
  longContext: { thresholdTokens: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 },
  billingMultipliers: { standard: 1, flex: 0.5, batch: 0.5 },
  models: {
    'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50, longContextAppliesToCached: true },
    'gpt-6.1-sol': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
    'gpt-6-luna': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  },
  tools: { webSearchPer1k: 10 },
  sandbox: { perGbPer20Min: 0.03, defaultGb: 4 },
});

const usage = (inputTokens: number, outputTokens: number, extra: Partial<typeof ZERO_USAGE> = {}) => ({
  ...ZERO_USAGE,
  inputTokens,
  outputTokens,
  ...extra,
});

describe('llmCost', () => {
  it('revisão do CEO: 50k de entrada + 10k de saída no Astra ≈ US$ 1', () => {
    const c = llmCost(pricing, 'gpt-6-astra', usage(50_000, 10_000), 'standard');
    expect(microsToUsd(c.micros)).toBeCloseTo(1.0, 6);
  });

  it('a mesma chamada no Luna fica em ~1 centavo (100× mais barata)', () => {
    const c = llmCost(pricing, 'gpt-6-luna', usage(50_000, 10_000), 'standard');
    expect(microsToUsd(c.micros)).toBeCloseTo(0.01, 6);
    expect(relativeCost(pricing, 'gpt-6-astra', 'gpt-6-luna')).toBe(100);
  });

  it('acima de 272k a requisição inteira vai para o contexto longo', () => {
    const c = llmCost(pricing, 'gpt-6-astra', usage(300_000, 10_000), 'standard');
    expect(c.longContext).toBe(true);
    // 300k × 10 × 2 / 1M = 6,00 ; 10k × 50 × 1,5 / 1M = 0,75
    expect(microsToUsd(c.micros)).toBeCloseTo(6.75, 6);
  });

  it('no Astra o dobro do contexto longo vale até para a entrada em cache', () => {
    const astra = llmCost(pricing, 'gpt-6-astra', usage(300_000, 0, { cachedTokens: 200_000 }), 'standard');
    // 100k sem cache × 10 × 2 = 2,00 ; 200k cache × 1 × 2 = 0,40
    expect(microsToUsd(astra.micros)).toBeCloseTo(2.4, 6);
    const sol = llmCost(pricing, 'gpt-6.1-sol', usage(300_000, 0, { cachedTokens: 200_000 }), 'standard');
    // 100k × 2 × 2 = 0,40 ; 200k × 0,2 × 1 = 0,04
    expect(microsToUsd(sol.micros)).toBeCloseTo(0.44, 6);
  });

  it('cache: leitura sai 90% mais barata, gravação no Astra custa 12,50/M', () => {
    const c = llmCost(pricing, 'gpt-6-astra', usage(100_000, 0, { cachedTokens: 50_000, cacheWriteTokens: 50_000 }), 'standard');
    // 50k × 1 + 50k × 12,5 = 0,05 + 0,625
    expect(microsToUsd(c.micros)).toBeCloseTo(0.675, 6);
  });

  it('flex dá 50% de desconto nos tokens, mas não na busca', () => {
    const std = llmCost(pricing, 'gpt-6-luna', usage(100_000, 20_000, { webSearchCalls: 2 }), 'standard');
    const flex = llmCost(pricing, 'gpt-6-luna', usage(100_000, 20_000, { webSearchCalls: 2 }), 'flex');
    // tokens: 0,01 + 0,01 = 0,02 ; busca: 2 × 10/1000 = 0,02
    expect(microsToUsd(std.micros)).toBeCloseTo(0.04, 6);
    expect(microsToUsd(flex.micros)).toBeCloseTo(0.03, 6);
  });

  it('modelo sem preço é erro: nada de gasto sem contabilidade', () => {
    expect(() => llmCost(pricing, 'gpt-7-misterio', usage(1, 1), 'standard')).toThrow(UnknownModelError);
  });

  it('pior caso para o guarda de orçamento ignora o cache', () => {
    expect(microsToUsd(maxCallCostMicros(pricing, 'gpt-6.1-sol', 10_000, 4_000, 'standard'))).toBeCloseTo(0.06, 6);
  });
});

describe('sandbox', () => {
  it('4 GB por 20 minutos ≈ 12 centavos; 21 minutos contam duas sessões', () => {
    expect(microsToUsd(sandboxCostMicros(pricing, 4, 20))).toBeCloseTo(0.12, 6);
    expect(microsToUsd(sandboxCostMicros(pricing, 4, 21))).toBeCloseTo(0.24, 6);
  });
});
