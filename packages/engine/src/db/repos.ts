import {
  microsToUsd,
  usdToMicros,
  type ApprovalKind,
  type CreateMission,
  type EndReason,
  type MissionStatus,
  type RevenueSourceId,
  type WikiPageDto,
} from '@office/contracts';
import { iso, isoOrNull, type Db } from './db';

// ---------------------------------------------------------------- missões

export interface MissionRecord {
  id: string;
  title: string;
  brief: string;
  goalUsd: number;
  spendCapUsd: number;
  goalMicros: number;
  capMicros: number;
  deadline: string;
  revenueSource: RevenueSourceId;
  status: MissionStatus;
  workflowId: string | null;
  createdAt: string;
  endedAt: string | null;
  endReason: EndReason | null;
  launchedAt: string | null;
  product: { name: string; url: string | null; priceUsd: number | null } | null;
}

interface MissionRow {
  id: string;
  title: string;
  brief: string;
  goal_micros: number;
  cap_micros: number;
  deadline: unknown;
  revenue_source: string;
  status: string;
  workflow_id: string | null;
  created_at: unknown;
  ended_at: unknown;
  end_reason: string | null;
  launched_at: unknown;
  product: MissionRecord['product'];
}

function toMission(r: MissionRow): MissionRecord {
  return {
    id: r.id,
    title: r.title,
    brief: r.brief,
    goalMicros: Number(r.goal_micros),
    capMicros: Number(r.cap_micros),
    goalUsd: microsToUsd(Number(r.goal_micros)),
    spendCapUsd: microsToUsd(Number(r.cap_micros)),
    deadline: iso(r.deadline),
    revenueSource: r.revenue_source as RevenueSourceId,
    status: r.status as MissionStatus,
    workflowId: r.workflow_id,
    createdAt: iso(r.created_at),
    endedAt: isoOrNull(r.ended_at),
    endReason: r.end_reason as EndReason | null,
    launchedAt: isoOrNull(r.launched_at),
    product: r.product,
  };
}

export class MissionRepo {
  constructor(private readonly db: Db) {}

  async create(id: string, m: CreateMission): Promise<MissionRecord> {
    const rows = await this.db.query<MissionRow>(
      `insert into missions (id, title, brief, goal_micros, cap_micros, deadline, revenue_source, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'created') returning *`,
      [id, m.title, m.brief, usdToMicros(m.goalUsd), usdToMicros(m.spendCapUsd), m.deadline, m.revenueSource],
    );
    return toMission(rows[0]);
  }

  async get(id: string): Promise<MissionRecord | null> {
    const rows = await this.db.query<MissionRow>('select * from missions where id = $1', [id]);
    return rows[0] ? toMission(rows[0]) : null;
  }

  async list(): Promise<MissionRecord[]> {
    const rows = await this.db.query<MissionRow>('select * from missions order by created_at desc');
    return rows.map(toMission);
  }

  async running(): Promise<MissionRecord[]> {
    const rows = await this.db.query<MissionRow>(
      `select * from missions where status in ('created', 'running', 'waiting') order by created_at asc`,
    );
    return rows.map(toMission);
  }

  async setStatus(id: string, status: MissionStatus): Promise<void> {
    await this.db.query('update missions set status = $2 where id = $1', [id, status]);
  }

  async setWorkflow(id: string, workflowId: string): Promise<void> {
    await this.db.query(`update missions set workflow_id = $2, status = 'running' where id = $1`, [id, workflowId]);
  }

  async markLaunched(id: string, product: NonNullable<MissionRecord['product']>): Promise<void> {
    await this.db.query(`update missions set launched_at = coalesce(launched_at, now()), product = $2, status = 'waiting' where id = $1`, [
      id,
      JSON.stringify(product),
    ]);
  }

  async end(id: string, reason: EndReason): Promise<void> {
    const status: MissionStatus = reason === 'goal_reached' ? 'completed' : reason === 'cancelled' ? 'cancelled' : 'failed';
    await this.db.query('update missions set status = $2, end_reason = $3, ended_at = now() where id = $1', [id, status, reason]);
  }
}

// ---------------------------------------------------------------- aprovações

