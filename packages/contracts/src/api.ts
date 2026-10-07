import { z } from 'zod';
import type { CostKind, RevenueSourceId, RunMode } from './enums';
import type { Pricing } from './pricing';
import type { RolesFile } from './roles';
import type { AgentSpec } from './logic/roster';

// Formatos trocados entre a API (Fastify) e os painéis (React).

export interface HealthDto {
  ok: boolean;
  temporal: boolean;
  mode: RunMode;
  setupRequired: boolean;
}

/** Configuração inicial: a chave da OpenAI que liga o modo real. */
export interface SetupStatus {
  /** Nenhum modo escolhido ainda: a tela inicial pede a chave. */
  required: boolean;
  /** A chave pode ser salva/trocada pela interface. */
  canConfigure: boolean;
  /** Por que não dá (ex.: LLM_PROVIDER definido no ambiente). */
  lockedReason: string | null;
  keySource: 'ui' | 'env' | null;
  /** Chave mascarada (sk-proj-…a1B2); a chave inteira nunca sai do servidor. */
  keyHint: string | null;
  /** Aviso sobre o isolamento dos comandos dos agentes (ex.: Docker fora do ar). */
  sandboxNote: string | null;
}

export const SetupKeySchema = z.object({
  apiKey: z.string().min(1).max(500),
  /** Salva mesmo faltando acesso a algum modelo dos cargos. */
  force: z.boolean().optional(),
});

export interface ServerConfig {
  mode: RunMode;
  companyName: string;
  version: string;
  provider: string;
  workerRuntime: string;
  sandbox: string;
  temporal: { address: string; namespace: string; connected: boolean; uiUrl: string | null };
  storage: 'pglite' | 'postgres';
  bus: 'memory' | 'redis';
  revenueSources: RevenueSourceId[];
  paused: boolean;
  authRequired: boolean;
  roles: RolesFile;
  roster: AgentSpec[];
  pricing: Pricing;
  integrations: Record<string, boolean>;
  setup: SetupStatus;
}

export interface LedgerEntryDto {
  id: number;
  ts: string;
  missionId: string | null;
  kind: CostKind | 'revenue';
  amountUsd: number;
  agentId: string | null;
  role: string | null;
  team: string | null;
  model: string | null;
  taskId: string | null;
  note: string | null;
}

export interface WikiPageDto {
  slug: string;
  title: string;
  body: string;
  tags: string[];
  kind: string;
  missionId: string | null;
  createdAt: string;
  updatedAt: string;
  score?: number;
}

export interface RepoTreeEntry {
  path: string;
  size: number;
}

export interface TaskDiffDto {
  taskId: string;
  branch: string | null;
  diff: string;
  files: { path: string; additions: number; deletions: number }[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}

/** Mensagens do WebSocket servidor → cliente. */
export type WsServerMessage =
  | { type: 'hello'; serverTime: string; mode: RunMode; paused: boolean; lastEventId: number }
  | { type: 'events'; events: import('./events').OfficeEvent[]; backlog: boolean }
  | { type: 'backlog_done'; lastEventId: number }
  | { type: 'ping'; t: number };
