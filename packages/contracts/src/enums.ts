export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export const BILLING_MODES = ['standard', 'flex', 'batch'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const LEVELS = ['executive', 'lead', 'worker', 'staff'] as const;
export type Level = (typeof LEVELS)[number];

/** Ferramentas que um cargo pode receber. Quem tem `web` não pode ter escrita. */
export const TOOL_GRANTS = ['workspace', 'shell', 'web', 'image'] as const;
export type ToolGrant = (typeof TOOL_GRANTS)[number];

export const ROLE_KINDS = ['llm', 'image', 'code'] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

/** O que é irreversível e precisa do Conselho. */
export const APPROVAL_KINDS = ['spend', 'publish', 'contact', 'deploy', 'escalation'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const TASK_STATUSES = ['backlog', 'in_progress', 'ci', 'review', 'blocked', 'done', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = ['research', 'spec', 'design', 'build', 'devops', 'test', 'copy', 'seo'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const MISSION_STATUSES = ['created', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const END_REASONS = ['goal_reached', 'budget_exhausted', 'deadline', 'cancelled', 'failed'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const REVENUE_SOURCES = ['sim', 'polar', 'lemonsqueezy', 'paddle'] as const;
export type RevenueSourceId = (typeof REVENUE_SOURCES)[number];

export const COST_KINDS = ['llm', 'search', 'sandbox', 'image', 'embedding', 'other'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CEO_DECISIONS = ['delegate', 'wait', 'pivot', 'request_approval'] as const;
export type CeoDecision = (typeof CEO_DECISIONS)[number];

export const AGENT_ACTIVITIES = [
  'idle',
  'working',
  'thinking',
  'typing',
  'testing',
  'researching',
  'reviewing',
  'planning',
  'waiting',
  'blocked',
  'celebrating',
] as const;
export type AgentActivity = (typeof AGENT_ACTIVITIES)[number];

/** Onde o agente "mora" no mapa naquele momento (projeção, não física). */
export const AGENT_LOCATIONS = ['desk', 'meeting', 'copa', 'board', 'entrance'] as const;
export type AgentLocation = (typeof AGENT_LOCATIONS)[number];

export const RUN_MODES = ['sim', 'real'] as const;
export type RunMode = (typeof RUN_MODES)[number];
