import {
  microsToUsd,
  newEvent,
  type BillingMode,
  type CostKind,
  type LedgerEntryDto,
  type OfficeEvent,
  type RevenueSourceId,
  type TokenUsage,
} from '@office/contracts';
import { iso, type Db } from './db';
import type { EventStore } from './event-store';

// Livro-caixa: cada centavo gasto ou recebido vira uma linha com sinal
// (custo negativo, receita positiva) e um evento, na mesma transação.

export interface CostEntry {
  missionId: string | null;
  taskId: string | null;
  agentId: string | null;
  role: string | null;
  team: string | null;
  kind: CostKind;
  model: string | null;
  billing: BillingMode | null;
  micros: number;
  usage?: TokenUsage | null;
  note?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface RevenueEntry {
  missionId: string;
  orderId: string;
  grossMicros: number;
  netMicros: number;
  source: RevenueSourceId;
  ts?: string;
}

export interface Totals {
  spentMicros: number;
  revenueMicros: number;
  netMicros: number;
  sales: number;
}

export class Ledger {
  constructor(
    private readonly db: Db,
    private readonly events: EventStore,
  ) {}

  async recordCost(c: CostEntry): Promise<OfficeEvent[]> {
    if (c.micros <= 0) return [];
    const saved = await this.db.tx(async (q) => {
      const rows = await q.query<{ id: number }>(
        `insert into ledger (mission_id, kind, amount_micros, agent_id, role, team, model, task_id, note, detail)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          c.missionId,
          c.kind,
          -Math.abs(c.micros),
          c.agentId,
          c.role,
          c.team,
          c.model,
          c.taskId,
          c.note ?? null,
          c.detail ? JSON.stringify(c.detail) : null,
        ],
      );
      const u = c.usage;
      return this.events.insert(q, [
        newEvent(
          'cost.recorded',
          {
            entryId: Number(rows[0].id),
            amountUsd: microsToUsd(Math.abs(c.micros)),
            kind: c.kind,
            model: c.model,
            billing: c.billing,
            role: c.role,
            team: c.team,
            tokens: u
              ? {
                  input: u.inputTokens,
                  cached: u.cachedTokens,
                  cacheWrite: u.cacheWriteTokens,
                  output: u.outputTokens,
                  reasoning: u.reasoningTokens,
                }
              : null,
            note: c.note ?? null,
          },
          { missionId: c.missionId, taskId: c.taskId, agentId: c.agentId },
        ),
      ]);
    });
    await this.events.publish(saved);
    return saved;
  }

  /** Idempotente por pedido: reler a API do meio de pagamento não duplica receita. */
  async recordRevenue(r: RevenueEntry): Promise<boolean> {
    const saved = await this.db.tx(async (q) => {
      const rows = await q.query<{ id: number }>(
        `insert into ledger (mission_id, kind, amount_micros, external_id, note, detail, ts)
         values ($1, 'revenue', $2, $3, $4, $5, coalesce($6::timestamptz, now()))
         on conflict (kind, external_id) where external_id is not null do nothing
         returning id`,
        [
          r.missionId,
          r.netMicros,
          `${r.source}:${r.orderId}`,
          `venda ${r.orderId}`,
          JSON.stringify({ grossMicros: r.grossMicros, source: r.source }),
          r.ts ?? null,
        ],
      );
      if (rows.length === 0) return [];
      return this.events.insert(q, [
        newEvent(
          'revenue.recorded',
          {
            entryId: Number(rows[0].id),
            orderId: r.orderId,
            grossUsd: microsToUsd(r.grossMicros),
            netUsd: microsToUsd(r.netMicros),
            source: r.source,
          },
          { missionId: r.missionId },
        ),
      ]);
    });
    await this.events.publish(saved);
    return saved.length > 0;
  }

  async totals(missionId: string | null): Promise<Totals> {
    const rows = await this.db.query<{ spent: number | null; revenue: number | null; sales: number | null }>(
      `select
         coalesce(sum(case when amount_micros < 0 then -amount_micros else 0 end), 0)::bigint as spent,
         coalesce(sum(case when kind = 'revenue' then amount_micros else 0 end), 0)::bigint as revenue,
         count(*) filter (where kind = 'revenue')::bigint as sales
       from ledger where ($1::text is null or mission_id = $1)`,
      [missionId],
    );
    const spent = Number(rows[0]?.spent ?? 0);
    const revenue = Number(rows[0]?.revenue ?? 0);
    return { spentMicros: spent, revenueMicros: revenue, netMicros: revenue - spent, sales: Number(rows[0]?.sales ?? 0) };
  }

  async taskSpentMicros(taskId: string): Promise<number> {
    const rows = await this.db.query<{ spent: number | null }>(
      `select coalesce(sum(-amount_micros), 0)::bigint as spent from ledger where task_id = $1 and amount_micros < 0`,
      [taskId],
    );
    return Number(rows[0]?.spent ?? 0);
  }

  async lastRevenueAt(missionId: string): Promise<string | null> {
    const rows = await this.db.query<{ ts: unknown }>(`select max(ts) as ts from ledger where mission_id = $1 and kind = 'revenue'`, [
      missionId,
    ]);
    return rows[0]?.ts ? iso(rows[0].ts) : null;
  }

  async entries(missionId: string | null, limit = 200): Promise<LedgerEntryDto[]> {
    const rows = await this.db.query<{
      id: number;
      ts: unknown;
      mission_id: string | null;
      kind: string;
      amount_micros: number;
      agent_id: string | null;
      role: string | null;
      team: string | null;
      model: string | null;
      task_id: string | null;
      note: string | null;
    }>(
      `select id, ts, mission_id, kind, amount_micros, agent_id, role, team, model, task_id, note
       from ledger where ($1::text is null or mission_id = $1) order by id desc limit $2`,
      [missionId, limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      ts: iso(r.ts),
      missionId: r.mission_id,
      kind: r.kind as LedgerEntryDto['kind'],
      amountUsd: microsToUsd(Number(r.amount_micros)),
      agentId: r.agent_id,
      role: r.role,
      team: r.team,
      model: r.model,
      taskId: r.task_id,
      note: r.note,
    }));
  }
}
