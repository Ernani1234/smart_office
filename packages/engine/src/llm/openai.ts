import OpenAI from 'openai';
import { structuredFormat, ZERO_USAGE, type TokenUsage } from '@office/contracts';
import type { Embedder, LlmProvider, LlmRequest, LlmResult, LlmStreamEvent, ToolCall } from './types';

// Provedor real: Responses API com o SDK oficial. Streaming para mostrar o resumo
// do raciocínio ao vivo no inspetor; Structured Outputs no modo estrito para os
// documentos da empresa; service_tier flex para cargos baratos e sem pressa.

type AnyRecord = Record<string, unknown>;

function usageFrom(u: AnyRecord | null | undefined, webSearchCalls: number): TokenUsage {
  if (!u) return { ...ZERO_USAGE, webSearchCalls };
  const inDetails = (u.input_tokens_details ?? {}) as AnyRecord;
  const outDetails = (u.output_tokens_details ?? {}) as AnyRecord;
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    cachedTokens: Number(inDetails.cached_tokens ?? 0),
    cacheWriteTokens: Number(inDetails.cache_write_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    reasoningTokens: Number(outDetails.reasoning_tokens ?? 0),
    webSearchCalls,
  };
}

export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAI;

  constructor(opts: { apiKey: string; baseURL?: string | null; project?: string | null }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? undefined,
      project: opts.project ?? undefined,
      maxRetries: 2,
      timeout: 15 * 60 * 1000, // flex pode demorar
    });
  }

  get raw(): OpenAI {
    return this.client;
  }

  async generate(req: LlmRequest, onEvent: (e: LlmStreamEvent) => void): Promise<LlmResult> {
    const body: AnyRecord = {
      model: req.model,
      instructions: req.instructions,
      input: req.input,
      reasoning: req.effort === 'none' ? { effort: 'none' } : { effort: req.effort, summary: 'auto' },
      max_output_tokens: req.maxOutputTokens,
      store: true,
      stream: true,
      service_tier: req.billing === 'standard' ? 'auto' : 'flex',
    };
    if (req.cacheKey) body.prompt_cache_key = req.cacheKey;
    if (req.previousResponseId) body.previous_response_id = req.previousResponseId;
    if (req.schema) body.text = { format: structuredFormat(req.schema.name, req.schema.zod) };
    if (req.tools?.length) {
      body.tools = req.tools;
      body.parallel_tool_calls = false;
    }

    const stream = (await this.client.responses.create(body as never)) as unknown as AsyncIterable<AnyRecord>;
    let finalResponse: AnyRecord | null = null;
    let webSearchCalls = 0;
    let summary = '';
    for await (const event of stream) {
      switch (event.type) {
        case 'response.reasoning_summary_text.delta':
          summary += String(event.delta ?? '');
          onEvent({ type: 'thought', delta: String(event.delta ?? '') });
          break;
        case 'response.reasoning_summary_part.done':
          summary += '\n';
          onEvent({ type: 'thought', delta: '\n' });
          break;
        case 'response.output_text.delta':
          onEvent({ type: 'text', delta: String(event.delta ?? '') });
          break;
        case 'response.web_search_call.searching':
          onEvent({ type: 'searching' });
          break;
        case 'response.web_search_call.completed':
          webSearchCalls += 1;
          break;
        case 'response.completed':
        case 'response.incomplete':
          finalResponse = event.response as AnyRecord;
          break;
        case 'response.failed': {
          const r = event.response as AnyRecord;
          const err = (r?.error ?? {}) as AnyRecord;
          throw new Error(`OpenAI response.failed: ${String(err.message ?? 'erro desconhecido')}`);
        }
        case 'error':
          throw new Error(`OpenAI stream error: ${String((event as AnyRecord).message ?? JSON.stringify(event))}`);
      }
    }
    if (!finalResponse) throw new Error('OpenAI: stream terminou sem response.completed');

    const output = (finalResponse.output ?? []) as AnyRecord[];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const item of output) {
      if (item.type === 'message') {
        for (const part of (item.content ?? []) as AnyRecord[]) {
          if (part.type === 'output_text') text += String(part.text ?? '');
          if (part.type === 'refusal') throw new Error(`Modelo recusou: ${String(part.refusal ?? '')}`);
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({ callId: String(item.call_id), name: String(item.name), arguments: String(item.arguments ?? '{}') });
      }
    }
    // Fallback caso o stream não tenha emitido os eventos de busca.
    if (webSearchCalls === 0) webSearchCalls = output.filter((i) => i.type === 'web_search_call').length;

    return {
      responseId: String(finalResponse.id ?? '') || null,
      text,
      toolCalls,
      usage: usageFrom(finalResponse.usage as AnyRecord, webSearchCalls),
      reasoningSummary: summary.trim(),
    };
  }

  async generateImage(req: { model: string; prompt: string; size: string }): Promise<{ png: Buffer }> {
    const res = (await this.client.images.generate({ model: req.model, prompt: req.prompt, size: req.size, n: 1 } as never)) as unknown as {
      data?: { b64_json?: string }[];
    };
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error('Imagem sem b64_json na resposta');
    return { png: Buffer.from(b64, 'base64') };
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly id = 'openai';
  constructor(
    private readonly client: OpenAI,
    readonly dim: number,
    private readonly model = 'text-embedding-3-small',
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts.map((t) => t.slice(0, 24_000)),
      dimensions: this.dim,
    });
    return res.data.map((d) => d.embedding as number[]);
  }
}
