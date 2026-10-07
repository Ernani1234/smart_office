import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CeoDirectiveOutSchema, microsToUsd } from '@office/contracts';
import { readEnv } from '../env';
import { createServices, type Services } from '../services';
import { BudgetExceededError } from './gateway';

// O dinheiro é contado por código: o gateway recusa a chamada ANTES de gastar
// quando o pior caso estoura o teto, e registra o custo exato depois.

let s: Services;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pixel-gw-'));
  const env = {
    ...readEnv(),
    provider: 'sim' as const,
    mode: 'sim' as const,
    workerRuntime: 'sim' as const,
    dataDir: dir,
    databaseUrl: null,
    redisUrl: null,
  };
  env.sim = { speed: 50, seed: 0 };
  s = await createServices(env);
}, 60_000);

afterAll(async () => {
  await s?.close();
  rmSync(dir, { recursive: true, force: true });
});

const ceoCall = (missionId: string) =>
  s.gateway.structured(
    { missionId, taskId: null, agentId: 'ceo', taskBudgetUsd: null },
    {
      roleId: 'ceo',
      name: 'ceo.decide',
      schemaName: 'ceo_directive',
      schema: CeoDirectiveOutSchema,
      input: 'Missão de teste',
      maxOutputTokens: 12_000,
      sim: { purpose: 'ceo.decide', trigger: 'start', teams: ['produto', 'engenharia'], cycle: 0, launched: false },
    },
  );

describe('gateway de modelos', () => {
  it('registra o custo exato no livro-caixa e emite cost.recorded', async () => {
    await s.missions.create('m-ok', {
      title: 'ok',
      brief: 'teste do gateway',
      goalUsd: 100,
      spendCapUsd: 10,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      revenueSource: 'sim',
    });
    const r = await ceoCall('m-ok');
    expect(r.value.decision).toBe('delegate');
    const totals = await s.ledger.totals('m-ok');
    expect(totals.spentMicros).toBeGreaterThan(0);
    expect(microsToUsd(totals.spentMicros)).toBeCloseTo(r.costUsd, 6);
    const costs = await s.events.list({ missionId: 'm-ok', types: ['cost.recorded'] });
    expect(costs).toHaveLength(1);
  }, 30_000);

  it('recusa a chamada do Astra quando o pior caso estoura o teto da missão', async () => {
    await s.missions.create('m-cap', {
      title: 'teto baixo',
      brief: 'teste do teto',
      goalUsd: 100,
      spendCapUsd: 0.01,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      revenueSource: 'sim',
    });
    await expect(ceoCall('m-cap')).rejects.toBeInstanceOf(BudgetExceededError);
    const totals = await s.ledger.totals('m-cap');
    expect(totals.spentMicros).toBe(0);
  }, 30_000);

  it('pânico segura a chamada até retomar', async () => {
    await s.settings.set('paused', true);
    let done = false;
    const p = ceoCall('m-ok').then(() => (done = true));
    await new Promise((r) => setTimeout(r, 1500));
    expect(done).toBe(false);
    await s.settings.set('paused', false);
    await p;
    expect(done).toBe(true);
  }, 30_000);
});
