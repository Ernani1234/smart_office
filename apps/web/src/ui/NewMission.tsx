import { useState } from 'react';
import { AlertTriangle, Calendar, Coins, Gauge, Target, X } from 'lucide-react';
import { formatUsd } from '@office/contracts';
import { api } from '../lib/api';
import { useOffice } from '../store/store';
import { Button, cx, Field, inputClass } from './kit';

// “Só pare quando gerar US$ 10 mil” vira uma Missão com quatro campos:
// métrica (lucro líquido), fonte (meio de pagamento, lida por código), teto de
// gasto e prazo. Termina no que vier primeiro.

const PLAYBOOK = `Encontrar um nicho com dor clara, construir um produto pequeno e vendê-lo.

1. Produto: pesquisar o nicho e especificar um MVP mínimo (dor, público, preço).
2. Engenharia: construir o MVP com testes; QA testa de forma independente.
3. Growth: página de venda, copy honesta e SEO.
4. Pedir ao Conselho para publicar e fazer deploy.
5. Depois do lançamento, só investir mais com evidência de retorno.`;

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewMissionDialog() {
  const config = useOffice((s) => s.config);
  const real = config?.mode === 'real';
  const [title, setTitle] = useState('Primeiros dólares com um micro-SaaS');
  const [brief, setBrief] = useState(PLAYBOOK);
  const [goal, setGoal] = useState(100);
  const [cap, setCap] = useState(real ? 10 : 5);
  const [deadline, setDeadline] = useState(localInput(new Date(Date.now() + (real ? 14 * 86400_000 : 2 * 3600_000))));
  const [source, setSource] = useState<string>(
    config?.revenueSources.includes('sim') && !real ? 'sim' : (config?.revenueSources[0] ?? 'sim'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => useOffice.getState().setNewMissionOpen(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ warning?: string }>('/api/missions', {
        method: 'POST',
        json: { title, brief, goalUsd: goal, spendCapUsd: cap, deadline: new Date(deadline).toISOString(), revenueSource: source },
      });
      if (res.warning) useOffice.getState().toast({ kind: 'warning', title: 'Missão criada, aguardando o Temporal', body: res.warning });
      else
        useOffice.getState().toast({ kind: 'success', title: 'Missão iniciada', body: 'A CEO foi acionada. Acompanhe pelo escritório.' });
      useOffice.getState().openPanel(null);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ratio = cap / goal;
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-ink-950/70 p-4" onMouseDown={close}>
      <div className="panel w-full max-w-[820px] overflow-hidden rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-ink-600/60 px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan/15 text-cyan">
            <Target size={20} />
          </span>
          <div className="flex-1">
            <h2 className="font-pixel text-xl text-ink-100">Nova missão</h2>
            <p className="text-xs text-ink-300">A CEO é acionada assim que você confirmar. Uma missão de cada vez.</p>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-ink-700" onClick={close}>
            <X size={17} />
          </button>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <Field label="Título">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </Field>
            <Field
              label="Briefing para a CEO"
              hint="O playbook de pesquisar nicho → construir → go-to-market já serve de ponto de partida."
            >
              <textarea
                className={cx(inputClass, '!h-[210px] resize-none py-2 leading-relaxed')}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </Field>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-ink-600/60 bg-ink-900/40 p-3.5">
              <div className="mb-3 text-[11px] uppercase tracking-wider text-ink-300">Os quatro campos</div>
              <div className="space-y-3">
                <Field label="Meta de lucro líquido (US$)" hint="Lucro, não receita: receita líquida menos todo o gasto.">
                  <div className="relative">
                    <Coins size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-money" />
                    <input
                      type="number"
                      min={1}
                      className={cx(inputClass, 'pl-8 tabular')}
                      value={goal}
                      onChange={(e) => setGoal(Number(e.target.value))}
                    />
                  </div>
                </Field>
                <Field label="Teto de gasto (US$)" hint="Rígido: a chamada que estourar é recusada pelo livro-caixa.">
                  <div className="relative">
                    <Gauge size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber" />
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      className={cx(inputClass, 'pl-8 tabular')}
                      value={cap}
                      onChange={(e) => setCap(Number(e.target.value))}
                    />
                  </div>
                </Field>
                <Field label="Prazo">
                  <div className="relative">
                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
                    <input
                      type="datetime-local"
                      className={cx(inputClass, 'pl-8')}
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </div>
                </Field>
                <Field
                  label="Fonte da receita (lida por código)"
                  hint={
                    real && source === 'sim'
                      ? 'Clientes fictícios compram depois do lançamento; o custo dos agentes é real. Para receita de verdade, configure Polar, Lemon Squeezy ou Paddle no .env.'
                      : undefined
                  }
                >
                  <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
                    {(config?.revenueSources ?? ['sim']).map((s) => (
                      <option key={s} value={s}>
                        {s === 'sim' ? 'Mercado simulado' : s === 'lemonsqueezy' ? 'Lemon Squeezy' : s[0].toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            {ratio >= 0.5 && (
              <p className="flex gap-2 rounded-lg border border-amber/40 bg-amber/[0.07] p-2.5 text-[12px] text-amber">
                <AlertTriangle size={15} className="shrink-0" />
                Teto em {Math.round(ratio * 100)}% da meta. O plano recomenda mirar os primeiros US$ 100 com teto bem abaixo disso.
              </p>
            )}
            {real && (
              <p className="flex gap-2 rounded-lg border border-danger/50 bg-danger/[0.08] p-2.5 text-[12px] text-[#ffb3c0]">
                <AlertTriangle size={15} className="shrink-0" />
                MODO REAL: chamadas cobradas na sua conta OpenAI até {formatUsd(cap)}. Configure também o spend limit do projeto na OpenAI.
              </p>
            )}
          </div>
        </div>
        {error && <div className="mx-5 mb-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        <footer className="flex items-center justify-end gap-2 border-t border-ink-600/60 px-5 py-3.5">
          <Button variant="subtle" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !title.trim() || goal <= 0 || cap <= 0} onClick={() => void submit()}>
            <Target size={15} /> Iniciar missão
          </Button>
        </footer>
      </div>
    </div>
  );
}
