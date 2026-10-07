import { useEffect, useMemo, useState } from 'react';
import { FastForward, History, ListOrdered, Pause, Play, Radio, SkipForward } from 'lucide-react';
import { clockTime, dateTime } from '../lib/format';
import { useOffice, useView } from '../store/store';
import { Button, cx } from './kit';

// Linha do tempo: ao vivo por padrão; o replay reaplica o log de eventos na
// velocidade escolhida — dormir, acordar e assistir à madrugada em 10×.

const SPEEDS = [1, 2, 5, 10, 30, 60];
const BINS = 120;

function useReplayLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(250, t - last);
      last = t;
      useOffice.getState().tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function Density({ start, end, cursor }: { start: number; end: number; cursor: number | null }) {
  const version = useOffice((s) => s.eventsVersion);
  const bins = useMemo(() => {
    const times = useOffice.getState().eventTimes;
    const out = new Array<number>(BINS).fill(0);
    const span = Math.max(1, end - start);
    for (const t of times) {
      if (t < start || t > end) continue;
      out[Math.min(BINS - 1, Math.floor(((t - start) / span) * BINS))] += 1;
    }
    return out;
  }, [start, end, version]);
  const max = Math.max(1, ...bins);
  return (
    <svg viewBox={`0 0 ${BINS} 20`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
      {bins.map((n, i) => {
        const h = n ? 2 + (Math.log1p(n) / Math.log1p(max)) * 16 : 0;
        const past = cursor === null || start + ((i + 0.5) / BINS) * (end - start) <= cursor;
        return <rect key={i} x={i + 0.1} y={20 - h} width={0.8} height={h} rx={0.3} fill={past ? '#3987e5' : '#3d3866'} />;
      })}
    </svg>
  );
}

function Feed({ onClose }: { onClose: () => void }) {
  const view = useView();
  const items = view.feed.slice(-120).reverse();
  const color: Record<string, string> = {
    info: '#bcb8dc',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#ff5470',
    money: '#f2c14e',
    board: '#f2c14e',
  };
  return (
    <div className="panel absolute bottom-[54px] left-3 right-3 z-30 max-h-[300px] overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-ink-600/60 px-4 py-2">
        <span className="font-pixel text-[13px] uppercase tracking-wider text-ink-300">Diário da empresa</span>
        <button className="text-xs text-ink-300 hover:text-ink-100" onClick={onClose}>
          fechar
        </button>
      </div>
      <ol className="max-h-[256px] overflow-y-auto py-1">
        {items.map((f) => (
          <li key={f.id}>
            <button
              className="flex w-full items-start gap-2.5 px-4 py-1 text-left hover:bg-ink-700/40"
              onClick={() => f.agentId && useOffice.getState().selectAgent(f.agentId)}
            >
              <span className="w-[62px] shrink-0 pt-px font-mono text-[11px] text-ink-400">{clockTime(f.ts)}</span>
              <span className="w-5 shrink-0 text-center">{f.icon}</span>
              <span className="text-[12.5px] leading-snug" style={{ color: color[f.kind] }}>
                {f.text}
              </span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-400">Nada aconteceu ainda.</li>}
      </ol>
    </div>
  );
}

export function Timeline() {
  useReplayLoop();
  const replay = useOffice((s) => s.replay);
  const hasEvents = useOffice((s) => s.eventsVersion > 0);
  const view = useView();
  const [feedOpen, setFeedOpen] = useState(false);
  const last = view.feed[view.feed.length - 1];

  const live = !replay.active;
  const store = useOffice.getState();
  const missionId = store.live.activeMissionId;
  const created = missionId ? store.live.missions[missionId]?.createdAt : null;
  const liveStart = created ? Date.parse(created) : (store.eventTimes[0] ?? Date.now());
  const liveEnd = store.eventTimes[store.eventTimes.length - 1] ?? Date.now();

  return (
    <footer className="relative z-20 flex h-[54px] shrink-0 items-center gap-3 border-t border-ink-600/50 bg-ink-850/90 px-3">
      {feedOpen && <Feed onClose={() => setFeedOpen(false)} />}
      <Button size="sm" variant={feedOpen ? 'primary' : 'ghost'} onClick={() => setFeedOpen((o) => !o)} title="Diário da empresa">
        <ListOrdered size={14} />
      </Button>
      {live ? (
        <>
          <span className="flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-2 py-1 font-pixel text-[11px] tracking-wider text-danger">
            <Radio size={12} className="animate-pulse" /> AO VIVO
          </span>
          <Button size="sm" onClick={() => store.startReplay()} disabled={!hasEvents} title="Reassistir a missão desde o início">
            <History size={14} /> Replay
          </Button>
          <div
            className="relative h-7 min-w-[120px] max-w-[320px] flex-1 overflow-hidden rounded-md bg-ink-900/60"
            title="Atividade da missão"
          >
            <Density start={liveStart} end={liveEnd} cursor={null} />
          </div>
          <div className="min-w-0 flex-[2] truncate text-[12.5px] text-ink-200" title={last?.text}>
            {last ? (
              <>
                <span className="mr-2 font-mono text-[11px] text-ink-400">{clockTime(last.ts)}</span>
                <span className="mr-1.5">{last.icon}</span>
                {last.text}
              </>
            ) : (
              <span className="text-ink-400">Aguardando eventos…</span>
            )}
          </div>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5 rounded-md border border-violet/50 bg-violet/10 px-2 py-1 font-pixel text-[11px] tracking-wider text-astra">
            <History size={12} /> REPLAY
          </span>
          <Button size="sm" variant="primary" className="w-9 !px-0" onClick={() => store.togglePlay()}>
            {replay.playing ? <Pause size={14} /> : <Play size={14} />}
          </Button>
          <div className="flex items-center rounded-lg border border-ink-600/70 bg-ink-900/50 p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => store.setSpeed(s)}
                className={cx(
                  'rounded-md px-1.5 py-0.5 font-mono text-[11px]',
                  replay.speed === s ? 'bg-ink-600 text-cyan' : 'text-ink-300 hover:text-ink-100',
                )}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            onClick={() => store.setSkipSilence(!replay.skipSilence)}
            className={cx('flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px]', replay.skipSilence ? 'text-cyan' : 'text-ink-400')}
            title="Pular trechos sem eventos"
          >
            <FastForward size={13} /> silêncio
          </button>
          <div className="relative h-8 min-w-[200px] flex-1">
            <div className="absolute inset-x-0 inset-y-1 overflow-hidden rounded-md bg-ink-900/60">
              <Density start={replay.start} end={replay.end} cursor={replay.cursor} />
            </div>
            <input
              type="range"
              min={replay.start}
              max={replay.end}
              step={Math.max(1, (replay.end - replay.start) / 1000)}
              value={replay.cursor}
              onChange={(e) => store.seek(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Linha do tempo"
            />
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 rounded bg-cyan shadow-[0_0_8px_#5eead4]"
              style={{ left: `${((replay.cursor - replay.start) / Math.max(1, replay.end - replay.start)) * 100}%` }}
            />
          </div>
          <div className="w-[120px] text-right leading-tight">
            <div className="font-pixel text-[14px] text-ink-100">{clockTime(replay.cursor)}</div>
            <div className="text-[10px] text-ink-400">{dateTime(replay.cursor)}</div>
          </div>
          <Button size="sm" onClick={() => store.stopReplay()}>
            <SkipForward size={14} /> Ao vivo
          </Button>
        </>
      )}
    </footer>
  );
}
