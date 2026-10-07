import { useEffect, useState } from 'react';
import { Gavel, KeyRound, MessageSquareText, Moon, Octagon, Play, Plus, Sun, SunMoon, Volume2, VolumeX } from 'lucide-react';
import { formatUsd } from '@office/contracts';
import { api } from '../lib/api';
import { duration } from '../lib/format';
import { officeNow, useOffice, useView } from '../store/store';
import { Button, cx, Meter } from './kit';

const STATUS: Record<string, { label: string; color: string }> = {
  created: { label: 'criada', color: '#8e89b8' },
  running: { label: 'em andamento', color: '#5eead4' },
  waiting: { label: 'no ar · vendendo', color: '#4ade80' },
  completed: { label: 'meta batida', color: '#f2c14e' },
  failed: { label: 'encerrada', color: '#ff5470' },
  cancelled: { label: 'cancelada', color: '#8e89b8' },
};

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="pixel-frame grid h-8 w-8 place-items-center rounded-[3px] bg-ink-800">
        <svg viewBox="0 0 16 16" className="h-6 w-6 pixelated" shapeRendering="crispEdges">
          <rect x="3" y="3" width="10" height="7" fill="#20242f" />
          <rect x="4" y="4" width="8" height="5" fill="#0f1b2d" />
          <rect x="5" y="5" width="4" height="1" fill="#5eead4" />
          <rect x="5" y="7" width="5" height="1" fill="#a78bfa" />
          <rect x="6" y="10" width="4" height="1" fill="#20242f" />
          <rect x="4" y="11" width="8" height="2" fill="#c98d5a" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="font-pixel text-[17px] tracking-wide text-ink-100">
          PIXEL <span className="text-cyan">CORP</span>
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-ink-300">empresa de agentes</div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  children,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex min-w-[112px] flex-col gap-1 whitespace-nowrap">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-300">{label}</span>
        {sub && <span className="hidden text-[10px] text-ink-400 2xl:inline">{sub}</span>}
      </div>
      <div className="font-pixel text-[17px] leading-none" style={{ color: accent ?? '#e8e5ff' }}>
        {value}
      </div>
      {children}
    </div>
  );
}

