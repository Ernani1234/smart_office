import { useEffect, useState } from 'react';
import { Building2, CircleDollarSign, Gavel, History, MousePointerClick, Octagon, Target, X } from 'lucide-react';
import { useOffice, useView } from '../store/store';
import { ApprovalsPanel } from './panels/Approvals';
import { BoardPanel } from './panels/Board';
import { FinancePanel } from './panels/Finance';
import { MissionsPanel } from './panels/Missions';
import { RepoPanel } from './panels/Repo';
import { TeamPanel } from './panels/Team';
import { WikiPanel } from './panels/Wiki';
import { Button, cx } from './kit';
import { useSetupVisible } from './Setup';

export function PanelHost() {
  const panel = useOffice((s) => s.panel);
  switch (panel) {
    case 'board':
      return <BoardPanel />;
    case 'finance':
      return <FinancePanel />;
    case 'approvals':
      return <ApprovalsPanel />;
    case 'team':
      return <TeamPanel />;
    case 'wiki':
      return <WikiPanel />;
    case 'missions':
      return <MissionsPanel />;
    case 'repo':
      return <RepoPanel />;
    default:
      return null;
  }
}

const TOAST_STYLE: Record<string, string> = {
  info: 'border-ink-500/70',
  success: 'border-money/60',
  warning: 'border-amber/60',
  error: 'border-danger/70',
  board: 'border-gold/70 shadow-[0_0_30px_-10px_rgba(242,193,78,0.8)]',
  money: 'border-gold/70',
};
const TOAST_DOT: Record<string, string> = {
  info: 'bg-ink-300',
  success: 'bg-money',
  warning: 'bg-amber',
  error: 'bg-danger',
  board: 'bg-gold',
  money: 'bg-gold',
};

export function Toasts() {
  const toasts = useOffice((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-40 flex w-[320px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx('panel pointer-events-auto cursor-pointer rounded-xl border px-3.5 py-2.5', TOAST_STYLE[t.kind])}
          onClick={() => {
            if (t.panel) useOffice.getState().openPanel(t.panel);
            if (t.agentId) useOffice.getState().selectAgent(t.agentId);
            useOffice.getState().dismissToast(t.id);
          }}
        >
          <div className="flex items-center gap-2">
            <span className={cx('h-2 w-2 shrink-0 rounded-full', TOAST_DOT[t.kind])} />
            <span className="text-[13px] font-semibold text-ink-100">{t.title}</span>
          </div>
          {t.body && <p className="mt-0.5 line-clamp-3 pl-4 text-[12px] leading-snug text-ink-200">{t.body}</p>}
        </div>
      ))}
    </div>
  );
}

/** Boas-vindas quando ainda não há missão. */
export function Welcome() {
  const view = useView();
  const config = useOffice((s) => s.config);
  const backlogDone = useOffice((s) => s.backlogDone);
  const [dismissed, setDismissed] = useState(false);
  const setup = useSetupVisible();
  if (!backlogDone || dismissed || setup.visible || view.missionOrder.length > 0) return null;
  const tips = [
    { icon: <Target size={16} />, text: 'Crie uma Missão: meta de lucro líquido, teto de gasto, prazo e fonte da receita.' },
    { icon: <MousePointerClick size={16} />, text: 'Clique em qualquer agente para ver o raciocínio, as ferramentas e falar com ele.' },
    { icon: <Gavel size={16} />, text: 'Você é o Conselho: publicar, deploy, gastar e contatar pessoas passam por você.' },
    { icon: <CircleDollarSign size={16} />, text: 'O cofre mostra o lucro líquido; o Financeiro conta cada centavo por código.' },
    { icon: <History size={16} />, text: 'Replay: reassista a madrugada da empresa em 10× pela linha do tempo.' },
    { icon: <Octagon size={16} />, text: 'Pânico pausa todas as missões na hora (sinal ao Temporal).' },
  ];
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink-950/45 p-4">
      <div className="panel relative w-full max-w-[560px] rounded-2xl p-6">
        <button
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-ink-700"
          onClick={() => setDismissed(true)}
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan/15 text-cyan">
            <Building2 size={24} />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-ink-300">bem-vindo(a) ao Conselho</div>
            <h2 className="font-pixel text-2xl text-ink-100">{config?.companyName ?? 'Pixel Corp'} está de portas abertas</h2>
          </div>
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-200">
          {view.agentOrder.length} agentes contratados, organizados em hierarquia curta. Eles trabalham por evento, provam o que fazem com
          evidência (CI, testes, revisão) e nada irreversível acontece sem você.
          {config?.mode === 'sim' && (
            <span className="text-astra">
              {' '}
              Modo simulação: cérebros roteirizados, mãos reais — Git, CI, banco e Temporal de verdade, custo calculado e nada cobrado.
            </span>
          )}
          {config?.mode === 'real' && (
            <span className="text-sol">
              {' '}
              Modo real: os agentes pensam com os modelos da sua conta OpenAI, e cada missão para no teto de gasto que você definir.
            </span>
          )}
        </p>
        <ul className="mt-4 grid gap-2">
          {tips.map((t, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-ink-200">
              <span className="mt-px text-cyan">{t.icon}</span>
              {t.text}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" onClick={() => setDismissed(true)}>
            Explorar o escritório
          </Button>
          <Button variant="primary" onClick={() => useOffice.getState().setNewMissionOpen(true)}>
            <Target size={15} /> Criar a primeira missão
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Atalhos: Esc fecha; 1–7 abrem painéis; espaço controla o replay. */
export function useShortcuts() {
  useEffect(() => {
    const panels = ['board', 'finance', 'approvals', 'team', 'wiki', 'repo', 'missions'] as const;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const s = useOffice.getState();
      if (e.key === 'Escape') {
        if (s.setupOpen) s.setSetupOpen(false);
        else if (s.newMissionOpen) s.setNewMissionOpen(false);
        else if (s.panel) s.openPanel(null);
        else s.selectAgent(null);
      } else if (/^[1-7]$/.test(e.key)) {
        const p = panels[Number(e.key) - 1];
        s.openPanel(s.panel === p ? null : p);
      } else if (e.key === ' ' && s.replay.active) {
        e.preventDefault();
        s.togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
