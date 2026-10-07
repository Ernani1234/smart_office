import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type OpenAI from 'openai';
import {
  estimateTokens,
  HostedDeliveryOutSchema,
  llmCost,
  newEvent,
  sandboxCostMicros,
  structuredFormat,
  ZERO_USAGE,
  type TokenUsage,
} from '@office/contracts';
import type { PricingStore, PromptStore, RolesStore } from '../config/stores';
import type { Ledger } from '../db/ledger';
import type { LlmGateway } from '../llm/gateway';
import { renderJob, type WorkerHooks, type WorkerJob, type WorkerOutcome, type WorkerRuntime } from './types';

// Trabalhador na Agents API (beta): mesma harness do Codex, sandbox hospedada pela
// OpenAI. A sessão recebe um snapshot do worktree; no fim devolve o relatório e
// o conteúdo dos arquivos que mudou, que gravamos no worktree para o NOSSO CI
// verificar — a evidência continua sendo nossa. Recados do Conselho viram
// `agent.session.input.message` (o serviço trata como steering do turno ativo).

type AnyRecord = Record<string, unknown>;

const TEXT_EXT = /\.(m?js|cjs|ts|tsx|jsx|json|md|html|css|svg|txt|yml|yaml|toml|sh)$|(^|\/)(Dockerfile|\.gitignore)$/i;
const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

function snapshot(dir: string): { path: string; data: string }[] {
  const out: { path: string; data: string }[] = [];
  let total = 0;
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(dir, rel))) {
      if (entry === '.git' || entry === 'node_modules') continue;
      const relPath = rel ? `${rel}/${entry}` : entry;
      const full = path.join(dir, relPath);
      if (statSync(full).isDirectory()) walk(relPath);
      else if (TEXT_EXT.test(relPath)) {
        const data = readFileSync(full, 'utf8');
        total += data.length;
        if (total > MAX_SNAPSHOT_BYTES) throw new Error('Worktree grande demais para a sessão hospedada (limite de 4 MiB por requisição).');
        out.push({ path: `workspace/${relPath}`, data });
      }
    }
  };
  if (existsSync(dir)) walk('');
  return out;
}

export class AgentsApiRuntime implements WorkerRuntime {
  readonly id = 'agents';

  constructor(
    private readonly d: {
      client: OpenAI;
      gateway: LlmGateway;
      ledger: Ledger;
      pricing: PricingStore;
      prompts: PromptStore;
      roles: RolesStore;
      containerSize: 'small' | 'medium' | 'large';
    },
  ) {}

