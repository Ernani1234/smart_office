import type { z } from 'zod';
import {
  estimateTokens,
  llmCost,
  maxCallCostMicros,
  microsToUsd,
  newEvent,
  usdToMicros,
  type BillingMode,
  type Effort,
  type TokenUsage,
} from '@office/contracts';
import type { PricingStore, PromptStore, RolesStore } from '../config/stores';
import type { EventStore } from '../db/event-store';
import type { Ledger } from '../db/ledger';
import type { MissionRepo, SettingsRepo } from '../db/repos';
import type { Telemetry } from '../telemetry';
import { sleep } from '../util';
import type { LlmInputItem, LlmProvider, LlmRequest, LlmResult, LlmTool } from './types';

// Toda chamada de modelo passa por aqui. É onde moram as regras de dinheiro:
// 1) pausa global (botão de pânico) segura a chamada antes de gastar;
// 2) guarda de orçamento recusa a chamada se o pior caso estoura o teto da
//    missão ou o orçamento da tarefa;
// 3) o custo exato vira linha no livro-caixa, calculado por código;
// 4) o resumo do raciocínio vira eventos `agent.thought` em streaming.

export class BudgetExceededError extends Error {
  constructor(
    readonly scope: 'mission' | 'task',
    readonly neededUsd: number,
    readonly leftUsd: number,
  ) {
    super(
      scope === 'mission'
        ? `Teto de gasto da missão atingido: precisaria de até US$ ${neededUsd.toFixed(4)}, restam US$ ${leftUsd.toFixed(4)}.`
        : `Orçamento da tarefa esgotado: precisaria de até US$ ${neededUsd.toFixed(4)}, restam US$ ${leftUsd.toFixed(4)}.`,
    );
    this.name = 'BudgetExceededError';
  }
}

export interface CallContext {
  missionId: string | null;
  taskId: string | null;
  agentId: string;
  /** Orçamento da tarefa em USD (ordem de serviço); null = só o teto da missão. */
  taskBudgetUsd: number | null;
  heartbeat?: () => void;
}

export interface TurnRequest {
  roleId: string;
  model?: string;
  effort?: Effort;
  billing?: BillingMode;
  instructions?: string;
  input: LlmInputItem[];
  schema?: { name: string; zod: z.ZodType };
  tools?: LlmTool[];
  maxOutputTokens?: number;
  previousResponseId?: string | null;
  sim: LlmRequest['sim'];
  /** Nome da operação para telemetria. */
  name: string;
}

export interface TurnResult extends LlmResult {
  costUsd: number;
  model: string;
}

export class LlmGateway {
  constructor(
    private readonly d: {
      llm: LlmProvider;
      roles: RolesStore;
      pricing: PricingStore;
      prompts: PromptStore;
      ledger: Ledger;
      events: EventStore;
      settings: SettingsRepo;
      missions: MissionRepo;
      telemetry: Telemetry;
    },
  ) {}

  /** Segura a execução enquanto a empresa estiver em pânico (pausa global). */
  async waitIfPaused(ctx: CallContext): Promise<void> {
    let announced = false;
    while (await this.d.settings.isPaused()) {
      if (!announced) {
        announced = true;
        await this.d.events.append(
          newEvent(
            'agent.status',
            { activity: 'waiting', note: 'Pausado pelo Conselho' },
            { agentId: ctx.agentId, missionId: ctx.missionId, taskId: ctx.taskId },
          ),
        );
      }
      ctx.heartbeat?.();
      await sleep(1000);
    }
  }

  /** Pior caso da chamada contra o teto da missão e o orçamento da tarefa. */
  async guard(ctx: CallContext, model: string, billing: BillingMode, estInputTokens: number, maxOutputTokens: number): Promise<void> {
    const pricing = this.d.pricing.get();
    const worst = maxCallCostMicros(pricing, model, estInputTokens, maxOutputTokens, billing);
    if (ctx.missionId) {
      const mission = await this.d.missions.get(ctx.missionId);
      if (mission) {
        const totals = await this.d.ledger.totals(ctx.missionId);
        const left = mission.capMicros - totals.spentMicros;
        if (worst > left) throw new BudgetExceededError('mission', microsToUsd(worst), microsToUsd(Math.max(0, left)));
      }
    }
    if (ctx.taskId && ctx.taskBudgetUsd !== null) {
      const spent = await this.d.ledger.taskSpentMicros(ctx.taskId);
      const left = usdToMicros(ctx.taskBudgetUsd) - spent;
      if (worst > left) throw new BudgetExceededError('task', microsToUsd(worst), microsToUsd(Math.max(0, left)));
    }
  }

