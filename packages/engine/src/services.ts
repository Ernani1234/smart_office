import { newEvent, type OfficeEvent, type Role, type RevenueSourceId } from '@office/contracts';
import { createRedisBus, MemoryBus, type EventBus } from './bus';
import { PricingStore, PromptStore, RolesStore } from './config/stores';
import { openDb, type Db } from './db/db';
import { EventStore } from './db/event-store';
import { Ledger } from './db/ledger';
import { EMBEDDING_DIM } from './db/migrations';
import { ApprovalRepo, MessageRepo, MissionRepo, SettingsRepo, SimOrderRepo, WikiRepo } from './db/repos';
import { readEnv, type Env } from './env';
import { createAnalytics, type AnalyticsSource } from './finance/analytics';
import { createRevenueSources, type RevenueSource } from './finance/revenue';
import { SimMarket } from './finance/sim-market';
import { HashEmbedder } from './llm/embeddings';
import { LlmGateway } from './llm/gateway';
import { OpenAIEmbedder, OpenAIProvider } from './llm/openai';
import { SimProvider } from './llm/sim/provider';
import type { Embedder, LlmProvider } from './llm/types';
import { CiRunner } from './repo/ci';
import { RepoManager } from './repo/git';
import { GitHubRemote } from './repo/github';
import { AgentsApiRuntime } from './runtime/agents-api';
import { DesignerRuntime } from './runtime/designer';
import { SimWorkerRuntime } from './runtime/sim';
import { ToolLoopRuntime } from './runtime/toolloop';
import type { WorkerRuntime } from './runtime/types';
import { createSandbox, type Sandbox } from './sandbox/exec';
import { createTelemetry, type Telemetry } from './telemetry';
import { createLogger, type Logger } from './util';

// Monta a empresa: banco, barramento, livro-caixa, configs, provedores e
// runtimes. Servidor e worker chamam isto; no modo local, os dois dividem a
// mesma instância dentro de um processo.

export interface Services {
  env: Env;
  log: Logger;
  db: Db;
  bus: EventBus;
  events: EventStore;
  ledger: Ledger;
  missions: MissionRepo;
  approvals: ApprovalRepo;
  wiki: WikiRepo;
  messages: MessageRepo;
  settings: SettingsRepo;
  simOrders: SimOrderRepo;
  roles: RolesStore;
  pricing: PricingStore;
  prompts: PromptStore;
  llm: LlmProvider;
  embedder: Embedder;
  gateway: LlmGateway;
  sandbox: Sandbox;
  repos: RepoManager;
  ci: CiRunner;
  github: GitHubRemote | null;
  revenue: Map<RevenueSourceId, RevenueSource>;
  analytics: AnalyticsSource | null;
  telemetry: Telemetry;
  market: SimMarket;
  runtimeFor(role: Role): WorkerRuntime;
  /** Contrata/atualiza os agentes do roles.yaml no log de eventos. */
  syncStaff(): Promise<OfficeEvent[]>;
  close(): Promise<void>;
}

