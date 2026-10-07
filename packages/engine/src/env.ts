import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunMode } from '@office/contracts';
import { dockerAvailable, LOCAL_ENV_FILE, maskKey, readLocalEnv, resolveProvider, type KeySource } from './setup';

// Configuração por variáveis de ambiente (.env na raiz). Tudo tem padrão sensato:
// sem chave a empresa roda em simulação e a tela inicial pede a chave da OpenAI
// (salva em .env.local); sem DATABASE_URL usa PGlite, sem REDIS_URL barramento
// em memória, e o Temporal dev server local.

function findRoot(): string {
  if (process.env.OFFICE_ROOT) return path.resolve(process.env.OFFICE_ROOT);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const ROOT = findRoot();

let envLoaded = false;
export function loadDotEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const file = path.join(ROOT, '.env');
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      // .env malformado não derruba a empresa
    }
  }
}

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name).toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(v);
}

export type ProviderId = 'openai' | 'sim';
export type RuntimeId = 'sim' | 'toolloop' | 'agents';
export type SandboxId = 'local' | 'docker';

export interface Env {
  root: string;
  configDir: string;
  dataDir: string;
  mode: RunMode;
  provider: ProviderId;
  workerRuntime: RuntimeId;
  sandbox: SandboxId;
  /** Por que o sandbox não é o esperado para o modo (ex.: Docker fora do ar). */
  sandboxNote: string | null;
  sandboxImage: string;
  openai: { apiKey: string; baseURL: string | null; project: string | null };
  setup: { required: boolean; explicit: boolean; keySource: KeySource | null; keyHint: string | null; localEnvFile: string };
  databaseUrl: string | null;
  redisUrl: string | null;
  temporal: { address: string; namespace: string; taskQueue: string; uiUrl: string | null };
  embedWorker: boolean;
  http: { host: string; port: number; token: string | null; corsOrigin: string };
  sim: { speed: number; seed: number };
  finance: { pollSeconds: number; stagnationMinutes: number; morFeePct: number; morFeeFixedUsd: number };
  integrations: {
    polar: { token: string; organizationId: string | null; server: 'production' | 'sandbox' } | null;
    lemonsqueezy: { apiKey: string; storeId: string | null } | null;
    paddle: { apiKey: string; sandbox: boolean } | null;
    posthog: { host: string; projectId: string; apiKey: string } | null;
    tavily: { apiKey: string } | null;
    firecrawl: { apiKey: string } | null;
    github: { token: string; repo: string } | null;
    langfuse: { host: string; publicKey: string; secretKey: string } | null;
    otlpEndpoint: string | null;
  };
  deployCommand: string | null;
  maxWorkerTurns: number;
  version: string;
}