export function TopBar() {
  const view = useView();
  const config = useOffice((s) => s.config);
  const muted = useOffice((s) => s.muted);
  const dayMode = useOffice((s) => s.dayMode);
  const conn = useOffice((s) => s.conn);
  const replay = useOffice((s) => s.replay.active);
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const mission = view.activeMissionId ? view.missions[view.activeMissionId] : null;
  const fin = view.activeMissionId ? view.finance[view.activeMissionId] : null;
  const net = fin ? fin.revenueUsd - fin.spentUsd : 0;
  const ended = mission && ['completed', 'failed', 'cancelled'].includes(mission.status);
  const left = mission ? Date.parse(mission.deadline) - (ended && mission.endedAt ? Date.parse(mission.endedAt) : officeNow()) : 0;
  const st = mission ? (STATUS[mission.status] ?? STATUS.created) : null;
  const pending = Object.values(view.approvals).filter((a) => a.status === 'pending').length;

  const panic = async () => {
    setBusy(true);
    try {
      if (view.paused) await api('/api/resume', { method: 'POST' });
      else await api('/api/panic', { method: 'POST', json: { reason: 'Botão de pânico na interface' } });
    } catch (err) {
      useOffice.getState().toast({ kind: 'error', title: 'Falhou', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const summary = async () => {
    try {
      await api('/api/secretary/summary', { method: 'POST' });
    } catch (err) {
      useOffice.getState().toast({ kind: 'error', title: 'Secretaria indisponível', body: (err as Error).message });
    }
  };

  const nextDay = { auto: 'day', day: 'night', night: 'auto' } as const;
  const DayIcon = dayMode === 'day' ? Sun : dayMode === 'night' ? Moon : SunMoon;

  return (
    <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-5 border-b border-ink-600/50 bg-ink-850/90 px-4">
      <Logo />
      <div className="h-8 w-px bg-ink-600/60" />
      {mission && st ? (
        <button
          className="group flex min-w-0 max-w-[280px] flex-col items-start rounded-lg px-2 py-1 text-left hover:bg-ink-700/50"
          onClick={() => useOffice.getState().openPanel('missions')}
          title={mission.brief}
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase tracking-wider" style={{ color: st.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
            missão · {st.label}
            {mission.cycle > 0 && <span className="text-ink-400">· ciclo {mission.cycle}</span>}
          </span>
          <span className="w-full truncate text-sm font-medium text-ink-100">{mission.title}</span>
        </button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => useOffice.getState().setNewMissionOpen(true)}>
          <Plus size={14} /> Nova missão
        </Button>
      )}

      {mission && fin && (
        <div className="hidden items-center gap-4 xl:flex">
          <Kpi
            label="Lucro líquido"
            value={formatUsd(net)}
            sub={`meta ${formatUsd(mission.goalUsd)}`}
            accent={net >= 0 ? '#4ade80' : '#ff8fa3'}
          >
            <Meter value={Math.max(0, net)} max={mission.goalUsd} label="Progresso da meta" />
          </Kpi>
          <Kpi label="Gasto" value={formatUsd(fin.spentUsd)} sub={`teto ${formatUsd(mission.spendCapUsd)}`}>
            <Meter value={fin.spentUsd} max={mission.spendCapUsd} tone="spend" label="Gasto vs teto" />
          </Kpi>
          <Kpi label="Vendas" value={String(fin.sales)} sub={mission.priceUsd ? `a ${formatUsd(mission.priceUsd)}` : undefined} />
          <div className="hidden 2xl:block">
            <Kpi label={ended ? 'Encerrada' : 'Prazo'} value={ended ? '—' : duration(left)} sub={ended ? undefined : 'restante'} />
          </div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          className={cx(
            'hidden rounded-md border px-2 py-1 font-pixel text-[11px] tracking-wider transition hover:brightness-125 sm:inline-block',
            config?.mode === 'real' ? 'border-danger/60 bg-danger/10 text-danger' : 'border-violet/50 bg-violet/10 text-astra',
          )}
          onClick={() => useOffice.getState().setSetupOpen(true)}
          title={
            config?.mode === 'real'
              ? `Chamadas reais à OpenAI, cobradas até o teto da missão (${config.setup.keyHint ?? 'chave'}). Clique para gerenciar.`
              : 'Sem custo real: cérebros roteirizados, mãos reais (git, CI, banco, Temporal)'
          }
        >
          {config?.mode === 'real' ? 'MODO REAL' : 'SIMULAÇÃO'}
        </button>
        {config?.mode === 'sim' && config.setup.canConfigure && (
          <Button
            variant="ghost"
            size="sm"
            className="whitespace-nowrap"
            onClick={() => useOffice.getState().setSetupOpen(true)}
            title="Usar sua chave da OpenAI e ligar o modo real"
          >
            <KeyRound size={14} /> <span className="hidden md:inline">Conectar OpenAI</span>
          </Button>
        )}
        <span
          className="hidden items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] text-ink-300 lg:flex"
          title={`WebSocket: ${conn} · Temporal: ${config?.temporal.connected ? 'conectado' : 'desconectado'}`}
        >
          <span className={cx('h-2 w-2 rounded-full', conn === 'open' ? 'bg-money' : conn === 'connecting' ? 'bg-amber' : 'bg-danger')} />
          {conn === 'open' ? (replay ? 'replay' : 'ao vivo') : conn === 'connecting' ? 'conectando' : 'offline'}
        </span>
        <Button variant="subtle" size="sm" onClick={summary} title="Resumo da secretaria">
          <MessageSquareText size={15} />
        </Button>
        <Button
          variant="subtle"
          size="sm"
          onClick={() => useOffice.getState().setDayMode(nextDay[dayMode])}
          title={`Iluminação: ${dayMode}`}
        >
          <DayIcon size={15} />
        </Button>
        <Button variant="subtle" size="sm" onClick={() => useOffice.getState().toggleMute()} title={muted ? 'Ligar som' : 'Silenciar'}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </Button>
        {pending > 0 && (
          <Button
            variant="gold"
            size="sm"
            onClick={() => useOffice.getState().openPanel('approvals')}
            className="animate-pulse whitespace-nowrap"
            title="Pedidos ao Conselho"
          >
            <Gavel size={14} /> {pending}
          </Button>
        )}
        <Button
          variant={view.paused ? 'primary' : 'danger'}
          onClick={panic}
          disabled={busy || replay}
          className={cx('font-pixel tracking-wider', !view.paused && 'animate-pulse-glow')}
          title={view.paused ? 'Retomar todas as missões' : 'Pausa TODAS as missões (sinal ao Temporal)'}
        >
          {view.paused ? (
            <>
              <Play size={15} /> RETOMAR
            </>
          ) : (
            <>
              <Octagon size={15} /> PÂNICO
            </>
          )}
        </Button>
      </div>
    </header>
  );
}
