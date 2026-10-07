import { useEffect, useMemo, useState } from 'react';
import { GitPullRequest, KanbanSquare, ShieldAlert } from 'lucide-react';
import { formatUsd, type TaskDiffDto, type TaskView } from '@office/contracts';
import { api } from '../../lib/api';
import { ago } from '../../lib/format';
import { officeNow, useOffice, useView } from '../../store/store';
import { Avatar, Button, cx, Empty, ModelBadge, Pill, SectionTitle, Sheet, teamColor } from '../kit';

const COLUMNS: { id: string; label: string; statuses: TaskView['status'][]; color: string }[] = [
  { id: 'backlog', label: 'Na fila', statuses: ['backlog'], color: '#8e89b8' },
  { id: 'doing', label: 'Em andamento', statuses: ['in_progress'], color: '#5eead4' },
  { id: 'ci', label: 'CI', statuses: ['ci'], color: '#fbbf24' },
  { id: 'review', label: 'Revisão', statuses: ['review'], color: '#f472b6' },
  { id: 'blocked', label: 'Escaladas', statuses: ['blocked'], color: '#ff5470' },
  { id: 'done', label: 'Concluídas', statuses: ['done'], color: '#4ade80' },
  { id: 'failed', label: 'Falhas', statuses: ['failed', 'cancelled'], color: '#ff8fa3' },
];

const SEVERITY: Record<string, string> = { blocker: '#ff5470', major: '#fb923c', minor: '#fbbf24', nit: '#8e89b8' };

