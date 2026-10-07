import type { z } from 'zod';
import type { BillingMode, Effort, TokenUsage } from '@office/contracts';

// Contrato entre a empresa e qualquer provedor de modelo. A OpenAI (Responses
// API) é o provedor real; o simulado reproduz o mesmo formato sem custo, para
// demonstrar e testar a empresa inteira sem chave.

export type LlmInputItem =
  | { role: 'user' | 'assistant' | 'developer'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string };

export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export type LlmTool = FunctionTool | { type: 'web_search' };

/** Pistas para o provedor simulado roteirizar a resposta (ignoradas pelo real). */
export type SimHint = Record<string, unknown> & { purpose: string };

export interface LlmRequest {
  model: string;
  effort: Effort;
  billing: BillingMode;
  /** Prefixo estável: manual da empresa + prompt do cargo. */
  instructions: string;
  /** Parte variável, sempre no fim. */
  input: LlmInputItem[];
  schema?: { name: string; zod: z.ZodType };
  tools?: LlmTool[];
  maxOutputTokens?: number;
  previousResponseId?: string | null;
  cacheKey?: string;
  sim: SimHint;
}

export interface ToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface LlmResult {
  responseId: string | null;
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  reasoningSummary: string;
}

export type LlmStreamEvent = { type: 'thought'; delta: string } | { type: 'text'; delta: string } | { type: 'searching' };

export interface LlmProvider {
  readonly id: 'openai' | 'sim';
  generate(req: LlmRequest, onEvent: (e: LlmStreamEvent) => void): Promise<LlmResult>;
  generateImage?(req: { model: string; prompt: string; size: string }): Promise<{ png: Buffer }>;
}

export interface Embedder {
  readonly id: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}
