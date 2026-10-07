import { useState } from 'react';
import { Check, Gavel, Megaphone, Rocket, ShieldQuestion, Users, Wallet, X } from 'lucide-react';
import { formatUsd, type ApprovalView } from '@office/contracts';
import { api } from '../../lib/api';
import { ago, dateTime } from '../../lib/format';
import { officeNow, useOffice, useView } from '../../store/store';
import { Avatar, Button, cx, Empty, Pill, SectionTitle, Sheet } from '../kit';

// Você é o Conselho: aprova tudo o que não tem volta — gastar dinheiro,
// publicar, falar com gente de verdade e fazer deploy em produção.

const KIND: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  publish: { label: 'Publicar', icon: <Megaphone size={18} />, color: '#f472b6' },
  deploy: { label: 'Deploy em produção', icon: <Rocket size={18} />, color: '#5eead4' },
  spend: { label: 'Gastar dinheiro', icon: <Wallet size={18} />, color: '#f2c14e' },
  contact: { label: 'Contatar pessoas', icon: <Users size={18} />, color: '#93c5fd' },
  escalation: { label: 'Decisão escalada', icon: <ShieldQuestion size={18} />, color: '#ff5470' },
};

function Pending({ a }: { a: ApprovalView }) {
  const view = useView();
  const replay = useOffice((s) => s.replay.active);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const k = KIND[a.kind] ?? KIND.escalation;
  const who = view.agents[a.requestedBy];
  const decide = async (approved: boolean) => {
    setBusy(true);
    try {
      await api(`/api/approvals/${a.id}`, { method: 'POST', json: { approved, note: note.trim() || null } });
    } catch (err) {
      useOffice.getState().toast({ kind: 'error', title: 'Não foi possível decidir', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="relative overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-br from-[#2a2110]/80 to-ink-900/60 p-5 shadow-[0_0_40px_-18px_rgba(242,193,78,0.7)]">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${k.color}22`, color: k.color }}>
          {k.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill color={k.color}>{k.label}</Pill>
            {a.amountUsd !== null && <Pill color="#f2c14e">{formatUsd(a.amountUsd)}</Pill>}
            <span className="text-[11px] text-ink-400">{ago(a.createdAt, officeNow())}</span>
          </div>
          <h3 className="mt-1.5 font-pixel text-lg leading-snug text-ink-100">{a.title}</h3>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-200">{a.detail}</p>
          {who && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-300">
              <Avatar agent={who} size={22} /> pedido por {who.name} ({who.title})
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota para a empresa (opcional — ex.: URL de produção, condição)"
          className="h-10 min-w-0 flex-1 rounded-lg border border-ink-500/60 bg-ink-950/50 px-3 text-sm outline-none focus:border-gold/70"
          disabled={replay}
        />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void decide(false)} disabled={busy || replay}>
            <X size={15} /> Rejeitar
          </Button>
          <Button variant="gold" onClick={() => void decide(true)} disabled={busy || replay}>
            <Check size={15} /> Aprovar
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ApprovalsPanel() {
  const view = useView();
  const all = Object.values(view.approvals).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const pending = all.filter((a) => a.status === 'pending');
  const history = all.filter((a) => a.status !== 'pending');
  return (
    <Sheet
      title="Conselho"
      icon={<Gavel size={18} />}
      subtitle="Nada irreversível acontece sem você: dinheiro, publicação, contato com pessoas e deploy."
      onClose={() => useOffice.getState().openPanel(null)}
    >
      <div className="space-y-6 p-5">
        <section className="space-y-3">
          <SectionTitle>Pendentes</SectionTitle>
          {pending.length === 0 ? (
            <Empty icon={<Gavel size={34} />} title="Mesa limpa">
              Quando a CEO pedir algo irreversível, o pedido chega aqui e na sala do Conselho, no escritório.
            </Empty>
          ) : (
            pending.map((a) => <Pending key={a.id} a={a} />)
          )}
        </section>
        {history.length > 0 && (
          <section>
            <SectionTitle>Histórico</SectionTitle>
            <ul className="divide-y divide-ink-700/60 overflow-hidden rounded-xl border border-ink-600/60">
              {history.map((a) => {
                const k = KIND[a.kind] ?? KIND.escalation;
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span style={{ color: k.color }}>{k.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink-100">{a.title}</div>
                      {a.note && <div className="truncate text-[11.5px] text-ink-300">“{a.note}”</div>}
                    </div>
                    <span
                      className={cx(
                        'rounded-md px-2 py-0.5 text-[11px] font-semibold',
                        a.status === 'approved'
                          ? 'bg-money/15 text-money'
                          : a.status === 'rejected'
                            ? 'bg-danger/15 text-danger'
                            : 'bg-ink-600 text-ink-300',
                      )}
                    >
                      {a.status === 'approved' ? 'aprovado' : a.status === 'rejected' ? 'rejeitado' : 'expirou'}
                    </span>
                    <span className="w-28 text-right text-[11px] text-ink-400">{a.decidedAt ? dateTime(a.decidedAt) : ''}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
