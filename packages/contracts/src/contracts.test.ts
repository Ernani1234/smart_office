import { describe, expect, it } from 'vitest';
import { CeoDirectiveOutSchema, DeliveryReportOutSchema, ReviewVerdictOutSchema } from './documents';
import { toStrictJsonSchema } from './json-schema';
import { RolesFileSchema } from './roles';
import { buildRoster } from './logic/roster';
import { OfficeEventSchema, type OfficeEvent } from './events';
import { applyEvents, createState } from './projection';

function everyObjectIsStrict(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(everyObjectIsStrict);
  if (!node || typeof node !== 'object') return true;
  const n = node as Record<string, unknown>;
  if (n.type === 'object') {
    const props = Object.keys((n.properties as object) ?? {});
    const req = (n.required as string[]) ?? [];
    if (n.additionalProperties !== false) return false;
    if (props.length !== req.length || !props.every((p) => req.includes(p))) return false;
  }
  return Object.values(n).every(everyObjectIsStrict);
}

describe('JSON Schema estrito', () => {
  it.each([
    ['delivery', DeliveryReportOutSchema],
    ['verdict', ReviewVerdictOutSchema],
    ['directive', CeoDirectiveOutSchema],
  ])('%s: required total e additionalProperties false', (_, schema) => {
    const js = toStrictJsonSchema(schema);
    expect(js.type).toBe('object');
    expect(everyObjectIsStrict(js)).toBe(true);
    expect(JSON.stringify(js)).not.toContain('"default"');
  });
});

const roles = {
  version: 1,
  company: { name: 'Pixel Corp' },
  teams: {
    diretoria: { name: 'Diretoria', color: '#8b7cf6' },
    engenharia: { name: 'Engenharia', color: '#38bdf8' },
    produto: { name: 'Produto', color: '#34d399' },
  },
  roles: {
    ceo: { title: 'CEO', team: 'diretoria', level: 'executive', model: 'gpt-6-astra', taskBudgetUsd: 2 },
    'lead-engenharia': { title: 'Tech Lead', team: 'engenharia', level: 'lead', model: 'gpt-6.1-sol', taskBudgetUsd: 1 },
    dev: {
      title: 'Dev',
      team: 'engenharia',
      level: 'worker',
      model: 'gpt-6-luna',
      taskBudgetUsd: 0.3,
      instances: 2,
      tools: ['workspace', 'shell'],
      escalation: { model: 'gpt-6.1-sol' },
    },
  },
  overrides: { 'dev-2': { model: 'gpt-6.1-sol' } },
};

describe('roles.yaml', () => {
  it('valida e monta o elenco com mesas e promoções', () => {
    const file = RolesFileSchema.parse(roles);
    const roster = buildRoster(file);
    expect(roster.map((a) => a.id)).toEqual(['ceo', 'lead-engenharia', 'dev-1', 'dev-2']);
    expect(roster.find((a) => a.id === 'dev-2')?.model).toBe('gpt-6.1-sol');
    expect(roster.find((a) => a.id === 'dev-1')?.desk).toBe('desk:engenharia:1');
    expect(roster.find((a) => a.id === 'lead-engenharia')?.desk).toBe('lead:engenharia');
    expect(new Set(roster.map((a) => a.name)).size).toBe(roster.length);
  });

  it('quem lê a internet não pode ter ferramenta de escrita', () => {
    const bad = structuredClone(roles) as typeof roles & { roles: Record<string, unknown> };
    bad.roles.pesquisa = {
      title: 'Pesquisa',
      team: 'produto',
      level: 'worker',
      model: 'gpt-6-luna',
      taskBudgetUsd: 0.1,
      tools: ['web', 'workspace'],
    };
    bad.roles['lead-produto'] = { title: 'PM', team: 'produto', level: 'lead', model: 'gpt-6.1-sol', taskBudgetUsd: 1 };
    const r = RolesFileSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Isolamento');
  });

  it('time com trabalhadores e sem líder é rejeitado (sem gerente de gerente, mas com gerente)', () => {
    const bad = structuredClone(roles) as typeof roles & { roles: Record<string, unknown> };
    delete (bad.roles as Record<string, unknown>)['lead-engenharia'];
    expect(RolesFileSchema.safeParse(bad).success).toBe(false);
  });
});

