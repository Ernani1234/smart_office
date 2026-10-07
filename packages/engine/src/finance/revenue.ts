import { usdToMicros, type RevenueSourceId } from '@office/contracts';
import type { Env } from '../env';
import type { SimOrderRepo } from '../db/repos';

// A métrica oficial da Missão vem do meio de pagamento (merchant-of-record), lida
// por código com chave SÓ de leitura. Cada fonte devolve pedidos normalizados com
// valor bruto e líquido (depois de taxas e impostos).

export interface NormalizedOrder {
  id: string;
  createdAt: string;
  grossMicros: number;
  netMicros: number;
}

export interface RevenueSource {
  readonly id: RevenueSourceId;
  /** Pedidos pagos (reembolsos já descontados) criados a partir de `since`. */
  listOrders(missionId: string, since: string): Promise<NormalizedOrder[]>;
}

function feeAdjusted(env: Env, grossUsd: number): number {
  return Math.max(0, grossUsd - grossUsd * env.finance.morFeePct - env.finance.morFeeFixedUsd);
}

class SimRevenueSource implements RevenueSource {
  readonly id = 'sim' as const;
  constructor(private readonly orders: SimOrderRepo) {}
  async listOrders(missionId: string, since: string): Promise<NormalizedOrder[]> {
    const sinceMs = Date.parse(since);
    return (await this.orders.list(missionId))
      .filter((o) => o.status === 'paid' && Date.parse(o.createdAt) >= sinceMs)
      .map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        grossMicros: o.grossCents * 10_000,
        netMicros: (o.grossCents - o.feeCents) * 10_000,
      }));
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Polar: GET /v1/orders (token de organização com escopo orders:read). */
class PolarRevenueSource implements RevenueSource {
  readonly id = 'polar' as const;
  constructor(
    private readonly env: Env,
    private readonly cfg: NonNullable<Env['integrations']['polar']>,
  ) {}
  async listOrders(_missionId: string, since: string): Promise<NormalizedOrder[]> {
    const base = this.cfg.server === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
    const out: NormalizedOrder[] = [];
    for (let page = 1; page <= 20; page++) {
      const qs = new URLSearchParams({ page: String(page), limit: '100', sorting: '-created_at' });
      if (this.cfg.organizationId) qs.set('organization_id', this.cfg.organizationId);
      const data = (await getJson(`${base}/v1/orders/?${qs}`, { authorization: `Bearer ${this.cfg.token}` })) as {
        items?: Record<string, unknown>[];
      };
      const items = data.items ?? [];
      let reachedOld = false;
      for (const o of items) {
        const created = String(o.created_at ?? '');
        if (Date.parse(created) < Date.parse(since)) {
          reachedOld = true;
          continue;
        }
        const status = String(o.status ?? 'paid');
        if (status !== 'paid' && status !== 'partially_refunded') continue;
        const totalCents = Number(o.total_amount ?? o.amount ?? 0);
        const taxCents = Number(o.tax_amount ?? 0);
        const refundedCents = Number(o.refunded_amount ?? 0);
        const grossUsd = (totalCents - refundedCents) / 100;
        const netUsd = feeAdjusted(this.env, (totalCents - taxCents - refundedCents) / 100);
        out.push({ id: String(o.id), createdAt: created, grossMicros: usdToMicros(grossUsd), netMicros: usdToMicros(netUsd) });
      }
      if (reachedOld || items.length < 100) break;
    }
    return out;
  }
}

/** Lemon Squeezy: GET /v1/orders (JSON:API). Taxa do MoR estimada por configuração. */
class LemonSqueezyRevenueSource implements RevenueSource {
  readonly id = 'lemonsqueezy' as const;
  constructor(
    private readonly env: Env,
    private readonly cfg: NonNullable<Env['integrations']['lemonsqueezy']>,
  ) {}
  async listOrders(_missionId: string, since: string): Promise<NormalizedOrder[]> {
    const out: NormalizedOrder[] = [];
    let url: string | null =
      `https://api.lemonsqueezy.com/v1/orders?page[size]=100${this.cfg.storeId ? `&filter[store_id]=${this.cfg.storeId}` : ''}`;
    for (let i = 0; url && i < 20; i++) {
      const data = (await getJson(url, {
        accept: 'application/vnd.api+json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      })) as { data?: { id: string; attributes: Record<string, unknown> }[]; links?: { next?: string | null } };
      for (const o of data.data ?? []) {
        const a = o.attributes;
        const created = String(a.created_at ?? '');
        if (Date.parse(created) < Date.parse(since)) continue;
        if (a.status !== 'paid' || a.refunded) continue;
        const totalUsd = Number(a.total_usd ?? a.total ?? 0) / 100;
        const taxUsd = Number(a.tax_usd ?? a.tax ?? 0) / 100;
        out.push({
          id: o.id,
          createdAt: created,
          grossMicros: usdToMicros(totalUsd),
          netMicros: usdToMicros(feeAdjusted(this.env, totalUsd - taxUsd)),
        });
      }
      url = data.links?.next ?? null;
    }
    return out;
  }
}

/** Paddle Billing: GET /transactions?status=completed. `earnings` já é líquido. */
class PaddleRevenueSource implements RevenueSource {
  readonly id = 'paddle' as const;
  constructor(private readonly cfg: NonNullable<Env['integrations']['paddle']>) {}
  async listOrders(_missionId: string, since: string): Promise<NormalizedOrder[]> {
    const base = this.cfg.sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
    const out: NormalizedOrder[] = [];
    let url: string | null = `${base}/transactions?status=completed&per_page=100&created_at[GTE]=${encodeURIComponent(since)}`;
    for (let i = 0; url && i < 20; i++) {
      const data = (await getJson(url, { authorization: `Bearer ${this.cfg.apiKey}` })) as {
        data?: Record<string, unknown>[];
        meta?: { pagination?: { next?: string; has_more?: boolean } };
      };
      for (const t of data.data ?? []) {
        const details = (t.details ?? {}) as Record<string, Record<string, string>>;
        const totals = details.payout_totals ?? details.totals ?? {};
        // Valores em menor unidade monetária (centavos), como string.
        const grossUsd = Number(totals.total ?? 0) / 100;
        const netUsd = Number(totals.earnings ?? 0) / 100;
        out.push({ id: String(t.id), createdAt: String(t.created_at), grossMicros: usdToMicros(grossUsd), netMicros: usdToMicros(netUsd) });
      }
      const p = data.meta?.pagination;
      url = p?.has_more && p.next ? p.next : null;
    }
    return out;
  }
}

export function createRevenueSources(env: Env, simOrders: SimOrderRepo): Map<RevenueSourceId, RevenueSource> {
  const sources = new Map<RevenueSourceId, RevenueSource>();
  sources.set('sim', new SimRevenueSource(simOrders));
  if (env.integrations.polar) sources.set('polar', new PolarRevenueSource(env, env.integrations.polar));
  if (env.integrations.lemonsqueezy) sources.set('lemonsqueezy', new LemonSqueezyRevenueSource(env, env.integrations.lemonsqueezy));
  if (env.integrations.paddle) sources.set('paddle', new PaddleRevenueSource(env.integrations.paddle));
  return sources;
}
