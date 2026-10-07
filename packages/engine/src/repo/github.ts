import { git } from './git';

// Repositório remoto opcional (GITHUB_TOKEN + GITHUB_REPO): cada tarefa vira um
// PR de verdade e o GitHub Actions roda os mesmos portões do ci.json. O token
// fica no nosso processo; nunca entra no sandbox do agente.

export class GitHubRemote {
  constructor(private readonly cfg: { token: string; repo: string }) {}

  private get remote(): string {
    return `https://x-access-token:${this.cfg.token}@github.com/${this.cfg.repo}.git`;
  }

  private scrub(msg: string): string {
    return msg.replaceAll(this.cfg.token, '***');
  }

  private async api(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`https://api.github.com/repos/${this.cfg.repo}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.cfg.token}`,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}: ${String(body.message ?? '')}`);
    return body;
  }

  async pushMain(mainDir: string): Promise<void> {
    const r = await git(mainDir, ['push', '--force', this.remote, 'main:refs/heads/main'], true);
    if (r.code !== 0) throw new Error(this.scrub(r.stderr));
  }

  /** Empurra o branch e abre o PR na primeira vez. Devolve a URL do PR. */
  async pushAndOpen(dir: string, branch: string, title: string, knownUrl: string | null): Promise<string | null> {
    const main = await git(dir, ['push', '--force', this.remote, 'main:refs/heads/main'], true);
    if (main.code !== 0) throw new Error(this.scrub(main.stderr));
    const r = await git(dir, ['push', '--force', this.remote, `HEAD:refs/heads/${branch}`], true);
    if (r.code !== 0) throw new Error(this.scrub(r.stderr));
    if (knownUrl) return knownUrl;
    const pr = await this.api('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title,
        head: branch,
        base: 'main',
        body: 'Aberto pela Pixel Corp. Evidência: CI (ci.json) + parecer de revisão.',
      }),
    });
    return String(pr.html_url ?? '') || null;
  }
}