describe('projeção', () => {
  it('reconstrói o escritório a partir do log e é idempotente', () => {
    let id = 0;
    const ts = (s: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, s)).toISOString();
    const mk = (e: Omit<OfficeEvent, 'id' | 'ts'>, sec: number) => OfficeEventSchema.parse({ ...e, id: ++id, ts: ts(sec) });
    const refs = { missionId: 'm1', taskId: null, agentId: null };
    const events: OfficeEvent[] = [
      mk(
        {
          ...refs,
          missionId: null,
          agentId: 'dev-1',
          type: 'agent.hired',
          data: {
            name: 'Ana',
            roleId: 'dev',
            title: 'Dev',
            team: 'engenharia',
            level: 'worker',
            model: 'gpt-6-luna',
            effort: 'high',
            billing: 'standard',
            desk: 'desk:engenharia:1',
            seed: 1,
          },
        } as never,
        0,
      ),
      mk(
        {
          ...refs,
          type: 'mission.created',
          data: {
            title: 'Teste',
            brief: '...',
            metric: 'net_profit',
            goalUsd: 100,
            spendCapUsd: 10,
            deadline: ts(999),
            revenueSource: 'sim',
          },
        } as never,
        1,
      ),
      mk(
        {
          ...refs,
          taskId: 't1',
          type: 'task.created',
          data: {
            title: 'Construir',
            team: 'engenharia',
            role: 'dev',
            kind: 'build',
            parentId: null,
            workOrder: {
              id: 't1',
              missionId: 'm1',
              team: 'engenharia',
              role: 'dev',
              kind: 'build',
              title: 'Construir',
              objective: 'x',
              context: 'y',
              acceptanceCriteria: ['testes passam'],
              budgetUsd: 0.3,
              inputs: [],
              constraints: [],
            },
          },
        } as never,
        2,
      ),
      mk(
        {
          ...refs,
          taskId: 't1',
          type: 'task.assigned',
          data: { assignee: 'dev-1', reviewer: 'lead-engenharia', model: 'gpt-6-luna', effort: 'high' },
        } as never,
        3,
      ),
      mk(
        {
          ...refs,
          taskId: 't1',
          agentId: 'dev-1',
          type: 'cost.recorded',
          data: {
            entryId: 1,
            amountUsd: 0.25,
            kind: 'llm',
            model: 'gpt-6-luna',
            billing: 'standard',
            role: 'dev',
            team: 'engenharia',
            tokens: { input: 1000, cached: 0, cacheWrite: 0, output: 500, reasoning: 100 },
            note: null,
          },
        } as never,
        4,
      ),
      mk(
        { ...refs, type: 'revenue.recorded', data: { entryId: 2, orderId: 'o1', grossUsd: 19, netUsd: 17.55, source: 'sim' } } as never,
        5,
      ),
      mk(
        {
          ...refs,
          taskId: 't1',
          agentId: 'dev-1',
          type: 'task.completed',
          data: { status: 'done', summary: 'ok', costUsd: 0.25 },
        } as never,
        6,
      ),
    ];
    const s = createState();
    applyEvents(s, events);
    applyEvents(s, events); // idempotente
    expect(s.tasks.t1.status).toBe('done');
    expect(s.agents['dev-1'].location).toBe('copa');
    expect(s.agents['dev-1'].costUsd).toBeCloseTo(0.25);
    expect(s.finance.m1.netUsd).toBeCloseTo(17.3);
    expect(s.finance._all.sales).toBe(1);
    expect(s.feed.length).toBeGreaterThan(3);
  });
});
