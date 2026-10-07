import { describe, expect, it } from 'vitest';
import { afterReview, onCiFailure, type LadderState } from './ladder';
import { planWaves } from './waves';
import { fitToContext } from './context';

const base: LadderState = {
  ciFailures: 0,
  currentModel: 'gpt-6-luna',
  baseModel: 'gpt-6-luna',
  escalationModel: 'gpt-6.1-sol',
  afterCiFailures: 2,
  respecs: 0,
  maxRespecs: 1,
};

describe('escada de modelos', () => {
  it('Luna falha 1× → tenta de novo', () => {
    expect(onCiFailure({ ...base, ciFailures: 1 })).toEqual({ action: 'retry' });
  });
  it('Luna falha 2× → promove ao Sol', () => {
    expect(onCiFailure({ ...base, ciFailures: 2 })).toEqual({ action: 'promote', toModel: 'gpt-6.1-sol' });
  });
  it('Sol falha de novo → volta ao líder para reescrever a especificação', () => {
    expect(onCiFailure({ ...base, ciFailures: 3, currentModel: 'gpt-6.1-sol' })).toEqual({ action: 'respec' });
  });
  it('sem reescritas sobrando → escala ao CEO', () => {
    expect(onCiFailure({ ...base, ciFailures: 3, currentModel: 'gpt-6.1-sol', respecs: 1 })).toEqual({ action: 'escalate_ceo' });
  });
  it('agente já promovido pelo Conselho (base = escalonamento) não fica em loop', () => {
    const s = { ...base, currentModel: 'gpt-6.1-sol', baseModel: 'gpt-6.1-sol' };
    expect(onCiFailure({ ...s, ciFailures: 2 })).toEqual({ action: 'retry' });
    expect(onCiFailure({ ...s, ciFailures: 3 })).toEqual({ action: 'respec' });
  });
});

describe('limite de revisões', () => {
  const args = { approved: false, round: 1, maxRounds: 3, currentModel: 'gpt-6-luna', escalationModel: 'gpt-6.1-sol' };
  it('aprovado encerra', () => expect(afterReview({ ...args, approved: true })).toEqual({ action: 'done' }));
  it('rodadas 1 e 2 → revisa', () => expect(afterReview({ ...args, round: 2 })).toEqual({ action: 'revise' }));
  it('rodada 3 reprovada → modelo maior', () =>
    expect(afterReview({ ...args, round: 3 })).toEqual({ action: 'promote', toModel: 'gpt-6.1-sol' }));
  it('já no maior → CEO', () =>
    expect(afterReview({ ...args, round: 3, currentModel: 'gpt-6.1-sol' })).toEqual({ action: 'escalate_ceo' }));
});

describe('ondas de dependência', () => {
  it('produto → engenharia → qa, com growth em paralelo à engenharia', () => {
    const waves = planWaves([
      { team: 'qa', dependsOn: ['engenharia'] },
      { team: 'engenharia', dependsOn: ['produto'] },
      { team: 'produto', dependsOn: [] },
      { team: 'growth', dependsOn: ['produto'] },
    ]);
    expect(waves.map((w) => w.map((o) => o.team))).toEqual([['produto'], ['engenharia', 'growth'], ['qa']]);
  });
  it('ciclo não trava', () => {
    const waves = planWaves([
      { team: 'a', dependsOn: ['b'] },
      { team: 'b', dependsOn: ['a'] },
    ]);
    expect(waves.flat()).toHaveLength(2);
  });
  it('dependência de time ausente é ignorada', () => {
    expect(planWaves([{ team: 'qa', dependsOn: ['marketing'] }])).toEqual([[{ team: 'qa', dependsOn: ['marketing'] }]]);
  });
});

describe('contexto do CEO', () => {
  it('mantém os relatórios mais recentes que cabem', () => {
    const reports = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)]; // 100 tokens cada
    const r = fitToContext(reports, (x) => x, 1000, 750);
    expect(r.kept).toEqual(['b'.repeat(400), 'c'.repeat(400)]);
    expect(r.dropped).toBe(1);
  });
});