export interface ApprovalRecord {
  id: string;
  missionId: string | null;
  taskId: string | null;
  kind: ApprovalKind;
  title: string;
  detail: string;
  amountUsd: number | null;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  note: string | null;
  workflowId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

interface ApprovalRow {
  id: string;
  mission_id: string | null;
  task_id: string | null;
  kind: string;
  title: string;
  detail: string;
  amount_micros: number | null;
  requested_by: string;
  status: string;
  note: string | null;
  workflow_id: string | null;
  created_at: unknown;
  decided_at: unknown;
}

function toApproval(r: ApprovalRow): ApprovalRecord {
  return {
    id: r.id,
    missionId: r.mission_id,
    taskId: r.task_id,
    kind: r.kind as ApprovalKind,
    title: r.title,
    detail: r.detail,
    amountUsd: r.amount_micros === null ? null : microsToUsd(Number(r.amount_micros)),
    requestedBy: r.requested_by,
    status: r.status as ApprovalRecord['status'],
    note: r.note,
    workflowId: r.workflow_id,
    createdAt: iso(r.created_at),
    decidedAt: isoOrNull(r.decided_at),
  };
}

export class ApprovalRepo {
  constructor(private readonly db: Db) {}

  async create(a: Omit<ApprovalRecord, 'status' | 'note' | 'createdAt' | 'decidedAt'>): Promise<ApprovalRecord> {
    const rows = await this.db.query<ApprovalRow>(
      `insert into approvals (id, mission_id, task_id, kind, title, detail, amount_micros, requested_by, workflow_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set workflow_id = excluded.workflow_id
       returning *`,
      [
        a.id,
        a.missionId,
        a.taskId,
        a.kind,
        a.title,
        a.detail,
        a.amountUsd === null ? null : usdToMicros(a.amountUsd),
        a.requestedBy,
        a.workflowId,
      ],
    );
    return toApproval(rows[0]);
  }

  async get(id: string): Promise<ApprovalRecord | null> {
    const rows = await this.db.query<ApprovalRow>('select * from approvals where id = $1', [id]);
    return rows[0] ? toApproval(rows[0]) : null;
  }

  async list(status?: string): Promise<ApprovalRecord[]> {
    const rows = await this.db.query<ApprovalRow>(
      `select * from approvals where ($1::text is null or status = $1) order by created_at desc limit 200`,
      [status ?? null],
    );
    return rows.map(toApproval);
  }

  /** Só decide pendentes; devolve null se já decidido (evita sinal duplicado). */
  async decide(id: string, approved: boolean, note: string | null): Promise<ApprovalRecord | null> {
    const rows = await this.db.query<ApprovalRow>(
      `update approvals set status = $2, note = $3, decided_at = now()
       where id = $1 and status = 'pending' returning *`,
      [id, approved ? 'approved' : 'rejected', note],
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }

  async expire(id: string): Promise<void> {
    await this.db.query(`update approvals set status = 'expired', decided_at = now() where id = $1 and status = 'pending'`, [id]);
  }
}

// ---------------------------------------------------------------- wiki

interface WikiRow {
  slug: string;
  title: string;
  body: string;
  tags: string[];
  kind: string;
  mission_id: string | null;
  created_at: unknown;
  updated_at: unknown;
  score?: number;
}

function toWiki(r: WikiRow): WikiPageDto {
  return {
    slug: r.slug,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    kind: r.kind,
    missionId: r.mission_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...(r.score !== undefined ? { score: Number(r.score) } : {}),
  };
}

export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}

export class WikiRepo {
  constructor(private readonly db: Db) {}

  async upsert(p: {
    slug: string;
    title: string;
    body: string;
    tags: string[];
    kind: string;
    missionId: string | null;
    embedding: number[] | null;
  }): Promise<void> {
    await this.db.query(
      `insert into wiki_pages (slug, title, body, tags, kind, mission_id, embedding)
       values ($1, $2, $3, $4, $5, $6, $7::vector)
       on conflict (slug) do update set title = excluded.title, body = excluded.body, tags = excluded.tags,
         kind = excluded.kind, embedding = excluded.embedding, updated_at = now()`,
      [p.slug, p.title, p.body, p.tags, p.kind, p.missionId, p.embedding ? vectorLiteral(p.embedding) : null],
    );
  }

