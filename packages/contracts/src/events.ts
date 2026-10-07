import { z } from 'zod';
import { ApprovalAskSchema, DeliveryReportSchema, ReviewVerdictOutSchema, TeamReportSchema, WorkOrderSchema } from './documents';
import {
  AGENT_ACTIVITIES,
  APPROVAL_KINDS,
  BILLING_MODES,
  CEO_DECISIONS,
  COST_KINDS,
  EFFORTS,
  END_REASONS,
  LEVELS,
  REVENUE_SOURCES,
  RUN_MODES,
  TASK_KINDS,
} from './enums';

// O log de eventos é a fonte da verdade do escritório. Tudo vira evento imutável
// (tarefa atribuída, ferramenta chamada, resumo de raciocínio, entrega, parecer,
// custo, receita, pedido de aprovação) e o Phaser só anima o que chega. Replay
// sai de graça: basta reaplicar o log.

const Envelope = {
  id: z.number().int(),
  ts: z.string(),
  missionId: z.string().nullable(),
  taskId: z.string().nullable(),
  agentId: z.string().nullable(),
};

function ev<T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.object({ ...Envelope, type: z.literal(type), data });
}

const Tokens = z.object({
  input: z.number(),
  cached: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  reasoning: z.number(),
});

const CiCheck = z.object({
  name: z.string(),
  ok: z.boolean(),
  ms: z.number(),
  tail: z.string(),
});

