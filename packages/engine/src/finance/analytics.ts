import type { Env } from '../env';

// O que o time de Growth enxerga: visitas, cadastros e checkouts. PostHog via
// HogQL (chave pessoal só de leitura); no modo simulação o mercado publica
// snapshots próprios.

export interface AnalyticsSnapshot {
  visits: number;
  signups: number;
  checkouts: number;
}

export interface AnalyticsSource {
  readonly id: string;
  snapshot(sinceIso: string): Promise<AnalyticsSnapshot | null>;
}

export class PostHogAnalytics implements AnalyticsSource {
  readonly id = 'posthog';
  constructor(private readonly cfg: NonNullable<Env['integrations']['posthog']>) {}

  async snapshot(sinceIso: string): Promise<AnalyticsSnapshot | null> {
    const since = sinceIso.replace('T', ' ').slice(0, 19);
    const query = `select
      countIf(event = '$pageview') as visits,
      countIf(event = 'signup') as signups,
      countIf(event = 'checkout_started') as checkouts
      from events where timestamp >= toDateTime('${since}')`;
    const res = await fetch(`${this.cfg.host.replace(/\/$/, '')}/api/projects/${this.cfg.projectId}/query/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: number[][] };
    const row = data.results?.[0];
    if (!row) return null;
    return { visits: Number(row[0] ?? 0), signups: Number(row[1] ?? 0), checkouts: Number(row[2] ?? 0) };
  }
}

export function createAnalytics(env: Env): AnalyticsSource | null {
  return env.integrations.posthog ? new PostHogAnalytics(env.integrations.posthog) : null;
}
