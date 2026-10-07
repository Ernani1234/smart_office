import { OfficeEventSchema, type NewEvent, type OfficeEvent } from '@office/contracts';
import type { EventBus } from '../bus';
import { iso, type Db, type Queryable } from './db';

interface EventRow {
  id: number;
  ts: unknown;
  type: string;
  mission_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  data: unknown;
}

function toEvent(row: EventRow): OfficeEvent {
  return {
    id: Number(row.id),
    ts: iso(row.ts),
    type: row.type,
    missionId: row.mission_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    data: row.data,
  } as OfficeEvent;
}

// Log de eventos imutável. Gravar valida contra o schema (bug vira erro na hora,
// não um escritório corrompido) e publica no barramento depois do commit.
export class EventStore {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
  ) {}

  async insert(q: Queryable, events: NewEvent[]): Promise<OfficeEvent[]> {
    const out: OfficeEvent[] = [];
    for (const e of events) {
      const rows = await q.query<EventRow>(
        `insert into events (type, mission_id, task_id, agent_id, data)
         values ($1, $2, $3, $4, $5)
         returning id, ts, type, mission_id, task_id, agent_id, data`,
        [e.type, e.missionId ?? null, e.taskId ?? null, e.agentId ?? null, JSON.stringify(e.data)],
      );
      const event = toEvent(rows[0]);
      const check = OfficeEventSchema.safeParse(event);
      if (!check.success) {
        throw new Error(`Evento inválido (${e.type}): ${check.error.message}`);
      }
      out.push(event);
    }
    return out;
  }

  async append(input: NewEvent | NewEvent[]): Promise<OfficeEvent[]> {
    const events = Array.isArray(input) ? input : [input];
    if (events.length === 0) return [];
    const saved = await this.db.tx((q) => this.insert(q, events));
    await this.bus.publish(saved);
    return saved;
  }

  async publish(events: OfficeEvent[]): Promise<void> {
    await this.bus.publish(events);
  }

  async list(opts: { after?: number; missionId?: string | null; limit?: number; types?: string[] } = {}): Promise<OfficeEvent[]> {
    const params: unknown[] = [opts.after ?? 0];
    let where = 'id > $1';
    if (opts.missionId) {
      params.push(opts.missionId);
      where += ` and (mission_id = $${params.length} or mission_id is null)`;
    }
    if (opts.types?.length) {
      params.push(opts.types);
      where += ` and type = any($${params.length})`;
    }
    params.push(Math.min(Math.max(opts.limit ?? 2000, 1), 10_000));
    const rows = await this.db.query<EventRow>(
      `select id, ts, type, mission_id, task_id, agent_id, data from events where ${where} order by id asc limit $${params.length}`,
      params,
    );
    return rows.map(toEvent);
  }

  async lastId(): Promise<number> {
    const rows = await this.db.query<{ id: number | null }>('select max(id) as id from events');
    return Number(rows[0]?.id ?? 0);
  }

  async latestOfType(type: string, missionId: string | null): Promise<OfficeEvent | null> {
    const rows = await this.db.query<EventRow>(
      `select id, ts, type, mission_id, task_id, agent_id, data from events
       where type = $1 and ($2::text is null or mission_id = $2) order by id desc limit 1`,
      [type, missionId],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }
}