  async run(job: WorkerJob, hooks: WorkerHooks): Promise<WorkerOutcome> {
    const instructions = `${this.d.prompts.instructionsFor(this.d.roles.get(), job.role)}

---

Você está numa sandbox hospedada. O repositório está em ./workspace. Trabalhe lá, rode os testes,
e no final responda SOMENTE com o JSON pedido: o relatório de entrega e o conteúdo COMPLETO de cada
arquivo que você criou ou alterou (caminhos relativos a ./workspace).`;
    const prompt = renderJob(job);
    await this.d.gateway.waitIfPaused(hooks.ctx);
    await this.d.gateway.guard(hooks.ctx, job.model, job.billing, estimateTokens(instructions + prompt) * 4, 32_000);

    const files = job.workspace ? snapshot(job.workspace.dir) : [];
    const started = Date.now();
    const stream = (await this.d.client.beta.agents.sessions.create({
      environment: {
        type: 'openai_hosted',
        container_size: this.d.containerSize,
        network: { access: 'disabled' },
        files: files.map((f) => ({ type: 'inline', path: f.path, data: f.data })),
      },
      agent: {
        model: job.model,
        instructions,
        reasoning: job.effort === 'none' ? { effort: 'none' } : { effort: job.effort, summary: 'auto' },
        service_tier: job.billing === 'standard' ? 'auto' : 'flex',
        text: { format: structuredFormat('hosted_delivery', HostedDeliveryOutSchema) as never },
      },
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      metadata: { mission: job.missionId, task: job.taskId, agent: job.agent.id },
      stream: true,
    } as never)) as unknown as AsyncIterable<AnyRecord>;

    let sessionId: string | null = null;
    let finalText = '';
    let usage: TokenUsage = { ...ZERO_USAGE };
    let thought = '';
    let calls = 0;
    const steer = setInterval(() => {
      void (async () => {
        if (!sessionId) return;
        for (const msg of await hooks.takeMessages()) {
          await this.d.client.beta.agents.sessions.events.create(sessionId, {
            events: [
              {
                type: 'agent.session.input.message',
                input: [{ role: 'user', content: [{ type: 'input_text', text: `[Mensagem do Conselho — prioridade] ${msg}` }] }],
              },
            ],
          } as never);
        }
      })().catch(() => undefined);
    }, 3000);

    try {
      for await (const ev of stream) {
        hooks.heartbeat();
        const type = String(ev.type);
        if (type === 'agent.session.created') {
          const s = (ev.session ?? {}) as AnyRecord;
          sessionId = String(s.id ?? ev.session_id ?? '') || null;
        } else if (type === 'agent.session.turn.reasoning_summary_text.delta') {
          thought += String(ev.delta ?? '');
          if (thought.length > 160 || thought.includes('\n')) {
            await hooks.emit(newEvent('agent.thought', { text: thought.trim().slice(0, 500) }));
            thought = '';
          }
        } else if (type === 'agent.session.turn.item.done') {
          const item = (ev.item ?? {}) as AnyRecord;
          if (typeof item.command === 'string') {
            const callId = `${job.taskId}-${job.attempt}-h${++calls}`;
            await hooks.emit(newEvent('tool.called', { callId, tool: 'run', label: `$ ${item.command.slice(0, 80)}` }));
            await hooks.emit(
              newEvent('tool.result', {
                callId,
                ok: Number(item.exit_code ?? 1) === 0,
                summary: String(item.output ?? '').slice(-200),
                ms: Number(item.duration_ms ?? 0),
              }),
            );
          }
        } else if (type === 'agent.session.turn.output_text.done') {
          finalText = String(ev.text ?? finalText);
        } else if (type === 'agent.session.turn.completed') {
          const u = (ev.usage ?? null) as AnyRecord | null;
          if (u) {
            const inD = (u.input_tokens_details ?? {}) as AnyRecord;
            const outD = (u.output_tokens_details ?? {}) as AnyRecord;
            usage = {
              inputTokens: Number(u.input_tokens ?? 0),
              cachedTokens: Number(inD.cached_tokens ?? 0),
              cacheWriteTokens: 0,
              outputTokens: Number(u.output_tokens ?? 0),
              reasoningTokens: Number(outD.reasoning_tokens ?? 0),
              webSearchCalls: 0,
            };
          }
          break;
        } else if (type === 'agent.session.turn.failed' || type === 'agent.session.failed' || type === 'agent.session.environment.failed') {
          throw new Error(`Agents API: ${type} ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
        }
      }
    } finally {
      clearInterval(steer);
      if (thought.trim()) await hooks.emit(newEvent('agent.thought', { text: thought.trim().slice(0, 500) }));
      // Custo: tokens pelo preço do modelo + sandbox pela tarifa de containers.
      const pricing = this.d.pricing.get();
      const minutes = (Date.now() - started) / 60_000;
      const gb = pricing.sandbox.sizesGb[this.d.containerSize] ?? pricing.sandbox.defaultGb;
      const tokenCost = llmCost(pricing, job.model, usage, job.billing);
      const base = {
        missionId: job.missionId,
        taskId: job.taskId,
        agentId: job.agent.id,
        role: job.roleId,
        team: job.role.team,
      };
      await this.d.ledger.recordCost({
        ...base,
        kind: 'llm',
        model: job.model,
        billing: job.billing,
        micros: tokenCost.micros,
        usage,
        note: 'agents.session',
      });
      await this.d.ledger.recordCost({
        ...base,
        kind: 'sandbox',
        model: null,
        billing: null,
        micros: sandboxCostMicros(pricing, gb, minutes),
        note: `sandbox ${this.d.containerSize} · ${minutes.toFixed(1)} min`,
      });
      if (sessionId) await this.d.client.beta.agents.sessions.delete(sessionId).catch(() => undefined);
    }

    const parsed = HostedDeliveryOutSchema.safeParse(JSON.parse(finalText || '{}'));
    if (!parsed.success) throw new Error(`Agents API: entrega fora do schema: ${parsed.error.message.slice(0, 300)}`);
    return {
      report: parsed.data.report,
      files: parsed.data.files.map((f) => ({ path: f.path.replace(/^\.?\/?workspace\//, ''), content: f.content })),
    };
  }
}
