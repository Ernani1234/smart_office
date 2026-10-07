import { spawn } from 'node:child_process';
import path from 'node:path';
import type { SandboxId } from '../env';

// Execução de comandos dos agentes e do CI. Regras de segurança:
// - ambiente limpo: nenhuma chave de API entra no processo (a recomendação é
//   manter a chave fora do sandbox do agente);
// - no modo real o padrão é Docker sem rede e com limite de memória/CPU;
// - modo local só roda `node` e precisa ser escolhido explicitamente.

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
}

export interface Sandbox {
  readonly kind: SandboxId;
  exec(cwd: string, argv: string[], opts?: { timeoutMs?: number; network?: boolean }): Promise<ExecResult>;
}

const MAX_OUTPUT = 200_000;

function cleanEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ComSpec',
    'PATHEXT',
  ];
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(cmd, args, { cwd, env: cleanEnv(), shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${err.message}`, ms: Date.now() - started, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, ms: Date.now() - started, timedOut });
    });
  });
}

const LOCAL_ALLOWED = new Set(['node']);

export class LocalSandbox implements Sandbox {
  readonly kind = 'local' as const;
  async exec(cwd: string, argv: string[], opts: { timeoutMs?: number } = {}): Promise<ExecResult> {
    const [cmd, ...args] = argv;
    if (!cmd || !LOCAL_ALLOWED.has(cmd)) {
      return { code: 126, stdout: '', stderr: `Comando não permitido no sandbox local: ${cmd}. Permitido: node.`, ms: 0, timedOut: false };
    }
    const bin = cmd === 'node' ? process.execPath : cmd;
    return run(bin, args, cwd, opts.timeoutMs ?? 120_000);
  }
}

export class DockerSandbox implements Sandbox {
  readonly kind = 'docker' as const;
  constructor(private readonly image: string) {}

  async exec(cwd: string, argv: string[], opts: { timeoutMs?: number; network?: boolean } = {}): Promise<ExecResult> {
    const mount = path.resolve(cwd);
    const args = [
      'run',
      '--rm',
      '--network',
      opts.network ? 'bridge' : 'none',
      '--memory',
      '1g',
      '--cpus',
      '1',
      '--pids-limit',
      '256',
      '-v',
      `${mount}:/workspace`,
      '-w',
      '/workspace',
      this.image,
      ...argv,
    ];
    return run('docker', args, cwd, opts.timeoutMs ?? 180_000);
  }
}

export function createSandbox(kind: SandboxId, image: string): Sandbox {
  return kind === 'docker' ? new DockerSandbox(image) : new LocalSandbox();
}

/** Divide "node --test test/a.test.js" em argv, respeitando aspas. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}