  async turn(ctx: CallContext, t: TurnRequest): Promise<TurnResult> {
    const rolesFile = this.d.roles.get();
    const role = this.d.roles.role(t.roleId);
    const model = t.model ?? role.model;
    const effort = t.effort ?? role.effort;
    const billing = t.billing ?? role.billing;
    const instructions = t.instructions ?? this.d.prompts.instructionsFor(rolesFile, role);
    const maxOutputTokens = t.maxOutputTokens ?? 6000;
    const team = role.team;

    await this.waitIfPaused(ctx);
    const estInput = estimateTokens(instructions) + estimateTokens(JSON.stringify(t.input));
    await this.guard(ctx, model, billing, estInput, maxOutputTokens);

    // Pensamentos em streaming, agrupados por frase para não inundar o log.
    let buffer = '';
    let lastFlush = Date.now();
    let lastBeat = 0;
    const pending: Promise<unknown>[] = [];
    const flush = () => {
      const text = buffer.replace(/\s+/g, ' ').trim();
      buffer = '';
      lastFlush = Date.now();
      if (text.length < 2) return;
      pending.push(
        this.d.events
          .append(
            newEvent('agent.thought', { text: text.slice(0, 500) }, { agentId: ctx.agentId, missionId: ctx.missionId, taskId: ctx.taskId }),
          )
          .catch(() => undefined),
      );
    };

    const span = this.d.telemetry.start(t.name, {
      model,
      effort,
      billing,
      role: t.roleId,
      agent: ctx.agentId,
      mission: ctx.missionId,
      task: ctx.taskId,
      input: t.input,
      instructionsChars: instructions.length,
    });

    let result: LlmResult;
    try {
      result = await this.d.llm.generate(
        {
          model,
          effort,
          billing,
          instructions,
          input: t.input,
          schema: t.schema,
          tools: t.tools,
          maxOutputTokens,
          previousResponseId: t.previousResponseId,
          cacheKey: `role:${t.roleId}`,
          sim: t.sim,
        },
        (e) => {
          const now = Date.now();
          if (now - lastBeat > 2000) {
            ctx.heartbeat?.();
            lastBeat = now;
          }
          if (e.type === 'thought') {
            buffer += e.delta;
            if (e.delta.includes('\n') || buffer.length > 160 || now - lastFlush > 2500) flush();
          }
        },
      );
    } catch (err) {
      span.end({ error: String(err) });
      throw err;
    }
    flush();
    await Promise.all(pending);

    const cost = llmCost(this.d.pricing.get(), model, result.usage, billing);
    await this.d.ledger.recordCost({
      missionId: ctx.missionId,
      taskId: ctx.taskId,
      agentId: ctx.agentId,
      role: t.roleId,
      team,
      kind: 'llm',
      model,
      billing,
      micros: cost.micros,
      usage: result.usage,
      note: `${t.name}${cost.longContext ? ' (contexto longo)' : ''}`,
      detail: { effort, responseId: result.responseId, parts: cost.parts },
    });
    span.end({ output: result.text.slice(0, 4000), usage: result.usage, costUsd: microsToUsd(cost.micros) });
    return { ...result, costUsd: microsToUsd(cost.micros), model };
  }

  /** Chamada única com saída estruturada validada pelo mesmo schema Zod. */
  async structured<T>(
    ctx: CallContext,
    t: Omit<TurnRequest, 'schema' | 'tools' | 'input'> & { input: string; schemaName: string; schema: z.ZodType<T> },
  ): Promise<{ value: T; costUsd: number; usage: TokenUsage; model: string }> {
    const r = await this.turn(ctx, {
      ...t,
      input: [{ role: 'user', content: t.input }],
      schema: { name: t.schemaName, zod: t.schema },
    });
    let json: unknown;
    try {
      json = JSON.parse(r.text);
    } catch {
      throw new Error(`Saída não é JSON válido (${t.name}): ${r.text.slice(0, 200)}`);
    }
    const parsed = t.schema.safeParse(json);
    if (!parsed.success) throw new Error(`Saída fora do schema (${t.name}): ${parsed.error.message.slice(0, 400)}`);
    return { value: parsed.data, costUsd: r.costUsd, usage: r.usage, model: r.model };
  }
}
