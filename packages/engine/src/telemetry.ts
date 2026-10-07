import type { Env } from './env';

// Observabilidade: trace e custo por chamada via OpenTelemetry, exportado por
// OTLP para o Langfuse self-hosted (ou qualquer coletor). Desligado quando não
// há configuração — o livro-caixa continua sendo a fonte do custo.

export interface Span {
  end(result: Record<string, unknown>): void;
}

export interface Telemetry {
  start(name: string, attrs: Record<string, unknown>): Span;
  shutdown(): Promise<void>;
}

const NOOP: Telemetry = {
  start: () => ({ end: () => undefined }),
  shutdown: async () => undefined,
};

function flat(v: unknown): string | number | boolean {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 8000);
  return JSON.stringify(v ?? null).slice(0, 8000);
}

export async function createTelemetry(env: Env): Promise<Telemetry> {
  const lf = env.integrations.langfuse;
  const endpoint = env.integrations.otlpEndpoint ?? (lf ? `${lf.host.replace(/\/$/, '')}/api/public/otel/v1/traces` : null);
  if (!endpoint) return NOOP;

  const api = await import('@opentelemetry/api');
  const { BasicTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');

  const headers: Record<string, string> = {};
  if (lf) headers.Authorization = `Basic ${Buffer.from(`${lf.publicKey}:${lf.secretKey}`).toString('base64')}`;
  const exporter = new OTLPTraceExporter({ url: endpoint, headers });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'pixel-office' }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('pixel-office');

  return {
    start(name, attrs) {
      const span = tracer.startSpan(name, {
        attributes: {
          'langfuse.observation.type': 'generation',
          'gen_ai.system': 'openai',
          'gen_ai.request.model': flat(attrs.model),
          'gen_ai.prompt': flat(attrs.input),
          'langfuse.session.id': flat(attrs.mission ?? 'sem-missao'),
          'langfuse.user.id': flat(attrs.agent),
          'office.role': flat(attrs.role),
          'office.task': flat(attrs.task ?? ''),
          'office.effort': flat(attrs.effort),
          'office.billing': flat(attrs.billing),
        },
      });
      return {
        end(result) {
          const usage = (result.usage ?? {}) as Record<string, number>;
          span.setAttributes({
            'gen_ai.completion': flat(result.output ?? ''),
            'gen_ai.usage.input_tokens': usage.inputTokens ?? 0,
            'gen_ai.usage.output_tokens': usage.outputTokens ?? 0,
            'gen_ai.usage.cost': Number(result.costUsd ?? 0),
          });
          if (result.error) span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(result.error) });
          span.end();
        },
      };
    },
    async shutdown() {
      await provider.shutdown();
    },
  };
}
