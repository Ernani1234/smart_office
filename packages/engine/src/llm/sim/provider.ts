import { estimateTokens, type Effort, type TokenUsage } from '@office/contracts';
import { hash, rng, sleep } from '../../util';
import type { LlmProvider, LlmRequest, LlmResult, LlmStreamEvent } from '../types';
import * as script from './script';

// Provedor simulado: mesma interface do real, mesmos schemas validados, custo
// calculado com a tabela de preços real sobre tokens estimados. Simula até o
// cache de prompt: o prefixo estável (manual + cargo) sai "do cache" a partir da
// segunda chamada do mesmo cargo.

const REASONING_BY_EFFORT: Record<Effort, number> = {
  none: 0,
  minimal: 80,
  low: 250,
  medium: 700,
  high: 1600,
  xhigh: 3200,
  max: 6400,
};

export class SimProvider implements LlmProvider {
  readonly id = 'sim' as const;
  private readonly seenPrefixes = new Set<string>();

  constructor(private readonly speed: number) {}

  private delay(ms: number): Promise<void> {
    return sleep(ms / this.speed);
  }

  async generate(req: LlmRequest, onEvent: (e: LlmStreamEvent) => void): Promise<LlmResult> {
    const purpose = req.sim.purpose;
    const seed = hash(`${purpose}:${JSON.stringify(req.sim).slice(0, 400)}`);
    const random = rng(seed);

    // "Raciocínio" transmitido aos poucos, como o resumo real chega em streaming.
    if (req.effort !== 'none') {
      for (const line of script.thoughtsFor(purpose, req.sim)) {
        const words = line.split(' ');
        for (let i = 0; i < words.length; i += 3) {
          onEvent({ type: 'thought', delta: `${words.slice(i, i + 3).join(' ')} ` });
          await this.delay(90 + random() * 120);
        }
        onEvent({ type: 'thought', delta: '\n' });
        await this.delay(250 + random() * 400);
      }
    } else {
      await this.delay(300 + random() * 300);
    }

    const output = this.respond(purpose, req.sim);
    const text = JSON.stringify(output);
    onEvent({ type: 'text', delta: text });

    // Tokens estimados → custo pela tabela real.
    const prefixTokens = estimateTokens(req.instructions);
    const variableTokens = estimateTokens(JSON.stringify(req.input));
    const cacheKey = `${req.model}:${req.cacheKey ?? req.instructions.length}`;
    const cached = this.seenPrefixes.has(cacheKey) ? prefixTokens : 0;
    const written = cached === 0 && prefixTokens >= 1024 ? prefixTokens : 0;
    this.seenPrefixes.add(cacheKey);
    const reasoning = Math.round(REASONING_BY_EFFORT[req.effort] * (0.6 + random() * 0.8));
    const usage: TokenUsage = {
      inputTokens: prefixTokens + variableTokens,
      cachedTokens: cached,
      cacheWriteTokens: written,
      outputTokens: estimateTokens(text) + reasoning,
      reasoningTokens: reasoning,
      webSearchCalls: Number(req.sim.webSearches ?? 0),
    };
    return {
      responseId: `sim_${seed.toString(36)}`,
      text,
      toolCalls: [],
      usage,
      reasoningSummary: script.thoughtsFor(purpose, req.sim).join('\n'),
    };
  }

  private respond(purpose: string, h: Record<string, unknown>): unknown {
    switch (purpose) {
      case 'worker.turn':
        return { ok: true };
      case 'ceo.decide':
        return script.ceoDecide(h);
      case 'ceo.arbitrate':
        return script.ceoArbitrate();
      case 'lead.plan':
        return script.leadPlan(h);
      case 'lead.review':
        return script.leadReview(h);
      case 'lead.report':
        return script.leadReport(h);
      case 'lead.respec':
        return script.leadRespec(h);
      case 'finance.report':
        return script.financeReport(h);
      case 'postmortem':
        return script.postmortem(h);
      case 'secretary.reply':
        return script.secretaryReply(h);
      default:
        throw new Error(`SimProvider: propósito sem roteiro: ${purpose}`);
    }
  }

  async generateImage(): Promise<{ png: Buffer }> {
    throw new Error('SimProvider não gera imagens (o designer simulado desenha SVG).');
  }
}