export async function createServices(env: Env = readEnv()): Promise<Services> {
  const log = createLogger('empresa');
  const db = await openDb({ databaseUrl: env.databaseUrl, dataDir: env.dataDir });
  const bus: EventBus = env.redisUrl ? await createRedisBus(env.redisUrl) : new MemoryBus();
  const events = new EventStore(db, bus);
  const ledger = new Ledger(db, events);
  const missions = new MissionRepo(db);
  const approvals = new ApprovalRepo(db);
  const wiki = new WikiRepo(db);
  const messages = new MessageRepo(db);
  const settings = new SettingsRepo(db);
  const simOrders = new SimOrderRepo(db);
  const roles = new RolesStore(env.configDir);
  const pricing = new PricingStore(env.configDir);
  const prompts = new PromptStore(env.configDir);
  roles.get();
  pricing.get();

  let llm: LlmProvider;
  let embedder: Embedder;
  let openai: OpenAIProvider | null = null;
  if (env.provider === 'openai') {
    openai = new OpenAIProvider(env.openai);
    llm = openai;
    embedder = new OpenAIEmbedder(openai.raw, EMBEDDING_DIM);
  } else {
    llm = new SimProvider(env.sim.speed);
    embedder = new HashEmbedder(EMBEDDING_DIM);
  }

  const telemetry = await createTelemetry(env);
  const gateway = new LlmGateway({ llm, roles, pricing, prompts, ledger, events, settings, missions, telemetry });
  const sandbox = createSandbox(env.sandbox, env.sandboxImage);
  // Vários workers (modo completo) → git da main serializado entre processos.
  const repoLock =
    db.kind === 'postgres'
      ? <T>(key: string, fn: () => Promise<T>) =>
          db.tx(async (q) => {
            await q.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
            return fn();
          })
      : null;
  const repos = new RepoManager(env.dataDir, repoLock);
  const ci = new CiRunner(sandbox);
  const github = env.integrations.github ? new GitHubRemote(env.integrations.github) : null;
  const revenue = createRevenueSources(env, simOrders);
  const analytics = createAnalytics(env);
  // Missões com receita "sim" vendem no mercado simulado também no modo real
  // (agentes de verdade, clientes fictícios); as demais leem o MoR.
  const market = new SimMarket({ db, missions, orders: simOrders, events, speed: env.sim.speed });

  const sim = new SimWorkerRuntime(gateway, sandbox, env.sim.speed, { ledger, pricing });
  const toolloop = new ToolLoopRuntime({ gateway, sandbox, env, ledger, pricing });
  const designer = new DesignerRuntime({ llm, gateway, ledger, pricing });
  const agents = openai
    ? new AgentsApiRuntime({ client: openai.raw, gateway, ledger, pricing, prompts, roles, containerSize: 'small' })
    : null;

  function runtimeFor(role: Role): WorkerRuntime {
    if (env.workerRuntime === 'sim' || env.provider === 'sim') return sim;
    if (role.kind === 'image') return designer;
    if (env.workerRuntime === 'agents' && agents && role.tools.includes('shell')) return agents;
    return toolloop;
  }

  async function syncStaff(): Promise<OfficeEvent[]> {
    const roster = roles.roster();
    const rows = await db.query<{ agent_id: string; data: Record<string, unknown> }>(
      `select distinct on (agent_id) agent_id, data from events where type = 'agent.hired' order by agent_id, id desc`,
    );
    const last = new Map(rows.map((r) => [r.agent_id, r.data]));
    const fresh = roster.filter((a) => {
      const prev = last.get(a.id);
      return (
        !prev ||
        prev.model !== a.model ||
        prev.effort !== a.effort ||
        prev.name !== a.name ||
        prev.title !== a.title ||
        prev.desk !== a.desk ||
        prev.billing !== a.billing
      );
    });
    return events.append(
      fresh.map((a) =>
        newEvent(
          'agent.hired',
          {
            name: a.name,
            roleId: a.roleId,
            title: a.title,
            team: a.team,
            level: a.level,
            model: a.model,
            effort: a.effort,
            billing: a.billing,
            desk: a.desk,
            seed: a.seed,
          },
          { agentId: a.id },
        ),
      ),
    );
  }

  return {
    env,
    log,
    db,
    bus,
    events,
    ledger,
    missions,
    approvals,
    wiki,
    messages,
    settings,
    simOrders,
    roles,
    pricing,
    prompts,
    llm,
    embedder,
    gateway,
    sandbox,
    repos,
    ci,
    github,
    revenue,
    analytics,
    telemetry,
    market,
    runtimeFor,
    syncStaff,
    async close() {
      market.stop();
      await telemetry.shutdown().catch(() => undefined);
      await bus.close();
      await db.close();
    },
  };
}
