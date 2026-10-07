import { useEffect, useMemo, useState } from 'react';
import { PiggyBank, Table2 } from 'lucide-react';
import { formatUsd, type LedgerEntryDto } from '@office/contracts';
import { api } from '../../lib/api';
import { clockTime, dateTime, pct } from '../../lib/format';
import { useOffice, useView } from '../../store/store';
import { BarList, CHART, DataTable, LineChart, type Point } from '../charts';
import { cx, Meter, ModelBadge, SectionTitle, Sheet } from '../kit';

// O dinheiro é contado por código: tudo aqui vem do livro-caixa (custos de cada
// chamada, busca, sandbox, imagem) e da fonte de receita lida pelo Financeiro.

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-600/50 bg-ink-900/40 p-3.5">
      <div className="text-[11px] text-ink-300">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-none text-ink-100">{value}</div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  llm: 'modelo',
  search: 'busca',
  sandbox: 'sandbox',
  image: 'imagem',
  embedding: 'embedding',
  other: 'outro',
  revenue: 'venda',
};

export function FinancePanel() {
  const view = useView();
  const config = useOffice((s) => s.config);
  const version = useOffice((s) => s.eventsVersion);
  const [scope, setScope] = useState<string>(view.activeMissionId ?? '_all');
  const [table, setTable] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntryDto[]>([]);
  const mission = scope !== '_all' ? view.missions[scope] : null;
  const fin = view.finance[scope] ?? view.finance._all;

  useEffect(() => {
    const t = setTimeout(() => {
      api<LedgerEntryDto[]>(`/api/ledger?limit=250${scope !== '_all' ? `&missionId=${scope}` : ''}`)
        .then(setLedger)
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [scope, version]);

  const netSeries: Point[] = useMemo(() => fin.series.map((p) => ({ t: Date.parse(p.ts), v: p.revenueUsd - p.spentUsd })), [fin.series]);
  const spendSeries: Point[] = useMemo(() => fin.series.map((p) => ({ t: Date.parse(p.ts), v: p.spentUsd })), [fin.series]);
  const byModel = Object.entries(fin.byModel).sort((a, b) => b[1] - a[1]);
  const byTeam = Object.entries(fin.byTeam).sort((a, b) => b[1] - a[1]);
  const byKind = Object.entries(fin.byKind).sort((a, b) => b[1] - a[1]);
  const net = fin.revenueUsd - fin.spentUsd;
  const teams = config?.roles.teams ?? {};
  const money = (v: number) => formatUsd(v);
  const fmtAxis = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`);

  return (
    <Sheet
      wide
      title="Financeiro"
      icon={<PiggyBank size={18} />}
      subtitle="Código conta o dinheiro; o Luna só redige o relatório. Só o Financeiro declara a meta batida."
      onClose={() => useOffice.getState().openPanel(null)}
    >
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 rounded-lg border border-ink-500/60 bg-ink-900/70 px-2 text-sm text-ink-100 outline-none"
          >
            <option value="_all">Todas as missões</option>
            {[...view.missionOrder].reverse().map((id) => (
              <option key={id} value={id}>
                {view.missions[id]?.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => setTable((t) => !t)}
            className={cx(
              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs',
              table ? 'bg-ink-600 text-ink-100' : 'text-ink-300 hover:text-ink-100',
            )}
          >
            <Table2 size={14} /> Ver como tabela
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_2fr]">
          <div className="rounded-2xl border border-ink-600/50 bg-gradient-to-br from-ink-800/80 to-ink-900/40 p-5">
            <div className="text-[12px] text-ink-300">Lucro líquido (receita líquida − todo o gasto)</div>
            <div className={cx('mt-1 text-[52px] font-semibold leading-none', net >= 0 ? 'text-ink-100' : 'text-[#ffb3c0]')}>
              {formatUsd(net)}
            </div>
            {mission ? (
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-[11.5px] text-ink-300">
                  <span>meta {formatUsd(mission.goalUsd)}</span>
                  <span>{pct(Math.max(0, net) / mission.goalUsd)}</span>
                </div>
                <Meter value={Math.max(0, net)} max={mission.goalUsd} label="Progresso da meta" />
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-ink-400">Somando todas as missões.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Receita líquida" value={formatUsd(fin.revenueUsd)} />
            <Tile label="Gasto total" value={formatUsd(fin.spentUsd)}>
              {mission && <Meter value={fin.spentUsd} max={mission.spendCapUsd} tone="spend" label="Gasto vs teto" />}
              {mission && <div className="mt-1 text-[10.5px] text-ink-400">teto {formatUsd(mission.spendCapUsd)}</div>}
            </Tile>
            <Tile label="Vendas" value={String(fin.sales)}>
              <div className="text-[10.5px] text-ink-400">bruto {formatUsd(fin.grossUsd)}</div>
            </Tile>
            <Tile label="Custo por venda" value={fin.sales ? formatUsd(fin.spentUsd / fin.sales) : '—'} />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-ink-600/50 p-4" style={{ background: CHART.surface }}>
            <SectionTitle>Lucro líquido acumulado</SectionTitle>
            {table ? (
              <DataTable head={['hora', 'lucro líquido']} rows={netSeries.slice(-60).map((p) => [clockTime(p.t), money(p.v)])} />
            ) : (
              <LineChart
                points={netSeries}
                color={CHART.series1}
                format={fmtAxis}
                reference={mission ? { value: mission.goalUsd, label: 'meta' } : undefined}
                emptyText="O lucro aparece quando o primeiro custo ou venda for registrado."
              />
            )}
          </div>
          <div className="rounded-2xl border border-ink-600/50 p-4" style={{ background: CHART.surface }}>
            <SectionTitle>Gasto acumulado</SectionTitle>
            {table ? (
              <DataTable head={['hora', 'gasto']} rows={spendSeries.slice(-60).map((p) => [clockTime(p.t), money(p.v)])} />
            ) : (
              <LineChart
                points={spendSeries}
                color={CHART.series2}
                format={fmtAxis}
                reference={mission ? { value: mission.spendCapUsd, label: 'teto' } : undefined}
              />
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-ink-600/50 p-4" style={{ background: CHART.surface }}>
            <SectionTitle>Custo por modelo</SectionTitle>
            {table ? (
              <DataTable head={['modelo', 'custo']} rows={byModel.map(([k, v]) => [k, money(v)])} />
            ) : (
              <BarList
                rows={byModel.map(([k, v]) => ({ key: k, label: <ModelBadge model={k} />, value: v }))}
                color={CHART.series1}
                format={money}
              />
            )}
          </div>
          <div className="rounded-2xl border border-ink-600/50 p-4" style={{ background: CHART.surface }}>
            <SectionTitle>Custo por time</SectionTitle>
            {table ? (
              <DataTable head={['time', 'custo']} rows={byTeam.map(([k, v]) => [teams[k]?.name ?? k, money(v)])} />
            ) : (
              <BarList
                rows={byTeam.map(([k, v]) => ({ key: k, label: teams[k]?.name ?? k, value: v }))}
                color={CHART.series1}
                format={money}
              />
            )}
          </div>
          <div className="rounded-2xl border border-ink-600/50 p-4" style={{ background: CHART.surface }}>
            <SectionTitle>Custo por tipo</SectionTitle>
            {table ? (
              <DataTable head={['tipo', 'custo']} rows={byKind.map(([k, v]) => [KIND_LABEL[k] ?? k, money(v)])} />
            ) : (
              <BarList
                rows={byKind.map(([k, v]) => ({ key: k, label: KIND_LABEL[k] ?? k, value: v }))}
                color={CHART.series1}
                format={money}
              />
            )}
          </div>
        </div>

        <section>
          <SectionTitle right={<span className="text-[11px] text-ink-400">últimas {ledger.length} linhas</span>}>Livro-caixa</SectionTitle>
          <div className="max-h-[360px] overflow-auto rounded-xl border border-ink-600/60">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-ink-800 text-ink-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">quando</th>
                  <th className="px-3 py-2 text-left font-medium">tipo</th>
                  <th className="px-3 py-2 text-left font-medium">agente</th>
                  <th className="px-3 py-2 text-left font-medium">modelo</th>
                  <th className="px-3 py-2 text-left font-medium">nota</th>
                  <th className="px-3 py-2 text-right font-medium">valor</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-t border-ink-700/60 hover:bg-ink-800/50">
                    <td className="px-3 py-1.5 text-ink-300 tabular">{dateTime(l.ts)}</td>
                    <td className="px-3 py-1.5 text-ink-200">{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td className="px-3 py-1.5 text-ink-200">{l.agentId ? (view.agents[l.agentId]?.name ?? l.agentId) : '—'}</td>
                    <td className="px-3 py-1.5">
                      {l.model ? <ModelBadge model={l.model} compact /> : <span className="text-ink-400">—</span>}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-1.5 text-ink-300">{l.note}</td>
                    <td className={cx('px-3 py-1.5 text-right font-medium tabular', l.amountUsd > 0 ? 'text-[#0ca30c]' : 'text-ink-100')}>
                      {l.amountUsd > 0 ? '+' : '−'}
                      {formatUsd(Math.abs(l.amountUsd))}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-ink-400">
                      Nenhum lançamento ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Sheet>
  );
}
