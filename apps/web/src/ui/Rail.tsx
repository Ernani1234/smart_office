import { BookOpen, Building2, Gavel, GitBranch, KanbanSquare, PiggyBank, Target, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useOffice, useView, type PanelId } from '../store/store';
import { cx } from './kit';

const ITEMS: { id: PanelId | null; label: string; icon: ReactNode; key: string }[] = [
  { id: null, label: 'Escritório', icon: <Building2 size={19} />, key: 'Esc' },
  { id: 'board', label: 'Quadro de tarefas', icon: <KanbanSquare size={19} />, key: '1' },
  { id: 'finance', label: 'Financeiro', icon: <PiggyBank size={19} />, key: '2' },
  { id: 'approvals', label: 'Conselho (aprovações)', icon: <Gavel size={19} />, key: '3' },
  { id: 'team', label: 'Equipe (roles.yaml)', icon: <Users size={19} />, key: '4' },
  { id: 'wiki', label: 'Wiki', icon: <BookOpen size={19} />, key: '5' },
  { id: 'repo', label: 'Repositório', icon: <GitBranch size={19} />, key: '6' },
  { id: 'missions', label: 'Missões', icon: <Target size={19} />, key: '7' },
];

export function Rail() {
  const panel = useOffice((s) => s.panel);
  const view = useView();
  const pending = Object.values(view.approvals).filter((a) => a.status === 'pending').length;
  const running = Object.values(view.tasks).filter((t) => ['in_progress', 'ci', 'review'].includes(t.status)).length;
  return (
    <nav className="z-10 flex w-[58px] shrink-0 flex-col items-center gap-1 border-r border-ink-600/50 bg-ink-850/80 py-3">
      {ITEMS.map((it) => {
        const active = panel === it.id;
        const badge = it.id === 'approvals' ? pending : it.id === 'board' ? running : 0;
        return (
          <button
            key={it.label}
            onClick={() => useOffice.getState().openPanel(it.id)}
            className={cx(
              'group relative grid h-11 w-11 place-items-center rounded-xl transition',
              active
                ? 'bg-ink-700 text-cyan shadow-[inset_0_0_0_1px_rgba(94,234,212,0.35)]'
                : 'text-ink-300 hover:bg-ink-700/60 hover:text-ink-100',
            )}
            aria-label={it.label}
          >
            {it.icon}
            {badge > 0 && (
              <span
                className={cx(
                  'absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold',
                  it.id === 'approvals' ? 'bg-gold text-ink-950' : 'bg-cyan text-ink-950',
                )}
              >
                {badge}
              </span>
            )}
            <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap rounded-md border border-ink-500 bg-ink-800 px-2 py-1 text-xs text-ink-100 shadow-xl group-hover:block">
              {it.label} <span className="ml-1 text-ink-400">{it.key}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
