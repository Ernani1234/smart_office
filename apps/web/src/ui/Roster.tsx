import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatUsd, type AgentView } from '@office/contracts';
import { useOffice, useView } from '../store/store';
import { activityInfo, Avatar, cx, ModelBadge, StatusDot } from './kit';

// Elenco por time: quem está fazendo o quê, em qual modelo, gastando quanto.

const LEVEL_ORDER = { executive: 0, lead: 1, worker: 2, staff: 3 } as const;

function AgentRow({ a, selected }: { a: AgentView; selected: boolean }) {
  const view = useView();
  const task = a.taskId ? view.tasks[a.taskId] : null;
  const act = activityInfo(a.activity);
  const busy = !['idle', 'waiting', 'blocked'].includes(a.activity);
  return (
    <button
      onClick={() => useOffice.getState().selectAgent(selected ? null : a.id)}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition',
        selected ? 'bg-ink-700/80 shadow-[inset_0_0_0_1px_rgba(94,234,212,0.35)]' : 'hover:bg-ink-700/45',
      )}
    >
      <Avatar agent={a} size={30} ring={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink-100">{a.name}</span>
          {a.promotedFrom && (
            <span title={`Promovido(a) de ${a.promotedFrom}`} className="text-[10px] text-sol">
              ⬆
            </span>
          )}
          <span className="ml-auto shrink-0">
            <ModelBadge model={a.model} compact />
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <StatusDot activity={a.activity} pulse={busy} />
          <span className="truncate text-ink-300">{task ? task.title : `${a.title} · ${act.label}`}</span>
        </div>
      </div>
    </button>
  );
}

export function Roster() {
  const view = useView();
  const config = useOffice((s) => s.config);
  const selected = useOffice((s) => s.selectedAgentId);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const byTeam = new Map<string, AgentView[]>();
    for (const id of view.agentOrder) {
      const a = view.agents[id];
      if (!a) continue;
      const list = byTeam.get(a.team) ?? [];
      list.push(a);
      byTeam.set(a.team, list);
    }
    const teamOrder = Object.keys(config?.roles.teams ?? {});
    const rank = (team: string) => {
      const i = teamOrder.indexOf(team);
      return i < 0 ? 999 : i;
    };
    return [...byTeam.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([team, agents]) => ({
        team,
        agents: agents.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]),
        cost: agents.reduce((s, a) => s + a.costUsd, 0),
      }));
  }, [view.agents, view.agentOrder, config]);

  return (
    <aside className="z-10 hidden w-[268px] shrink-0 flex-col border-r border-ink-600/50 bg-ink-850/70 lg:flex">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="font-pixel text-[13px] uppercase tracking-wider text-ink-300">Equipe</h2>
        <span className="text-[11px] text-ink-400">{view.agentOrder.length} agentes</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {groups.map(({ team, agents, cost }) => {
          const t = config?.roles.teams[team];
          const color = t?.color ?? '#94a3b8';
          const isClosed = closed[team];
          return (
            <section key={team}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-ink-700/40"
                onClick={() => setClosed((c) => ({ ...c, [team]: !c[team] }))}
              >
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color, boxShadow: `0 0 10px ${color}88` }} />
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-200">{t?.name ?? team}</span>
                <span className="ml-auto text-[10.5px] tabular text-ink-400">{formatUsd(cost)}</span>
                <ChevronDown size={13} className={cx('text-ink-400 transition', isClosed && '-rotate-90')} />
              </button>
              {!isClosed && (
                <div className="mt-0.5 space-y-0.5">
                  {agents.map((a) => (
                    <AgentRow key={a.id} a={a} selected={selected === a.id} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-400">Contratando a equipe…</p>}
      </div>
    </aside>
  );
}
