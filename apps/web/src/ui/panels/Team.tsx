import { useEffect, useMemo, useState } from 'react';
import { Crown, RotateCcw, Save, Users } from 'lucide-react';
import { EFFORTS, formatUsd, relativeCost, type AgentView, type Role, type RolesFile } from '@office/contracts';
import { api } from '../../lib/api';
import { useOffice, useView } from '../../store/store';
import { Avatar, Button, cx, inputClass, ModelBadge, SectionTitle, Sheet } from '../kit';

// Modelo é configuração, não código: esta aba edita o roles.yaml (preservando os
// comentários do arquivo) e a próxima chamada de cada agente já usa o valor novo.

type Draft = Record<string, Partial<Role>>;

function OrgNode({
  agents,
  title,
  model,
  color,
  accent,
}: {
  agents: AgentView[];
  title: string;
  model?: string;
  color: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex min-w-[150px] flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 text-center',
        accent && 'shadow-[0_0_30px_-12px_currentColor]',
      )}
      style={{ borderColor: `${color}66`, background: `${color}14`, color }}
    >
      <div className="flex -space-x-2">
        {agents.slice(0, 4).map((a) => (
          <button key={a.id} onClick={() => useOffice.getState().selectAgent(a.id)} title={a.name}>
            <Avatar agent={a} size={30} />
          </button>
        ))}
      </div>
      <div className="font-pixel text-[13px] leading-tight text-ink-100">{title}</div>
      {model && <ModelBadge model={model} />}
    </div>
  );
}