export const OfficeEventSchema = z.discriminatedUnion('type', [
  // ------------------------------------------------------------ empresa
  ev('company.booted', z.object({ mode: z.enum(RUN_MODES), companyName: z.string(), version: z.string() })),
  ev('company.paused', z.object({ by: z.string(), reason: z.string() })),
  ev('company.resumed', z.object({ by: z.string() })),
  ev('roles.updated', z.object({ changes: z.array(z.string()) })),

  // ------------------------------------------------------------ agentes
  ev(
    'agent.hired',
    z.object({
      name: z.string(),
      roleId: z.string(),
      title: z.string(),
      team: z.string(),
      level: z.enum(LEVELS),
      model: z.string(),
      effort: z.enum(EFFORTS),
      billing: z.enum(BILLING_MODES),
      desk: z.string(),
      seed: z.number().int(),
    }),
  ),
  ev(
    'agent.promoted',
    z.object({
      fromModel: z.string(),
      toModel: z.string(),
      reason: z.string(),
      by: z.enum(['board', 'ladder']),
    }),
  ),
  ev('agent.status', z.object({ activity: z.enum(AGENT_ACTIVITIES), note: z.string().nullable() })),
  ev('agent.said', z.object({ text: z.string(), to: z.string().nullable() })),
  ev('agent.thought', z.object({ text: z.string() })),
  ev('agent.steered', z.object({ text: z.string(), from: z.string() })),

  // ------------------------------------------------------------ missão
  ev(
    'mission.created',
    z.object({
      title: z.string(),
      brief: z.string(),
      metric: z.literal('net_profit'),
      goalUsd: z.number(),
      spendCapUsd: z.number(),
      deadline: z.string(),
      revenueSource: z.enum(REVENUE_SOURCES),
    }),
  ),
  ev('mission.started', z.object({ workflowId: z.string() })),
  ev('mission.cycle', z.object({ cycle: z.number().int(), trigger: z.string() })),
  ev('mission.launched', z.object({ product: z.string(), url: z.string().nullable(), priceUsd: z.number().nullable() })),
  ev(
    'mission.completed',
    z.object({
      reason: z.enum(END_REASONS),
      netProfitUsd: z.number(),
      revenueUsd: z.number(),
      spentUsd: z.number(),
      note: z.string().nullable(),
    }),
  ),

  // ------------------------------------------------------------ decisões e relatórios
  ev(
    'ceo.decision',
    z.object({
      decision: z.enum(CEO_DECISIONS),
      summary: z.string(),
      rationale: z.string(),
      effort: z.enum(EFFORTS),
      orders: z.array(z.object({ team: z.string(), title: z.string() })),
      cycle: z.number().int(),
    }),
  ),
  ev('lead.planned', z.object({ team: z.string(), summary: z.string(), tasks: z.number().int() })),
  ev('report.submitted', z.object({ report: TeamReportSchema })),

  // ------------------------------------------------------------ tarefas
  ev(
    'task.created',
    z.object({
      title: z.string(),
      team: z.string(),
      role: z.string(),
      kind: z.enum(TASK_KINDS),
      parentId: z.string().nullable(),
      workOrder: WorkOrderSchema,
    }),
  ),
  ev('task.assigned', z.object({ assignee: z.string(), reviewer: z.string().nullable(), model: z.string(), effort: z.enum(EFFORTS) })),
  ev('task.started', z.object({ attempt: z.number().int(), model: z.string() })),
  ev('task.respec', z.object({ by: z.string(), summary: z.string() })),
  ev(
    'task.escalated',
    z.object({
      to: z.enum(['model', 'lead', 'ceo', 'board']),
      fromModel: z.string().nullable(),
      toModel: z.string().nullable(),
      reason: z.string(),
    }),
  ),
  ev('task.completed', z.object({ status: z.enum(['done', 'failed', 'cancelled']), summary: z.string(), costUsd: z.number() })),

  // ------------------------------------------------------------ trabalho braçal
  ev('tool.called', z.object({ callId: z.string(), tool: z.string(), label: z.string() })),
  ev('tool.result', z.object({ callId: z.string(), ok: z.boolean(), summary: z.string(), ms: z.number() })),
  ev(
    'file.changed',
    z.object({
      path: z.string(),
      op: z.enum(['create', 'modify', 'delete']),
      additions: z.number().int(),
      deletions: z.number().int(),
    }),
  ),
  ev('ci.started', z.object({ runId: z.string(), checks: z.array(z.string()), attempt: z.number().int() })),
  ev('ci.completed', z.object({ runId: z.string(), ok: z.boolean(), checks: z.array(CiCheck), ms: z.number() })),
  ev('pr.opened', z.object({ branch: z.string(), title: z.string(), url: z.string().nullable(), commit: z.string() })),
  ev('pr.merged', z.object({ branch: z.string(), commit: z.string() })),
  ev('delivery.submitted', z.object({ report: DeliveryReportSchema })),
  ev('review.started', z.object({ reviewerId: z.string(), round: z.number().int() })),
  ev('review.completed', z.object({ reviewerId: z.string(), round: z.number().int(), verdict: ReviewVerdictOutSchema })),

  // ------------------------------------------------------------ dinheiro
  ev(
    'cost.recorded',
    z.object({
      entryId: z.number().int(),
      amountUsd: z.number(),
      kind: z.enum(COST_KINDS),
      model: z.string().nullable(),
      billing: z.enum(BILLING_MODES).nullable(),
      role: z.string().nullable(),
      team: z.string().nullable(),
      tokens: Tokens.nullable(),
      note: z.string().nullable(),
    }),
  ),
  ev(
    'revenue.recorded',
    z.object({
      entryId: z.number().int(),
      orderId: z.string(),
      grossUsd: z.number(),
      netUsd: z.number(),
      source: z.enum(REVENUE_SOURCES),
    }),
  ),
  ev('budget.warning', z.object({ spentUsd: z.number(), capUsd: z.number(), pct: z.number() })),
  ev('finance.goal_reached', z.object({ netProfitUsd: z.number(), goalUsd: z.number() })),

  // ------------------------------------------------------------ conselho
  ev(
    'approval.requested',
    z.object({
      approvalId: z.string(),
      kind: z.enum(APPROVAL_KINDS),
      title: z.string(),
      detail: z.string(),
      amountUsd: z.number().nullable(),
      requestedBy: z.string(),
    }),
  ),
  ev('approval.decided', z.object({ approvalId: z.string(), approved: z.boolean(), note: z.string().nullable(), by: z.string() })),

  // ------------------------------------------------------------ conhecimento e growth
  ev('wiki.written', z.object({ slug: z.string(), title: z.string(), kind: z.string() })),
  ev('analytics.snapshot', z.object({ visits: z.number(), signups: z.number(), checkouts: z.number(), source: z.string() })),
]);

export type OfficeEvent = z.infer<typeof OfficeEventSchema>;
export type EventType = OfficeEvent['type'];
export type EventOf<T extends EventType> = Extract<OfficeEvent, { type: T }>;
export type EventData<T extends EventType> = EventOf<T>['data'];

/** Evento ainda sem id/ts (atribuídos pelo banco ao gravar). */
export type NewEvent = {
  [T in EventType]: {
    type: T;
    data: EventData<T>;
    missionId?: string | null;
    taskId?: string | null;
    agentId?: string | null;
  };
}[EventType];

export function newEvent<T extends EventType>(
  type: T,
  data: EventData<T>,
  refs: { missionId?: string | null; taskId?: string | null; agentId?: string | null } = {},
): NewEvent {
  return { type, data, ...refs } as NewEvent;
}

export { ApprovalAskSchema };
