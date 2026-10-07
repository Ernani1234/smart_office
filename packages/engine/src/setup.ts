import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';

// Configuração inicial: a única coisa que o escritório pede é a chave da OpenAI.
// A tela inicial manda a chave para a API, que confere com a OpenAI (listar
// modelos é gratuito) e guarda em `.env.local` na raiz — fora do git e da imagem
// Docker. A chave nunca volta para o navegador nem entra no ambiente dos
// comandos dos agentes (o sandbox roda com ambiente limpo).

export const LOCAL_ENV_FILE = '.env.local';
const KEY_VAR = 'OPENAI_API_KEY';
const HEADER = '# Gerado pela tela inicial do escritório. Não versionar.';
const KEY_LINE = new RegExp(`^\\s*(?:export\\s+)?${KEY_VAR}\\s*=`);

/** Lê KEY=valor (aspas e comentários tolerados) sem mexer em process.env. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function readLocalEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  try {
    return parseEnvText(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Grava (ou remove, com `null`) a chave em `.env.local`, preservando o resto do arquivo. */
export function writeLocalKey(file: string, key: string | null): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((l) => !KEY_LINE.test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (key) {
    if (!kept.includes(HEADER)) kept.unshift(HEADER);
    kept.push(`${KEY_VAR}=${key}`);
  }
  if (!kept.some((l) => l.trim() && !l.trim().startsWith('#'))) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  writeFileSync(file, `${kept.join('\n')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignora permissões POSIX
  }
}

/** Aceita a chave colada como `sk-…`, `"sk-…"` ou `OPENAI_API_KEY=sk-…`. */
export function normalizeKey(input: string): string {
  return input
    .trim()
    .replace(/^(?:export\s+)?OPENAI_API_KEY\s*=\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

export function keyLooksValid(key: string): boolean {
  return /^[\x21-\x7e]{20,400}$/.test(key);
}

export function maskKey(key: string): string {
  if (key.length < 16) return '••••';
  const prefix = /^sk-(?:proj|svcacct|admin)-/.exec(key)?.[0] ?? (key.startsWith('sk-') ? 'sk-' : '');
  return `${prefix}…${key.slice(-4)}`;
}

export type KeySource = 'ui' | 'env';

export interface ProviderChoice {
  provider: 'openai' | 'sim';
  apiKey: string;
  keySource: KeySource | null;
  /** Nenhum modo escolhido ainda: a tela inicial pede a chave. */
  setupRequired: boolean;
  /** LLM_PROVIDER no ambiente manda; a interface não troca o modo. */
  explicit: boolean;
}

/**
 * Quem decide o modo, em ordem:
 * 1. LLM_PROVIDER=sim no ambiente → simulação (testes, e2e, CI);
 * 2. LLM_PROVIDER=openai → real, com a chave da tela inicial ou OPENAI_API_KEY;
 * 3. chave salva pela tela inicial → real;
 * 4. nada → simulação enquanto a tela inicial pede a chave. Uma OPENAI_API_KEY
 *    solta no ambiente global não liga o modo real sozinha (pode ser de outro
 *    projeto): gastar exige escolha explícita.
 */
export function resolveProvider(input: { explicit: string; localKey: string; envKey: string }): ProviderChoice {
  const explicit = input.explicit.trim().toLowerCase();
  if (explicit && explicit !== 'openai' && explicit !== 'sim') throw new Error(`LLM_PROVIDER inválido: ${input.explicit}`);
  const localKey = input.localKey.trim();
  if (explicit === 'sim') return { provider: 'sim', apiKey: '', keySource: null, setupRequired: false, explicit: true };
  if (explicit === 'openai') {
    const apiKey = localKey || input.envKey.trim();
    if (!apiKey) throw new Error('LLM_PROVIDER=openai exige OPENAI_API_KEY (no .env ou pela tela inicial)');
    return { provider: 'openai', apiKey, keySource: localKey ? 'ui' : 'env', setupRequired: false, explicit: true };
  }
  if (localKey) return { provider: 'openai', apiKey: localKey, keySource: 'ui', setupRequired: false, explicit: false };
  return { provider: 'sim', apiKey: '', keySource: null, setupRequired: true, explicit: false };
}

export interface KeyCheck {
  ok: boolean;
  status: 'ok' | 'unverified' | 'invalid' | 'unreachable' | 'error';
  message: string;
  /** Modelos que a chave enxerga; null quando não deu para listar. */
  models: string[] | null;
}

/** Confere a chave listando modelos (não consome créditos). */
export async function checkOpenAIKey(
  apiKey: string,
  opts: { baseURL?: string | null; project?: string | null; timeoutMs?: number } = {},
): Promise<KeyCheck> {
  const client = new OpenAI({
    apiKey,
    baseURL: opts.baseURL ?? undefined,
    project: opts.project ?? undefined,
    maxRetries: 1,
    timeout: opts.timeoutMs ?? 20_000,
  });
  try {
    const models: string[] = [];
    for await (const m of client.models.list()) models.push(m.id);
    return { ok: true, status: 'ok', message: `${models.length} modelos disponíveis`, models };
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) {
      return {
        ok: false,
        status: 'invalid',
        message: 'A OpenAI recusou a chave (401). Confira se copiou a chave inteira e se ela não foi revogada.',
        models: null,
      };
    }
    if (err instanceof OpenAI.PermissionDeniedError) {
      // Chave restrita sem leitura de modelos ainda serve; bloqueio de região não.
      if (/country|region|territory/i.test(err.message)) return { ok: false, status: 'invalid', message: err.message, models: null };
      return {
        ok: true,
        status: 'unverified',
        message: 'Chave aceita, mas sem permissão para listar modelos: não deu para conferir o acesso a cada modelo.',
        models: null,
      };
    }
    if (err instanceof OpenAI.APIConnectionError) {
      return { ok: false, status: 'unreachable', message: `Não consegui falar com a OpenAI: ${err.message}`, models: null };
    }
    return { ok: false, status: 'error', message: `A OpenAI respondeu: ${(err as Error).message}`, models: null };
  }
}

/** Docker utilizável (CLI instalada e daemon no ar)? */
export function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 6000, windowsHide: true, encoding: 'utf8' });
  return r.status === 0 && Boolean(r.stdout?.trim());
}
