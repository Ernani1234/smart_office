import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { templateFiles } from './template';

const pexec = promisify(execFile);

// Repositório da empresa: um repo Git por missão. Cada tarefa ganha um worktree
// e um branch próprios (isolamento entre trabalhadores); o "PR" é o branch, o
// merge na main acontece só depois da revisão aprovada.

export interface FileStat {
  path: string;
  op: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
}

export interface GitIdentity {
  name: string;
  email: string;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k)) delete env[k];
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

export async function git(cwd: string, args: string[], allowFail = false): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await pexec('git', ['-c', 'core.autocrlf=false', '-c', 'core.quotepath=off', ...args], {
      cwd,
      env: gitEnv(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
    if (allowFail) return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message, code: typeof e.code === 'number' ? e.code : 1 };
    throw new Error(`git ${args.join(' ')} falhou: ${e.stderr || e.message}`);
  }
}

const ROBOT: GitIdentity = { name: 'Pixel Corp', email: 'bot@pixel.corp' };

/** Ids de missão/tarefa viram nomes de pasta e de branch: nada de `..` ou barras. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id)) throw new Error(`Id inválido: ${id.slice(0, 40)}`);
  return id;
}

function who(id: GitIdentity): string[] {
  return ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`];
}

type LockFn = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export class RepoManager {
  private readonly locks = new Map<string, Promise<unknown>>();

  /**
   * `externalLock` serializa entre processos (advisory lock do Postgres quando há
   * vários workers). Dentro do processo, uma fila por missão já basta.
   */
  constructor(
    private readonly dataDir: string,
    private readonly externalLock: LockFn | null = null,
  ) {}

  /** Operações na main de uma missão nunca rodam em paralelo (git não é concorrente). */
  private withLock<T>(missionId: string, fn: () => Promise<T>): Promise<T> {
    const run = () => (this.externalLock ? this.externalLock(`repo:${missionId}`, fn) : fn());
    const prev = this.locks.get(missionId) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.locks.set(
      missionId,
      next.catch(() => undefined),
    );
    return next;
  }

  /** A main só recebe merges: qualquer estado pela metade é descartado. */
  private async heal(main: string): Promise<void> {
    if (existsSync(path.join(main, '.git', 'MERGE_HEAD'))) await git(main, ['merge', '--abort'], true);
    const dirty = (await git(main, ['status', '--porcelain'], true)).stdout.trim();
    if (dirty || existsSync(path.join(main, '.git', 'MERGE_HEAD'))) {
      await git(main, ['reset', '--hard', 'HEAD'], true);
      await git(main, ['clean', '-fd'], true);
    }
  }

  missionDir(missionId: string): string {
    return path.join(this.dataDir, 'workspaces', safeId(missionId));
  }

  mainDir(missionId: string): string {
    return path.join(this.missionDir(missionId), 'main');
  }

  taskDir(missionId: string, taskId: string): string {
    return path.join(this.missionDir(missionId), 'tasks', safeId(taskId));
  }

  branchOf(taskId: string): string {
    return `task/${safeId(taskId)}`;
  }

  async ensureRepo(missionId: string, product: { name: string; missionTitle: string }): Promise<string> {
    return this.withLock(missionId, () => this.ensureRepoUnlocked(missionId, product));
  }

  private async ensureRepoUnlocked(missionId: string, product: { name: string; missionTitle: string }): Promise<string> {
    const dir = this.mainDir(missionId);
    if (existsSync(path.join(dir, '.git'))) return dir;
    mkdirSync(dir, { recursive: true });
    await git(dir, ['init', '-q', '-b', 'main']);
    for (const [rel, content] of Object.entries(templateFiles(product))) {
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    await git(dir, ['add', '-A']);
    await git(dir, [...who(ROBOT), 'commit', '-q', '-m', 'chore: esqueleto do produto e portões de CI']);
    return dir;
  }

  /** Worktree isolado da tarefa, a partir da main atual. */
  async ensureWorktree(missionId: string, taskId: string): Promise<{ dir: string; branch: string }> {
    return this.withLock(missionId, () => this.ensureWorktreeUnlocked(missionId, taskId));
  }

  private async ensureWorktreeUnlocked(missionId: string, taskId: string): Promise<{ dir: string; branch: string }> {
    const main = this.mainDir(missionId);
    const dir = this.taskDir(missionId, taskId);
    const branch = this.branchOf(taskId);
    if (existsSync(path.join(dir, '.git'))) return { dir, branch };
    mkdirSync(path.dirname(dir), { recursive: true });
    await git(main, ['worktree', 'prune']);
    const exists = (await git(main, ['rev-parse', '--verify', '--quiet', branch], true)).code === 0;
    if (exists) await git(main, ['worktree', 'add', '-q', dir, branch]);
    else await git(main, ['worktree', 'add', '-q', '-b', branch, dir, 'main']);
    return { dir, branch };
  }

  /** Traz a main para dentro do branch da tarefa (retrabalho depois de outro merge). */
  async syncWithMain(missionId: string, dir: string, id: GitIdentity): Promise<boolean> {
    return this.withLock(missionId, async () => {
      const r = await git(dir, [...who(id), 'merge', '-q', '--no-edit', 'main'], true);
      if (r.code !== 0) {
        await git(dir, ['merge', '--abort'], true);
        return false;
      }
      return true;
    });
  }

  /** Conflito real: o branch recomeça da main atual e o trabalho é refeito por cima. */
  async resetToMain(missionId: string, dir: string): Promise<void> {
    await this.withLock(missionId, async () => {
      await git(dir, ['merge', '--abort'], true);
      await git(dir, ['reset', '--hard', 'main']);
      await git(dir, ['clean', '-fd'], true);
    });
  }

  async commitAll(missionId: string, dir: string, message: string, id: GitIdentity): Promise<{ commit: string | null; files: FileStat[] }> {
    return this.withLock(missionId, async () => {
      await git(dir, ['add', '-A']);
      const staged = await git(dir, ['diff', '--cached', '--name-only']);
      if (!staged.stdout.trim()) return { commit: null, files: [] };
      const files = await this.stagedStats(dir);
      await git(dir, [...who(id), 'commit', '-q', '-m', message]);
      const commit = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim();
      return { commit, files };
    });
  }

  private async stagedStats(dir: string): Promise<FileStat[]> {
    const status = await git(dir, ['diff', '--cached', '--name-status']);
    const numstat = await git(dir, ['diff', '--cached', '--numstat']);
    const counts = new Map<string, { add: number; del: number }>();
    for (const line of numstat.stdout.split('\n')) {
      const [a, d, ...rest] = line.split('\t');
      if (!rest.length) continue;
      counts.set(rest.join('\t'), { add: Number(a) || 0, del: Number(d) || 0 });
    }
    const out: FileStat[] = [];
    for (const line of status.stdout.split('\n')) {
      const [code, ...rest] = line.split('\t');
      if (!code || !rest.length) continue;
      const file = rest[rest.length - 1];
      const c = counts.get(file) ?? { add: 0, del: 0 };
      out.push({
        path: file,
        op: code.startsWith('A') ? 'create' : code.startsWith('D') ? 'delete' : 'modify',
        additions: c.add,
        deletions: c.del,
      });
    }
    return out;
  }

  async headCommit(dir: string): Promise<string> {
    return (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim();
  }

  /** Diff do "PR": tudo que o branch tem e a main não. */
  async diff(
    missionId: string,
    taskId: string,
    maxChars = 60_000,
  ): Promise<{ diff: string; files: { path: string; additions: number; deletions: number }[] }> {
    const main = this.mainDir(missionId);
    const branch = this.branchOf(taskId);
    const exists = (await git(main, ['rev-parse', '--verify', '--quiet', branch], true)).code === 0;
    if (!exists) return { diff: '', files: [] };
    const range = `main...${branch}`;
    const d = await git(main, ['diff', '--no-color', range]);
    const n = await git(main, ['diff', '--numstat', range]);
    const files = n.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [a, del, ...rest] = line.split('\t');
        return { path: rest.join('\t'), additions: Number(a) || 0, deletions: Number(del) || 0 };
      });
    const diff = d.stdout.length > maxChars ? `${d.stdout.slice(0, maxChars)}\n… (diff truncado)` : d.stdout;
    return { diff, files };
  }

  /** Diff de um PR já integrado: o que o merge trouxe para a main (M^1..M). */
  async mergedDiff(
    missionId: string,
    mergeCommit: string,
    maxChars = 60_000,
  ): Promise<{ diff: string; files: { path: string; additions: number; deletions: number }[] }> {
    const main = this.mainDir(missionId);
    if (!/^[0-9a-f]{7,40}$/i.test(mergeCommit)) return { diff: '', files: [] };
    const d = await git(main, ['diff', '--no-color', `${mergeCommit}^1`, mergeCommit], true);
    const n = await git(main, ['diff', '--numstat', `${mergeCommit}^1`, mergeCommit], true);
    const files = n.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [a, del, ...rest] = line.split('\t');
        return { path: rest.join('\t'), additions: Number(a) || 0, deletions: Number(del) || 0 };
      });
    const diff = d.stdout.length > maxChars ? `${d.stdout.slice(0, maxChars)}\n… (diff truncado)` : d.stdout;
    return { diff, files };
  }

  /** Integra o PR na main. Conflito = falso (a tarefa volta com a main atualizada). */
  async merge(missionId: string, taskId: string, title: string, id: GitIdentity): Promise<{ ok: boolean; commit: string | null }> {
    return this.withLock(missionId, async () => {
      const main = this.mainDir(missionId);
      const branch = this.branchOf(taskId);
      await this.heal(main);
      const r = await git(main, [...who(id), 'merge', '-q', '--no-ff', branch, '-m', `Merge ${branch}: ${title}`], true);
      if (r.code !== 0) {
        await this.heal(main);
        return { ok: false, commit: null };
      }
      return { ok: true, commit: await this.headCommit(main) };
    });
  }

  async removeWorktree(missionId: string, taskId: string): Promise<void> {
    await this.withLock(missionId, async () => {
      const main = this.mainDir(missionId);
      const dir = this.taskDir(missionId, taskId);
      await git(main, ['worktree', 'remove', '--force', dir], true);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      await git(main, ['worktree', 'prune'], true);
    });
  }

  /** Remove worktrees que sobraram (tarefas canceladas no fim da missão). */
  async cleanupTasks(missionId: string): Promise<void> {
    await this.withLock(missionId, async () => {
      const main = this.mainDir(missionId);
      const tasks = path.join(this.missionDir(missionId), 'tasks');
      if (!existsSync(path.join(main, '.git'))) return;
      if (existsSync(tasks)) rmSync(tasks, { recursive: true, force: true });
      await git(main, ['worktree', 'prune'], true);
      await this.heal(main);
    });
  }

  async tree(missionId: string): Promise<{ path: string; size: number }[]> {
    const main = this.mainDir(missionId);
    if (!existsSync(path.join(main, '.git'))) return [];
    const r = await git(main, ['ls-tree', '-r', '-l', 'main']);
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, file] = line.split('\t');
        const size = Number(meta.trim().split(/\s+/)[3]) || 0;
        return { path: file, size };
      });
  }

  async readFile(missionId: string, file: string, ref = 'main'): Promise<string | null> {
    const main = this.mainDir(missionId);
    if (file.includes('..')) return null;
    const r = await git(main, ['show', `${ref}:${file}`], true);
    return r.code === 0 ? r.stdout : null;
  }

  async log(missionId: string, limit = 30): Promise<{ commit: string; author: string; subject: string; ts: string }[]> {
    const main = this.mainDir(missionId);
    if (!existsSync(path.join(main, '.git'))) return [];
    const r = await git(main, ['log', `-${limit}`, '--pretty=format:%H%x09%an%x09%aI%x09%s', 'main']);
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, author, ts, ...subject] = line.split('\t');
        return { commit, author, ts, subject: subject.join('\t') };
      });
  }
}