  async get(slug: string): Promise<WikiPageDto | null> {
    const rows = await this.db.query<WikiRow>(
      'select slug, title, body, tags, kind, mission_id, created_at, updated_at from wiki_pages where slug = $1',
      [slug],
    );
    return rows[0] ? toWiki(rows[0]) : null;
  }

  async list(): Promise<WikiPageDto[]> {
    const rows = await this.db.query<WikiRow>(
      'select slug, title, body, tags, kind, mission_id, created_at, updated_at from wiki_pages order by updated_at desc limit 500',
    );
    return rows.map(toWiki);
  }

  /** Busca semântica (cosseno no pgvector) com reforço de texto. */
  async search(embedding: number[] | null, text: string, limit = 8): Promise<WikiPageDto[]> {
    if (embedding) {
      const rows = await this.db.query<WikiRow>(
        `select slug, title, body, tags, kind, mission_id, created_at, updated_at,
                (1 - (embedding <=> $1::vector)) + case when title ilike $2 or body ilike $2 then 0.25 else 0 end as score
         from wiki_pages where embedding is not null
         order by score desc limit $3`,
        [vectorLiteral(embedding), `%${text}%`, limit],
      );
      return rows.map(toWiki);
    }
    const rows = await this.db.query<WikiRow>(
      `select slug, title, body, tags, kind, mission_id, created_at, updated_at, 1.0 as score
       from wiki_pages where title ilike $1 or body ilike $1 order by updated_at desc limit $2`,
      [`%${text}%`, limit],
    );
    return rows.map(toWiki);
  }
}

// ---------------------------------------------------------------- recados

export class MessageRepo {
  constructor(private readonly db: Db) {}

  async add(agentId: string, taskId: string | null, body: string): Promise<void> {
    await this.db.query('insert into agent_messages (agent_id, task_id, body) values ($1, $2, $3)', [agentId, taskId, body]);
  }

  /** Recados pendentes para o agente (marca como lidos). */
  async take(agentId: string): Promise<string[]> {
    const rows = await this.db.query<{ body: string }>(
      `update agent_messages set consumed_at = now()
       where agent_id = $1 and consumed_at is null returning body`,
      [agentId],
    );
    return rows.map((r) => r.body);
  }
}

// ---------------------------------------------------------------- configurações

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.query<{ value: T }>('select value from settings where key = $1', [key]);
    return rows[0] ? rows[0].value : fallback;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.query(
      `insert into settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }

  async isPaused(): Promise<boolean> {
    return this.get<boolean>('paused', false);
  }
}

// ---------------------------------------------------------------- mercado simulado

export interface SimOrder {
  id: string;
  missionId: string;
  createdAt: string;
  grossCents: number;
  feeCents: number;
  status: string;
}

export class SimOrderRepo {
  constructor(private readonly db: Db) {}

  async insert(o: { id: string; missionId: string; grossCents: number; feeCents: number }): Promise<void> {
    await this.db.query(`insert into sim_orders (id, mission_id, gross_cents, fee_cents) values ($1, $2, $3, $4) on conflict do nothing`, [
      o.id,
      o.missionId,
      o.grossCents,
      o.feeCents,
    ]);
  }

  async list(missionId: string): Promise<SimOrder[]> {
    const rows = await this.db.query<{
      id: string;
      mission_id: string;
      created_at: unknown;
      gross_cents: number;
      fee_cents: number;
      status: string;
    }>('select * from sim_orders where mission_id = $1 order by created_at asc', [missionId]);
    return rows.map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      createdAt: iso(r.created_at),
      grossCents: Number(r.gross_cents),
      feeCents: Number(r.fee_cents),
      status: r.status,
    }));
  }

  async count(missionId: string): Promise<number> {
    const rows = await this.db.query<{ c: number }>('select count(*)::int as c from sim_orders where mission_id = $1', [missionId]);
    return Number(rows[0]?.c ?? 0);
  }
}
