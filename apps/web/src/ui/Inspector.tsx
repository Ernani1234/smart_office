import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronsUp, Crosshair, FileCode2, MessageCircle, Send, Wrench, X } from 'lucide-react';
import { formatUsd, type AgentView, type TaskView } from '@office/contracts';
import { api } from '../lib/api';
import { ago, clockTime, tokens } from '../lib/format';
import { officeNow, useOffice, useView } from '../store/store';
import { activityInfo, Avatar, Button, cx, ModelBadge, Pill, StatusDot, teamColor } from './kit';

// O inspetor mostra o que o trabalhador "pensa": o resumo do raciocínio em
// streaming (a OpenAI não expõe o raciocínio bruto), a linha do tempo de
// ferramentas, os arquivos alterados, o custo acumulado e um campo para falar
// com o agente no meio da tarefa.

type Tab = 'thoughts' | 'tools' | 'files' | 'chat';

function TaskCard({ task }: { task: TaskView }) {
  const statusLabel: Record<string, string> = {
    backlog: 'na fila',
    in_progress: 'em andamento',
    ci: 'rodando CI',
    review: 'em revisão',
    blocked: 'bloqueada',
    done: 'concluída',
    failed: 'falhou',
    cancelled: 'cancelada',
  };
  return (
    <div className="rounded-xl border border-ink-600/60 bg-ink-900/50 p-3">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-300">
        <span>tarefa atual</span>
        <span className="ml-auto">{statusLabel[task.status]}</span>
      </div>
      <button
        className="text-left text-sm font-medium text-ink-100 hover:text-cyan"
        onClick={() => {
          useOffice.getState().selectTask(task.id);
          useOffice.getState().openPanel('board');
        }}
      >
        {task.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.model && <ModelBadge model={task.model} />}
        <Pill>tentativa {task.attempt || 1}</Pill>
        {task.round > 0 && <Pill>revisão #{task.round}</Pill>}
        {task.ciFailures > 0 && <Pill color="#ff5470">CI ✗ {task.ciFailures}×</Pill>}
        <Pill color="#8e89b8">
          {formatUsd(task.costUsd)} / {formatUsd(task.budgetUsd)}
        </Pill>
      </div>
      {task.ci && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.ci.checks.length === 0 && task.ci.ok === null && <span className="text-[11px] text-amber">CI rodando…</span>}
          {task.ci.checks.map((c) => (
            <span
              key={c.name}
              className={cx('rounded px-1.5 py-px font-mono text-[10.5px]', c.ok ? 'bg-money/15 text-money' : 'bg-danger/15 text-danger')}
            >
              {c.ok ? '✓' : '✗'} {c.name}
            </span>
          ))}
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {task.acceptance.map((c, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] text-ink-200">
            <span className="text-ink-400">▸</span>
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thoughts({ a }: { a: AgentView }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [a.thoughts.length]);
  if (!a.thoughts.length) return <p className="py-6 text-center text-sm text-ink-400">Ainda sem resumo de raciocínio.</p>;
  return (
    <div className="space-y-2">
      {a.thoughts.slice(-30).map((t, i) => (
        <div key={i} className="rounded-lg border border-violet/20 bg-violet/[0.06] px-3 py-2">
          <div className="mb-0.5 text-[10px] text-ink-400">{clockTime(t.ts)}</div>
          <p className="text-[12.5px] italic leading-relaxed text-ink-200">{t.text}</p>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

function Tools({ a }: { a: AgentView }) {
  if (!a.tools.length) return <p className="py-6 text-center text-sm text-ink-400">Nenhuma ferramenta usada ainda.</p>;
  return (
    <ol className="relative ml-2 space-y-2 border-l border-ink-600 pl-4">
      {[...a.tools].reverse().map((t) => (
        <li key={t.callId} className="relative">
          <span
            className={cx(
              'absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-ink-800',
              t.ok === null ? 'animate-pulse bg-amber' : t.ok ? 'bg-money' : 'bg-danger',
            )}
          />
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-ink-100">{t.label}</span>
            {t.ms !== null && <span className="ml-auto text-[10px] text-ink-400">{(t.ms / 1000).toFixed(1)} s</span>}
          </div>
          {t.summary && <p className="mt-0.5 line-clamp-2 font-mono text-[11px] text-ink-300">{t.summary}</p>}
        </li>
      ))}
    </ol>
  );
}

function Files({ a }: { a: AgentView }) {
  if (!a.files.length) return <p className="py-6 text-center text-sm text-ink-400">Nenhum arquivo alterado.</p>;
  return (
    <ul className="space-y-1">
      {[...a.files].reverse().map((f, i) => (
        <li key={i} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-ink-700/40">
          <FileCode2 size={13} className="text-ink-400" />
          <span className="truncate font-mono text-[12px] text-ink-100">{f.path}</span>
          <span className="ml-auto shrink-0 font-mono text-[11px]">
            <span className="text-money">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Chat({ a }: { a: AgentView }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const replay = useOffice((s) => s.replay.active);
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api(`/api/agents/${a.id}/message`, { method: 'POST', json: { text } });
      setText('');
    } catch (err) {
      useOffice.getState().toast({ kind: 'error', title: 'Recado não enviado', body: (err as Error).message });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {a.chat.length === 0 && (
          <p className="py-4 text-center text-[12.5px] text-ink-400">
            Mande um recado: ele entra no próximo turno do agente (mid-turn steering). Ex.: “priorize os testes de borda”.
          </p>
        )}
        {a.chat.map((c, i) => (
          <div key={i} className={cx('flex', c.from === 'board' ? 'justify-end' : 'justify-start')}>
            <div
              className={cx(
                'max-w-[85%] rounded-2xl px-3 py-1.5 text-[12.5px]',
                c.from === 'board' ? 'rounded-br-sm bg-gold/90 text-ink-950' : 'rounded-bl-sm bg-ink-700 text-ink-100',
              )}
            >
              {c.text}
              <div className={cx('mt-0.5 text-[9.5px]', c.from === 'board' ? 'text-ink-900/70' : 'text-ink-400')}>{clockTime(c.ts)}</div>
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={replay}
          placeholder={replay ? 'Volte ao vivo para falar' : `Falar com ${a.name}…`}
          className="h-9 min-w-0 flex-1 rounded-lg border border-ink-500/60 bg-ink-900/70 px-3 text-sm outline-none focus:border-gold/70"
        />
        <Button variant="gold" size="sm" className="h-9 w-9 !px-0" disabled={sending || replay || !text.trim()}>
          <Send size={14} />
        </Button>
      </form>
    </div>
  );
}

function Promote({ a }: { a: AgentView }) {
  const config = useOffice((s) => s.config);
  const [open, setOpen] = useState(false);
  const models = Object.entries(config?.pricing.models ?? {}).filter(([, p]) => p.tier !== 'embedding');
  const promote = async (model: string) => {
    setOpen(false);
    try {
      await api(`/api/agents/${a.id}/promote`, { method: 'POST', json: { model } });
    } catch (err) {
      useOffice.getState().toast({ kind: 'error', title: 'Promoção recusada', body: (err as Error).message });
    }
  };
  const reset = async () => {
    setOpen(false);
    await api(`/api/agents/${a.id}/reset`, { method: 'POST' }).catch(() => undefined);
  };
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} title="Promoção vira upgrade de modelo (roles.yaml → overrides)">
        <ChevronsUp size={14} /> Modelo
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-60 rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl">
          {models.map(([id, p]) => (
            <button
              key={id}
              className={cx(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink-700',
                id === a.model && 'bg-ink-700/60',
              )}
              onClick={() => void promote(id)}
            >
              <ModelBadge model={id} />
              <span className="ml-auto text-[10.5px] text-ink-400">
                ${p.input}/${p.output}
              </span>
            </button>
          ))}
          <button
            className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-300 hover:bg-ink-700"
            onClick={() => void reset()}
          >
            Voltar ao modelo do cargo
          </button>
        </div>
      )}
    </div>
  );
}

export function Inspector() {
  const id = useOffice((s) => s.selectedAgentId);
  const following = useOffice((s) => s.following);
  const view = useView();
  const a = id ? view.agents[id] : null;
  const [tab, setTab] = useState<Tab>('thoughts');
  if (!a) return null;
  const task = a.taskId ? view.tasks[a.taskId] : null;
  const act = activityInfo(a.activity);
  const color = teamColor(a.team);
  const team = useOffice.getState().config?.roles.teams[a.team]?.name ?? a.team;
  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'thoughts', label: 'Raciocínio', icon: <Brain size={13} />, count: a.thoughts.length },
    { id: 'tools', label: 'Ferramentas', icon: <Wrench size={13} />, count: a.tools.length },
    { id: 'files', label: 'Arquivos', icon: <FileCode2 size={13} />, count: a.files.length },
    { id: 'chat', label: 'Conversa', icon: <MessageCircle size={13} />, count: a.chat.length },
  ];
  return (
    <aside className="z-10 flex w-[372px] shrink-0 flex-col border-l border-ink-600/50 bg-ink-850/85">
      <div
        className="relative overflow-hidden border-b border-ink-600/50 p-4"
        style={{ background: `linear-gradient(135deg, ${color}22, transparent 60%)` }}
      >
        <button
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-ink-700"
          onClick={() => useOffice.getState().selectAgent(null)}
        >
          <X size={15} />
        </button>
        <div className="flex items-center gap-3">
          <Avatar agent={a} size={56} ring />
          <div className="min-w-0">
            <div className="font-pixel text-xl leading-tight text-ink-100">{a.name}</div>
            <div className="text-[12.5px] text-ink-200">{a.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Pill color={color}>{team}</Pill>
              <ModelBadge model={a.model} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px]">
          <StatusDot activity={a.activity} pulse={a.activity !== 'idle'} />
          <span style={{ color: act.color }}>{act.label}</span>
          <span className="text-ink-400">
            · esforço {a.effort} · {a.billing}
          </span>
          {a.lastActiveTs && <span className="ml-auto text-[10.5px] text-ink-400">{ago(a.lastActiveTs, officeNow())}</span>}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            ['custo', formatUsd(a.costUsd)],
            ['chamadas', String(a.calls)],
            ['tokens', `${tokens(a.tokensIn)}→${tokens(a.tokensOut)}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-ink-900/60 px-2 py-1.5">
              <div className="text-[9.5px] uppercase tracking-wider text-ink-400">{k}</div>
              <div className="truncate font-pixel text-[13px] text-ink-100">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={() => useOffice.getState().setFollowing(!following)}
            className={cx(following && '!border-cyan !text-cyan')}
          >
            <Crosshair size={13} /> {following ? 'Seguindo' : 'Seguir'}
          </Button>
          <Promote a={a} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {task && (
          <div className="mb-4">
            <TaskCard task={task} />
          </div>
        )}
        <div className="mb-3 flex gap-1 rounded-lg bg-ink-900/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11.5px] transition',
                tab === t.id ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:text-ink-100',
              )}
            >
              {t.icon}
              {t.label}
              {t.count > 0 && <span className="text-[10px] text-ink-400">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className={cx(tab === 'chat' && 'h-[360px]')}>
          {tab === 'thoughts' && <Thoughts a={a} />}
          {tab === 'tools' && <Tools a={a} />}
          {tab === 'files' && <Files a={a} />}
          {tab === 'chat' && <Chat a={a} />}
        </div>
      </div>
    </aside>
  );
}
