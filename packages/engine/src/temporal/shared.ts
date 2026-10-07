// Nomes e formatos compartilhados entre workflows, atividades e o cliente (API).
// Sem imports de runtime: seguro dentro do sandbox determinístico do Temporal.

import type { AgentSpec } from '@office/contracts/logic';
import type { CeoOrder, DeliveryReport, TeamReport, WorkOrder } from '@office/contracts';

export const SIGNALS = {
  pause: 'pause',
  resume: 'resume',
  approval: 'approval',
} as const;

export const QUERIES = {
  status: 'status',
} as const;

export const WORKFLOWS = {
  mission: 'missionWorkflow',
  team: 'teamWorkflow',
  task: 'taskWorkflow',
} as const;

/** Tipos de falha que nunca devem ser repetidos automaticamente. */
export const FAILURES = {
  missionBudget: 'MissionBudgetExceeded',
  taskBudget: 'TaskBudgetExceeded',
  unknownModel: 'UnknownModel',
  invalidConfig: 'InvalidConfig',
} as const;

export interface ApprovalDecisionMsg {
  approvalId: string;
  approved: boolean;
  note: string | null;
}

export interface MissionInfo {
  id: string;
  title: string;
  goalUsd: number;
  spendCapUsd: number;
  deadline: string;
  launched: boolean;
  simMode: boolean;
  financePollMs: number;
  stagnationMs: number;
  approvalTimeoutMs: number;
  maxCycles: number;
  rules: {
    maxReviewRounds: number;
    ciFailuresBeforePromotion: number;
    maxRespecs: number;
  };
}

export interface FinanceStatus {
  spentUsd: number;
  revenueUsd: number;
  netUsd: number;
  sales: number;
  budgetLeftUsd: number;
  goalReached: boolean;
  lastSaleAt: string | null;
}

export interface PlannedAssignment {
  taskId: string;
  workOrder: WorkOrder;
  assignee: AgentSpec;
  reviewer: AgentSpec;
  /** Quem escreve no repositório passa pelos portões de CI. */
  needsCi: boolean;
}

export interface TeamInput {
  missionId: string;
  cycle: number;
  order: CeoOrder;
  rules: MissionInfo['rules'];
}

export interface TaskInput {
  missionId: string;
  taskId: string;
  parentId: string | null;
  workOrder: WorkOrder;
  assignee: AgentSpec;
  reviewer: AgentSpec;
  rules: MissionInfo['rules'];
  /** Times sem escrita (pesquisa) não passam por CI; tudo passa por revisão. */
  needsCi: boolean;
}

export interface TaskResult {
  taskId: string;
  title: string;
  status: 'done' | 'failed' | 'cancelled';
  summary: string;
  costUsd: number;
  ref: string | null;
  report: DeliveryReport | null;
}

export interface WorkflowStatus {
  phase: string;
  paused: boolean;
  cycle?: number;
  children?: string[];
}

export type { TeamReport };
