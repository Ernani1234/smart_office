import { useState } from 'react';
import { Ban, Plus, Target } from 'lucide-react';
import { formatUsd } from '@office/contracts';
import { api } from '../../lib/api';
import { dateTime, duration } from '../../lib/format';
import { useOffice, useView } from '../../store/store';
import { Button, cx, Empty, Meter, Pill, Sheet } from '../kit';

const REASON: Record<string, { label: string; color: string }> = {
  goal_reached: { label: 'meta batida', color: '#f2c14e' },
  budget_exhausted: { label: 'orçamento esgotado', color: '#ff5470' },
  deadline: { label: 'prazo vencido', color: '#fb923c' },
  cancelled: { label: 'cancelada', color: '#8e89b8' },
  failed: { label: 'falhou', color: '#ff5470' },
};

export function MissionsPanel() {
  const view = useView();
  const [confirm, setConfirm] = useState<string | null>(null);
  const missions = [...view.missionOrder]
    .reverse()
    .map((id) => view.missions[id])
    .filter(Boolean);
  const running = missions.some((m) => ['created', 'running', 'waiting'].includes(m.status));

  const cancel = async (id: string) => {
    setConfirm(null);
    try {
      await api(`/api/missions/${id}/cancel`, { method: 'POST' });
    } catch (err) {
      useOffice.getState().toast({ kind: 'error', title: 'Não foi possível cancelar', body: (err as Error).message });
    }
  };

  return (
    <Sheet
      title="Missões"
      icon={<Target size={18} />}
      subtitle="Métrica (lucro líquido), fonte (meio de pagamento), teto de gasto e prazo — termina no que vier primeiro."
      onClose={() => useOffice.getState().openPanel(null)}
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={running}
          onClick={() => useOffice.getState().setNewMissionOpen(true)}
          title={running ? 'Uma missão por vez' : undefined}
        >
          <Plus size={14} /> Nova missão
        </Button>
      }
    >
      <div className="space-y-3 p-5">
        {missions.length === 0 && (
          <Empty icon={<Target size={36} />} title="Nenhuma missão ainda">
            Crie a primeira: mire os primeiros US$ 100 de lucro com um teto de gasto bem abaixo disso.
          </Empty>
        )}
        {missions.map((m) => {
          const fin = view.finance[m.id];
          const net = fin ? fin.revenueUsd - fin.spentUsd : 0;
          const ended = Boolean(m.endReason);
          const r = m.endReason ? REASON[m.endReason] : null;
          return (
            <article key={m.id} className="rounded-2xl border border-ink-600/60 bg-ink-900/40 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-pixel text-lg text-ink-100">{m.title}</h3>
                    {r ? (
                      <Pill color={r.color}>{r.label}</Pill>
                    ) : (
                      <Pill color="#5eead4">{m.status === 'waiting' ? 'no ar' : 'em andamento'}</Pill>
                    )}
                    {m.launched && m.product && <Pill color="#f472b6">🚀 {m.product}</Pill>}
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-300">{m.brief}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-400">
                    <span>criada {dateTime(m.createdAt)}</span>
                    {m.endedAt && <span>encerrada {dateTime(m.endedAt)}</span>}
                    {m.startedAt && (
                      <span>duração {duration((m.endedAt ? Date.parse(m.endedAt) : Date.now()) - Date.parse(m.startedAt))}</span>
                    )}
                    <span>fonte: {m.revenueSource}</span>
                    {m.lastDecision && <span className="text-ink-300">CEO: “{m.lastDecision}”</span>}
                  </div>
                </div>
                <div className="grid w-full grid-cols-3 gap-3 sm:w-[420px]">
                  <div>
                    <div className="text-[10.5px] text-ink-400">lucro líquido</div>
                    <div className={cx('font-pixel text-[17px]', net >= 0 ? 'text-ink-100' : 'text-[#ffb3c0]')}>{formatUsd(net)}</div>
                    <Meter value={Math.max(0, net)} max={m.goalUsd} />
                    <div className="mt-0.5 text-[10px] text-ink-400">meta {formatUsd(m.goalUsd)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-ink-400">gasto</div>
                    <div className="font-pixel text-[17px] text-ink-100">{formatUsd(fin?.spentUsd ?? 0)}</div>
                    <Meter value={fin?.spentUsd ?? 0} max={m.spendCapUsd} tone="spend" />
                    <div className="mt-0.5 text-[10px] text-ink-400">teto {formatUsd(m.spendCapUsd)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-ink-400">vendas</div>
                    <div className="font-pixel text-[17px] text-ink-100">{fin?.sales ?? 0}</div>
                    {!ended &&
                      (confirm === m.id ? (
                        <div className="mt-1 flex gap-1">
                          <Button size="sm" variant="danger" onClick={() => void cancel(m.id)}>
                            confirmar
                          </Button>
                          <Button size="sm" variant="subtle" onClick={() => setConfirm(null)}>
                            não
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="subtle" className="mt-1 !px-1.5" onClick={() => setConfirm(m.id)}>
                          <Ban size={13} /> cancelar
                        </Button>
                      ))}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </Sheet>
  );
}