function Card({ t, onOpen, active }: { t: TaskView; onOpen: () => void; active: boolean }) {
  const view = useView();
  const assignee = t.assignee ? view.agents[t.assignee] : null;
  const color = teamColor(t.team);
  return (
    <button
      onClick={onOpen}
      className={cx(
        'w-full rounded-lg border bg-ink-800/80 p-2.5 text-left transition hover:-translate-y-px hover:bg-ink-700/70',
        active ? 'border-cyan/70' : 'border-ink-600/60',
      )}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div className="text-[12.5px] font-medium leading-snug text-ink-100">{t.title}</div>
      <div className="mt-2 flex items-center gap-1.5">
        {assignee && <Avatar agent={assignee} size={20} />}
        <span className="truncate text-[11px] text-ink-300">{assignee?.name ?? '—'}</span>
        {t.model && (
          <span className="ml-auto">
            <ModelBadge model={t.model} compact />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {t.attempt > 1 && <span className="rounded bg-ink-700 px-1 text-[10px] text-ink-200">tent. {t.attempt}</span>}
        {t.round > 0 && <span className="rounded bg-pink/15 px-1 text-[10px] text-pink">rev. {t.round}</span>}
        {t.ciFailures > 0 && <span className="rounded bg-danger/15 px-1 text-[10px] text-danger">CI ✗{t.ciFailures}</span>}
        {t.escalations > 0 && <span className="rounded bg-amber/15 px-1 text-[10px] text-amber">⬆{t.escalations}</span>}
        {t.pr?.merged && <span className="rounded bg-violet/20 px-1 text-[10px] text-astra">merged</span>}
        <span className="ml-auto text-[10.5px] tabular text-ink-400">{formatUsd(t.costUsd)}</span>
      </div>
    </button>
  );
}

function DiffView({ missionId, taskId }: { missionId: string; taskId: string }) {
  const [diff, setDiff] = useState<TaskDiffDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDiff(null);
    api<TaskDiffDto>(`/api/repo/${missionId}/tasks/${taskId}/diff`)
      .then(setDiff)
      .catch((e: Error) => setError(e.message));
  }, [missionId, taskId]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!diff) return <p className="text-sm text-ink-400">Carregando diff…</p>;
  if (!diff.diff) return <p className="text-sm text-ink-400">Sem diff (entrega só em relatório/wiki).</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-ink-600/60">
      <div className="flex flex-wrap gap-2 border-b border-ink-600/60 bg-ink-900/70 px-3 py-1.5">
        {diff.files.map((f) => (
          <span key={f.path} className="font-mono text-[11px] text-ink-200">
            {f.path} <span className="text-money">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span>
          </span>
        ))}
      </div>
      <pre className="max-h-[420px] overflow-auto bg-ink-950/70 p-3 font-mono text-[11.5px] leading-[1.45]">
        {diff.diff.split('\n').map((line, i) => (
          <div
            key={i}
            className={cx(
              line.startsWith('+') && !line.startsWith('+++') && 'bg-money/10 text-[#9ff0b9]',
              line.startsWith('-') && !line.startsWith('---') && 'bg-danger/10 text-[#ffb3c0]',
              line.startsWith('@@') && 'text-cyan',
              line.startsWith('diff ') && 'mt-2 font-semibold text-ink-100',
              !/^[+\-@d]/.test(line) && 'text-ink-300',
            )}
          >
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

function Detail({ t }: { t: TaskView }) {
  const view = useView();
  const [showDiff, setShowDiff] = useState(false);
  const assignee = t.assignee ? view.agents[t.assignee] : null;
  const reviewer = t.reviewer ? view.agents[t.reviewer] : null;
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Pill color={teamColor(t.team)}>{useOffice.getState().config?.roles.teams[t.team]?.name ?? t.team}</Pill>
          <Pill>{t.kind}</Pill>
          {t.model && <ModelBadge model={t.model} />}
          <span className="ml-auto text-[11px] text-ink-400">atualizada {ago(t.updatedAt, officeNow())}</span>
        </div>
        <h3 className="font-pixel text-lg text-ink-100">{t.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-ink-300">
          {assignee && (
            <button className="flex items-center gap-1.5 hover:text-ink-100" onClick={() => useOffice.getState().selectAgent(assignee.id)}>
              <Avatar agent={assignee} size={22} /> {assignee.name} <span className="text-ink-400">executa</span>
            </button>
          )}
          {reviewer && (
            <button className="flex items-center gap-1.5 hover:text-ink-100" onClick={() => useOffice.getState().selectAgent(reviewer.id)}>
              <Avatar agent={reviewer} size={22} /> {reviewer.name} <span className="text-ink-400">revisa</span>
            </button>
          )}
          <span className="tabular">
            {formatUsd(t.costUsd)} de {formatUsd(t.budgetUsd)}
          </span>
        </div>
      </div>

      <section>
        <SectionTitle>Ordem de serviço</SectionTitle>
        <p className="text-[13px] leading-relaxed text-ink-200">{t.objective}</p>
        <ul className="mt-2 space-y-1">
          {t.acceptance.map((c, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] text-ink-200">
              <span className="text-cyan">☐</span>
              {c}
            </li>
          ))}
        </ul>
      </section>

      {t.ci && (
        <section>
          <SectionTitle>Portões automáticos (CI)</SectionTitle>
          <div className="space-y-1.5">
            {t.ci.checks.map((c) => (
              <details key={c.name} className="rounded-lg border border-ink-600/60 bg-ink-900/50">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px]">
                  <span className={c.ok ? 'text-money' : 'text-danger'}>{c.ok ? '✓' : '✗'}</span>
                  <span className="text-ink-100">{c.name}</span>
                  <span className="ml-auto text-[11px] text-ink-400">{(c.ms / 1000).toFixed(1)} s</span>
                </summary>
                <pre className="max-h-48 overflow-auto border-t border-ink-600/60 px-3 py-2 font-mono text-[11px] text-ink-300">
                  {c.tail || '(sem saída)'}
                </pre>
              </details>
            ))}
            {t.ci.ok === null && <p className="text-[12px] text-amber">Rodando…</p>}
          </div>
        </section>
      )}

      {t.delivery && (
        <section>
          <SectionTitle>Relatório de entrega</SectionTitle>
          <p className="text-[13px] leading-relaxed text-ink-200">{t.delivery.summary}</p>
          {t.delivery.done.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {t.delivery.done.map((d, i) => (
                <li key={i} className="text-[12.5px] text-ink-200">
                  <span className="text-money">✓</span> {d}
                </li>
              ))}
            </ul>
          )}
          {t.delivery.risks.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber/30 bg-amber/[0.06] p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber">
                <ShieldAlert size={12} /> riscos
              </div>
              {t.delivery.risks.map((r, i) => (
                <p key={i} className="text-[12.5px] text-ink-200">
                  {r}
                </p>
              ))}
            </div>
          )}
          {t.delivery.questions.length > 0 && (
            <p className="mt-2 text-[12.5px] text-ink-300">Dúvidas: {t.delivery.questions.join(' · ')}</p>
          )}
        </section>
      )}

      {t.verdict && (
        <section>
          <SectionTitle>Parecer de revisão #{t.round}</SectionTitle>
          <div
            className={cx(
              'rounded-lg border p-3',
              t.verdict.approved ? 'border-money/40 bg-money/[0.06]' : 'border-pink/40 bg-pink/[0.06]',
            )}
          >
            <div className="mb-1 text-[12px] font-semibold" style={{ color: t.verdict.approved ? '#4ade80' : '#f472b6' }}>
              {t.verdict.approved ? 'APROVADO' : 'MUDANÇAS PEDIDAS'}
            </div>
            <p className="text-[12.5px] text-ink-200">{t.verdict.summary}</p>
            {t.verdict.changes.map((c, i) => (
              <div key={i} className="mt-1.5 flex items-start gap-2 text-[12.5px] text-ink-200">
                <span
                  className="rounded px-1.5 py-px text-[10px] font-semibold uppercase"
                  style={{ background: `${SEVERITY[c.severity]}22`, color: SEVERITY[c.severity] }}
                >
                  {c.severity}
                </span>
                {c.item}
              </div>
            ))}
          </div>
        </section>
      )}

      {t.pr && t.missionId && (
        <section>
          <SectionTitle
            right={
              <Button size="sm" onClick={() => setShowDiff((s) => !s)}>
                <GitPullRequest size={13} /> {showDiff ? 'Esconder diff' : 'Ver diff'}
              </Button>
            }
          >
            Pull request
          </SectionTitle>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-200">
            <span className="font-mono">{t.pr.branch}</span>
            <span className="font-mono text-ink-400">{t.pr.commit.slice(0, 7)}</span>
            {t.pr.merged ? <Pill color="#a78bfa">integrado na main</Pill> : <Pill color="#fbbf24">aberto</Pill>}
            {t.pr.url && (
              <a href={t.pr.url} target="_blank" rel="noreferrer" className="text-cyan underline">
                GitHub
              </a>
            )}
          </div>
          {showDiff && (
            <div className="mt-3">
              <DiffView missionId={t.missionId} taskId={t.id} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function BoardPanel() {
  const view = useView();
  const selectedTask = useOffice((s) => s.selectedTaskId);
  const config = useOffice((s) => s.config);
  const [team, setTeam] = useState<string | null>(null);
  const missionId = view.activeMissionId;
  const tasks = useMemo(
    () =>
      view.taskOrder
        .map((id) => view.tasks[id])
        .filter((t) => t && (!missionId || t.missionId === missionId) && (!team || t.team === team)),
    [view.tasks, view.taskOrder, missionId, team],
  );
  const detail = selectedTask ? view.tasks[selectedTask] : null;
  const teams = Object.entries(config?.roles.teams ?? {}).filter(([id]) => view.taskOrder.some((tid) => view.tasks[tid]?.team === id));
  return (
    <Sheet
      wide
      title="Quadro de tarefas"
      icon={<KanbanSquare size={18} />}
      subtitle="Tarefas descem; entregas sobem com evidência. Clique num cartão para ver ordem de serviço, CI, parecer e diff."
      onClose={() => useOffice.getState().openPanel(null)}
      actions={
        <div className="hidden items-center gap-1 md:flex">
          <button
            onClick={() => setTeam(null)}
            className={cx('rounded-md px-2 py-1 text-xs', !team ? 'bg-ink-600 text-ink-100' : 'text-ink-300 hover:text-ink-100')}
          >
            todos
          </button>
          {teams.map(([id, t]) => (
            <button
              key={id}
              onClick={() => setTeam(id)}
              className={cx(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                team === id ? 'bg-ink-600 text-ink-100' : 'text-ink-300 hover:text-ink-100',
              )}
            >
              <span className="h-2 w-2 rounded-sm" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      }
    >
      {tasks.length === 0 ? (
        <Empty icon={<KanbanSquare size={36} />} title="Quadro vazio">
          Quando o CEO delegar e os líderes planejarem, as tarefas aparecem aqui.
        </Empty>
      ) : (
        <div className="flex h-full min-h-[520px]">
          <div className="grid min-w-0 flex-1 auto-cols-[minmax(190px,1fr)] grid-flow-col gap-3 overflow-x-auto p-4">
            {COLUMNS.map((col) => {
              const list = tasks.filter((t) => col.statuses.includes(t.status));
              return (
                <div key={col.id} className="flex min-h-0 flex-col rounded-xl bg-ink-900/40 p-2">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                    <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-200">{col.label}</span>
                    <span className="ml-auto text-[11px] text-ink-400">{list.length}</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                    {list.map((t) => (
                      <Card
                        key={t.id}
                        t={t}
                        active={t.id === selectedTask}
                        onOpen={() => useOffice.getState().selectTask(t.id === selectedTask ? null : t.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {detail && (
            <div className="w-[440px] shrink-0 overflow-y-auto border-l border-ink-600/60 bg-ink-850/60">
              <Detail t={detail} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