export function readEnv(): Env {
  loadDotEnv();
  // Modo real é escolha explícita: uma chave solta no ambiente global não basta
  // para a empresa começar a gastar (ver resolveProvider).
  const localEnvFile = path.join(ROOT, LOCAL_ENV_FILE);
  const choice = resolveProvider({
    explicit: str('LLM_PROVIDER'),
    localKey: readLocalEnv(localEnvFile).OPENAI_API_KEY ?? '',
    envKey: str('OPENAI_API_KEY'),
  });
  const provider: ProviderId = choice.provider;
  const apiKey = choice.apiKey;
  const mode: RunMode = provider === 'sim' ? 'sim' : 'real';
  const workerRuntime = (str('WORKER_RUNTIME') || (mode === 'sim' ? 'sim' : 'toolloop')) as RuntimeId;
  // Modo real isola os comandos dos agentes em Docker sem rede. Sem Docker no ar,
  // cai para o sandbox local (só `node`, ambiente sem chaves) e avisa na interface.
  let sandbox = str('SANDBOX') as SandboxId | '';
  let sandboxNote: string | null = null;
  if (!sandbox) {
    if (mode === 'sim') sandbox = 'local';
    else if (dockerAvailable()) sandbox = 'docker';
    else {
      sandbox = 'local';
      sandboxNote =
        'Docker fora do ar: comandos dos agentes rodam nesta máquina (só node, ambiente sem chaves). Ligue o Docker e reinicie para isolar.';
    }
  }
  const databaseUrl = str('DATABASE_URL') || null;

  const polarToken = str('POLAR_ACCESS_TOKEN');
  const lsKey = str('LEMONSQUEEZY_API_KEY');
  const paddleKey = str('PADDLE_API_KEY');
  const phKey = str('POSTHOG_PERSONAL_API_KEY');
  const lfPub = str('LANGFUSE_PUBLIC_KEY');
  const lfSec = str('LANGFUSE_SECRET_KEY');
  const ghToken = str('GITHUB_TOKEN');
  const ghRepo = str('GITHUB_REPO');

  return {
    root: ROOT,
    configDir: path.resolve(ROOT, str('CONFIG_DIR', 'config')),
    dataDir: path.resolve(ROOT, str('DATA_DIR', '.data')),
    mode,
    provider,
    workerRuntime,
    sandbox,
    sandboxNote,
    sandboxImage: str('SANDBOX_IMAGE', 'node:22-alpine'),
    openai: { apiKey, baseURL: str('OPENAI_BASE_URL') || null, project: str('OPENAI_PROJECT') || null },
    setup: {
      required: choice.setupRequired,
      explicit: choice.explicit,
      keySource: choice.keySource,
      keyHint: apiKey ? maskKey(apiKey) : null,
      localEnvFile,
    },
    databaseUrl,
    redisUrl: str('REDIS_URL') || null,
    temporal: {
      address: str('TEMPORAL_ADDRESS', 'localhost:7233'),
      namespace: str('TEMPORAL_NAMESPACE', 'default'),
      taskQueue: str('TEMPORAL_TASK_QUEUE', 'pixel-office'),
      uiUrl: str('TEMPORAL_UI_URL', 'http://localhost:8233') || null,
    },
    // PGlite só aceita um processo; nesse caso o worker roda dentro do servidor.
    embedWorker: databaseUrl ? bool('EMBED_WORKER', true) : true,
    http: {
      host: str('HOST', '127.0.0.1'),
      port: num('PORT', 4000),
      token: str('OFFICE_TOKEN') || null,
      corsOrigin: str('CORS_ORIGIN', 'http://localhost:5173'),
    },
    sim: { speed: Math.max(0.1, num('SIM_SPEED', 1)), seed: num('SIM_SEED', 0) },
    finance: {
      pollSeconds: num('FINANCE_POLL_SECONDS', mode === 'sim' ? 3 : 900),
      stagnationMinutes: num('STAGNATION_MINUTES', mode === 'sim' ? 1.5 : 24 * 60),
      morFeePct: num('MOR_FEE_PCT', 0.05),
      morFeeFixedUsd: num('MOR_FEE_FIXED_USD', 0.5),
    },
    integrations: {
      polar: polarToken
        ? {
            token: polarToken,
            organizationId: str('POLAR_ORGANIZATION_ID') || null,
            server: str('POLAR_SERVER', 'production') === 'sandbox' ? 'sandbox' : 'production',
          }
        : null,
      lemonsqueezy: lsKey ? { apiKey: lsKey, storeId: str('LEMONSQUEEZY_STORE_ID') || null } : null,
      paddle: paddleKey ? { apiKey: paddleKey, sandbox: bool('PADDLE_SANDBOX', false) } : null,
      posthog: phKey ? { host: str('POSTHOG_HOST', 'https://us.posthog.com'), projectId: str('POSTHOG_PROJECT_ID'), apiKey: phKey } : null,
      tavily: str('TAVILY_API_KEY') ? { apiKey: str('TAVILY_API_KEY') } : null,
      firecrawl: str('FIRECRAWL_API_KEY') ? { apiKey: str('FIRECRAWL_API_KEY') } : null,
      github: ghToken && ghRepo ? { token: ghToken, repo: ghRepo } : null,
      langfuse: lfPub && lfSec ? { host: str('LANGFUSE_HOST', 'http://localhost:3000'), publicKey: lfPub, secretKey: lfSec } : null,
      otlpEndpoint: str('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') || null,
    },
    deployCommand: str('DEPLOY_COMMAND') || null,
    maxWorkerTurns: num('MAX_WORKER_TURNS', 24),
    version: '0.1.0',
  };
}
