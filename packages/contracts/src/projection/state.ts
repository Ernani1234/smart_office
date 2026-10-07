import type {
  AgentActivity,
  AgentLocation,
  ApprovalKind,
  ApprovalStatus,
  BillingMode,
  Effort,
  EndReason,
  Level,
  MissionStatus,
  RevenueSourceId,
  RunMode,
  TaskKind,
  TaskStatus,
} from '../enums';
import type { ChangeRequest } from '../documents';

// Estado do escritório = projeção do log de eventos. Nada aqui é fonte da
// verdade: dá para jogar fora e reconstruir reaplicando os eventos.

export interface Bubble {
  text: string;
  ts: string;
  kind: 'speech' | 'thought' | 'alert' | 'success' | 'money';
}

export interface ToolCallView {
  callId: string;
  tool: string;
  label: string;
  ok: boolean | null;
  summary: string | null;
  ms: number | null;
  ts: string;
}

export interface FileChangeView {
  path: string;
  op: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  ts: string;
  taskId: string | null;
}

export interface ChatLine {
  ts: string;
  from: 'board' | 'agent';
  text: string;
}

export interface AgentView {
  id: string;
  name: string;
  roleId: string;
  title: string;
  team: string;
  level: Level;
  model: string;
  effort: Effort;
  billing: BillingMode;
  desk: string;
  seed: number;
  activity: AgentActivity;
  location: AgentLocation;
  taskId: string | null;
  bubble: Bubble | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
  thoughts: { ts: string; text: string; taskId: string | null }[];
  tools: ToolCallView[];
  files: FileChangeView[];
  chat: ChatLine[];
  promotedFrom: string | null;
  hasWorked: boolean;
  tasksDone: number;
  lastActiveTs: string | null;
}

export interface TaskView {
  id: string;
  missionId: string | null;
  parentId: string | null;
  team: string;
  role: string;
  kind: TaskKind;
  title: string;
  objective: string;
  acceptance: string[];
  budgetUsd: number;
  status: TaskStatus;
  assignee: string | null;
  reviewer: string | null;
  model: string | null;
  attempt: number;
  round: number;
  ciFailures: number;
  respecs: number;
  escalations: number;
  ci: { runId: string; ok: boolean | null; checks: { name: string; ok: boolean; ms: number; tail: string }[] } | null;
  costUsd: number;
  verdict: { approved: boolean; summary: string; changes: ChangeRequest[] } | null;
  delivery: { summary: string; risks: string[]; questions: string[]; done: string[] } | null;
  pr: { branch: string; url: string | null; commit: string; merged: boolean } | null;
  files: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalView {
  id: string;
  missionId: string | null;
  taskId: string | null;
  kind: ApprovalKind;
  title: string;
  detail: string;
  amountUsd: number | null;
  requestedBy: string;
  status: ApprovalStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface FinancePoint {
  ts: string;
  spentUsd: number;
  revenueUsd: number;
}

export interface FinanceView {
  spentUsd: number;
  revenueUsd: number;
  grossUsd: number;
  netUsd: number;
  sales: number;
  byModel: Record<string, number>;
  byTeam: Record<string, number>;
  byRole: Record<string, number>;
  byKind: Record<string, number>;
  series: FinancePoint[];
}

export interface MissionView {
  id: string;
  title: string;
  brief: string;
  goalUsd: number;
  spendCapUsd: number;
  deadline: string;
  revenueSource: RevenueSourceId;
  status: MissionStatus;
  cycle: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  endReason: EndReason | null;
  lastDecision: string | null;
  launched: boolean;
  product: string | null;
  productUrl: string | null;
  priceUsd: number | null;
  budgetWarned: boolean;
  analytics: { visits: number; signups: number; checkouts: number } | null;
}

export type FeedKind = 'info' | 'success' | 'warning' | 'error' | 'money' | 'board';

export interface FeedItem {
  id: number;
  ts: string;
  kind: FeedKind;
  icon: string;
  text: string;
  agentId: string | null;
  missionId: string | null;
  taskId: string | null;
}

export interface CompanyState {
  lastEventId: number;
  lastTs: string | null;
  mode: RunMode | null;
  companyName: string;
  paused: boolean;
  missions: Record<string, MissionView>;
  missionOrder: string[];
  activeMissionId: string | null;
  agents: Record<string, AgentView>;
  agentOrder: string[];
  tasks: Record<string, TaskView>;
  taskOrder: string[];
  approvals: Record<string, ApprovalView>;
  /** Por missão; a chave "_all" soma tudo. */
  finance: Record<string, FinanceView>;
  ci: { running: boolean; runId: string | null; lastOk: boolean | null; taskId: string | null; ts: string | null };
  wiki: { slug: string; title: string; kind: string; ts: string }[];
  feed: FeedItem[];
}

export function createFinance(): FinanceView {
  return {
    spentUsd: 0,
    revenueUsd: 0,
    grossUsd: 0,
    netUsd: 0,
    sales: 0,
    byModel: {},
    byTeam: {},
    byRole: {},
    byKind: {},
    series: [],
  };
}

export function createState(): CompanyState {
  return {
    lastEventId: 0,
    lastTs: null,
    mode: null,
    companyName: 'Pixel Corp',
    paused: false,
    missions: {},
    missionOrder: [],
    activeMissionId: null,
    agents: {},
    agentOrder: [],
    tasks: {},
    taskOrder: [],
    approvals: {},
    finance: { _all: createFinance() },
    ci: { running: false, runId: null, lastOk: null, taskId: null, ts: null },
    wiki: [],
    feed: [],
  };
}