function OrgChart() {
  const view = useView();
  const config = useOffice((s) => s.config);
  const agents = view.agentOrder.map((id) => view.agents[id]).filter(Boolean);
  const ceo = agents.filter((a) => a.level === 'executive');
  const staff = agents.filter((a) => a.level === 'staff');
  const leads = agents.filter((a) => a.level === 'lead');
  const line = 'bg-ink-500/70';
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-600/50 bg-ink-900/40 p-5">
      <div className="mx-auto flex w-max flex-col items-center">
        <div className="flex min-w-[170px] flex-col items-center gap-1 rounded-xl border border-gold/60 bg-gold/10 px-4 py-2.5 text-center">
          <Crown size={18} className="text-gold" />
          <div className="font-pixel text-[14px] text-ink-100">Conselho (você)</div>
          <div className="text-[11px] text-ink-300">aprova o irreversível</div>
        </div>
        <div className={cx('h-5 w-px', line)} />
        <div className="flex items-center gap-4">
          {staff.slice(0, 1).map((s) => (
            <OrgNode key={s.id} agents={[s]} title={s.title} model={s.model} color="#94a3b8" />
          ))}
          <div className={cx('h-px w-6', line)} />
          {ceo[0] && <OrgNode agents={ceo} title="CEO" model={ceo[0].model} color="#a78bfa" accent />}
          <div className={cx('h-px w-6', line)} />
          {staff.slice(1, 2).map((s) => (
            <OrgNode key={s.id} agents={[s]} title={s.title} model={s.model} color="#94a3b8" />
          ))}
        </div>
        <div className={cx('h-5 w-px', line)} />
        <div className={cx('h-px', line)} style={{ width: `${Math.max(1, leads.length - 1) * 186}px` }} />
        <div className="flex gap-4">
          {leads.map((lead) => {
            const team = config?.roles.teams[lead.team];
            const workers = agents.filter((a) => a.level === 'worker' && a.team === lead.team);
            const color = team?.color ?? '#2dd4bf';
            return (
              <div key={lead.id} className="flex flex-col items-center">
                <div className={cx('h-4 w-px', line)} />
                <OrgNode agents={[lead]} title={team?.name ?? lead.team} model={lead.model} color={color} />
                <div className={cx('h-4 w-px', line)} />
                <div className="flex w-[170px] flex-col gap-1 rounded-xl border border-ink-600/60 bg-ink-800/60 p-2">
                  {workers.map((w) => (
                    <button
                      key={w.id}
                      className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-ink-700/60"
                      onClick={() => useOffice.getState().selectAgent(w.id)}
                    >
                      <Avatar agent={w} size={22} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11.5px] text-ink-100">{w.name}</div>
                        <div className="truncate text-[10px] text-ink-400">{w.title}</div>
                      </div>
                      <ModelBadge model={w.model} compact />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[11.5px] text-ink-400">
          Tarefas descem; entregas sobem com evidência. No máximo três níveis — para escalar, mais trabalhadores, nunca mais camadas.
        </p>
      </div>
    </div>
  );
}

export function TeamPanel() {
  const config = useOffice((s) => s.config);
  const [original, setOriginal] = useState<RolesFile | null>(config?.roles ?? null);
  const [draft, setDraft] = useState<Draft>({});
  const [rules, setRules] = useState<Partial<RolesFile['company']['rules']>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config?.roles) setOriginal(config.roles);
  }, [config?.roles]);

  const models = useMemo(
    () =>
      Object.entries(config?.pricing.models ?? {})
        .filter(([, p]) => p.tier !== 'embedding')
        .map(([id]) => id),
    [config],
  );
  const imageModels = useMemo(() => Object.keys(config?.pricing.images ?? {}), [config]);
  const dirty = Object.keys(draft).length > 0 || Object.keys(rules).length > 0;
  if (!original || !config) return null;

  const set = (roleId: string, field: keyof Role, value: unknown) => {
    setDraft((d) => {
      const next = { ...d, [roleId]: { ...d[roleId], [field]: value } };
      if ((original.roles[roleId] as Record<string, unknown>)[field] === value) {
        delete (next[roleId] as Record<string, unknown>)[field];
        if (!Object.keys(next[roleId]).length) delete next[roleId];
      }
      return next;
    });
  };
  const value = <K extends keyof Role>(roleId: string, field: K): Role[K] =>
    (draft[roleId]?.[field] ?? original.roles[roleId][field]) as Role[K];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ changes: string[] }>('/api/roles', { method: 'PATCH', json: { roles: draft, rules } });
      setDraft({});
      setRules({});
      await useOffice.getState().loadConfig();
      useOffice.getState().toast({ kind: 'success', title: 'roles.yaml atualizado', body: res.changes.join(' · ') || 'Nada mudou' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const baseline = 'gpt-6-luna';
  const roleEntries = Object.entries(original.roles);
  const ruleValue = <K extends keyof RolesFile['company']['rules']>(k: K) => (rules[k] ?? original.company.rules[k]) as number;

  return (
    <Sheet
      wide
      title="Equipe"
      icon={<Users size={18} />}
      subtitle="Organograma e roles.yaml: cargo, modelo, esforço, cobrança e orçamento por tarefa. Salvar vale na próxima chamada — sem deploy."
      onClose={() => useOffice.getState().openPanel(null)}
      actions={
        <div className="flex items-center gap-2">
          {dirty && (
            <Button size="sm" variant="subtle" onClick={() => (setDraft({}), setRules({}))}>
              <RotateCcw size={13} /> Descartar
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            <Save size={13} /> Salvar roles.yaml
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-5">
        <OrgChart />
        {error && <div className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        <section>
          <SectionTitle>Cargos</SectionTitle>
          <div className="overflow-x-auto rounded-xl border border-ink-600/60">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead className="bg-ink-800 text-ink-300">
                <tr>
                  {['cargo', 'time', 'modelo', 'custo rel.', 'esforço', 'esforço extra', 'cobrança', 'orçamento/tarefa', 'instâncias'].map(
                    (h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {roleEntries.map(([id, role]) => {
                  const changed = Boolean(draft[id]);
                  const model = value(id, 'model');
                  const rel = role.kind === 'image' ? null : relativeCost(config.pricing, model, baseline);
                  const team = config.roles.teams[role.team];
                  const extraField: keyof Role | null =
                    role.level === 'lead' ? 'reviewEffort' : role.level === 'executive' ? 'pivotEffort' : null;
                  return (
                    <tr key={id} className={cx('border-t border-ink-700/60', changed && 'bg-cyan/[0.05]')}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-ink-100">{role.title}</div>
                        <div className="font-mono text-[10.5px] text-ink-400">{id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-ink-200">
                          <span className="h-2 w-2 rounded-sm" style={{ background: team?.color }} />
                          {team?.name ?? role.team}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={cx(inputClass, '!h-8 !w-44 font-mono !text-[12px]')}
                          value={model}
                          onChange={(e) => set(id, 'model', e.target.value)}
                        >
                          {(role.kind === 'image' ? imageModels : models).map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11.5px] text-ink-300">
                        {rel === null ? '—' : `${rel >= 1 ? rel.toFixed(0) : rel.toFixed(2)}×`}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={cx(inputClass, '!h-8 !w-28 !text-[12px]')}
                          value={value(id, 'effort')}
                          onChange={(e) => set(id, 'effort', e.target.value)}
                        >
                          {EFFORTS.map((e) => (
                            <option key={e}>{e}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {extraField ? (
                          <select
                            className={cx(inputClass, '!h-8 !w-28 !text-[12px]')}
                            value={(value(id, extraField) as string | undefined) ?? value(id, 'effort')}
                            onChange={(e) => set(id, extraField, e.target.value)}
                            title={extraField === 'reviewEffort' ? 'Esforço em code review' : 'Esforço para pivôs e integração final'}
                          >
                            {EFFORTS.map((e) => (
                              <option key={e}>{e}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={cx(inputClass, '!h-8 !w-28 !text-[12px]')}
                          value={value(id, 'billing')}
                          onChange={(e) => set(id, 'billing', e.target.value)}
                        >
                          {['standard', 'flex', 'batch'].map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span className="text-ink-400">$</span>
                          <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            className={cx(inputClass, '!h-8 !w-24 !text-[12px] tabular')}
                            value={value(id, 'taskBudgetUsd')}
                            onChange={(e) => set(id, 'taskBudgetUsd', Number(e.target.value))}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {role.level === 'worker' ? (
                          <input
                            type="number"
                            min={0}
                            max={12}
                            className={cx(inputClass, '!h-8 !w-16 !text-[12px] tabular')}
                            value={value(id, 'instances')}
                            onChange={(e) => set(id, 'instances', Number(e.target.value))}
                          />
                        ) : (
                          <span className="text-ink-300">{role.instances}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <SectionTitle>Regras da empresa</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['maxReviewRounds', 'Idas e voltas de revisão', 'Estourou, escala: modelo maior → CEO → Conselho.'],
                ['ciFailuresBeforePromotion', 'Falhas de CI até promover', 'Luna → Sol quando o CI falha N vezes.'],
                ['maxRespecs', 'Reescritas de spec pelo líder', 'Depois disso, a tarefa vai ao CEO.'],
                ['approvalTimeoutHours', 'Prazo do Conselho (h)', 'Sem decisão, o pedido expira.'],
              ] as const
            ).map(([k, label, hint]) => (
              <label key={k} className="rounded-xl border border-ink-600/50 bg-ink-900/40 p-3">
                <div className="text-[12px] font-medium text-ink-100">{label}</div>
                <input
                  type="number"
                  className={cx(inputClass, 'mt-2 !h-8 tabular')}
                  value={ruleValue(k)}
                  onChange={(e) => setRules((r) => ({ ...r, [k]: Number(e.target.value) }))}
                />
                <div className="mt-1.5 text-[11px] text-ink-400">{hint}</div>
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-400">
            Preços conferidos em {config.pricing.checkedAt} (pricing.yaml). Astra custa{' '}
            {relativeCost(config.pricing, 'gpt-6-astra', baseline)?.toFixed(0) ?? '?'}× o Luna; uma revisão de 50 mil tokens lidos + 10 mil
            escritos sai por ~{formatUsd(0.5 + 0.5)} no Astra e ~{formatUsd(0.01)} no Luna.
          </p>
        </section>
      </div>
    </Sheet>
  );
}
