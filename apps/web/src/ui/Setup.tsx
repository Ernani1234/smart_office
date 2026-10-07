import { useMemo, useState, type ReactNode } from 'react';
import {
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  FlaskConical,
  Gauge,
  KeyRound,
  LoaderCircle,
  Lock,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  X,
  Zap,
} from 'lucide-react';
import type { ServerConfig } from '@office/contracts';
import { ApiError, api, health } from '../lib/api';
import { useOffice } from '../store/store';
import { Button, cx, inputClass, ModelBadge } from './kit';

// A única configuração que o escritório pede: a chave da OpenAI. Na primeira
// vez a tela cobre tudo; depois abre pelo selo de modo na barra do topo. A API
// confere a chave (de graça), guarda em .env.local e religa em modo real.

type Phase = 'idle' | 'checking' | 'restarting';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a API voltar no modo pedido depois de religar. */
async function waitForMode(mode: 'real' | 'sim', timeoutMs = 90_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  await sleep(600);
  while (Date.now() < until) {
    if ((await health())?.mode === mode) return true;
    await sleep(700);
  }
  return false;
}

/** Modelo mais comum em cada nível da hierarquia. */
function brains(config: ServerConfig): { label: string; model: string }[] {
  const pick = (levels: string[]) => {
    const count = new Map<string, number>();
    for (const a of config.roster) if (levels.includes(a.level)) count.set(a.model, (count.get(a.model) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const out: { label: string; model: string }[] = [];
  for (const [label, levels] of [
    ['CEO', ['executive']],
    ['Líderes', ['lead']],
    ['Time', ['worker', 'staff']],
  ] as const) {
    const model = pick([...levels]);
    if (model) out.push({ label, model });
  }
  return out;
}

/** A tela da chave está à mostra? (primeira vez, ou aberta pelo selo de modo) */
export function useSetupVisible(): { visible: boolean; first: boolean } {
  const config = useOffice((s) => s.config);
  const open = useOffice((s) => s.setupOpen);
  const skipped = useOffice((s) => s.setupSkipped);
  const first = Boolean(config?.setup.required && !skipped);
  return { visible: Boolean(config) && (first || open), first };
}

export function SetupGate() {
  const config = useOffice((s) => s.config);
  const { visible, first } = useSetupVisible();
  if (!config || !visible) return null;
  return <SetupDialog config={config} first={first} />;
}

function Notice({ tone, children }: { tone: 'danger' | 'amber'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'mt-3 flex gap-2 rounded-lg border p-2.5 text-[12.5px] leading-snug',
        tone === 'danger' ? 'border-danger/50 bg-danger/10 text-[#ffb3c0]' : 'border-amber/40 bg-amber/[0.07] text-amber',
      )}
    >
      <TriangleAlert size={15} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[12px] leading-snug text-ink-300">
      <span className="mt-px shrink-0 text-cyan">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Team({ config }: { config: ServerConfig }) {
  const team = useMemo(() => brains(config), [config]);
  if (!team.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {team.map((b) => (
        <span key={b.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-300">
          {b.label} <ModelBadge model={b.model} />
        </span>
      ))}
    </div>
  );
}

function SetupDialog({ config, first }: { config: ServerConfig; first: boolean }) {
  const { setup } = config;
  const real = config.mode === 'real';
  const [editing, setEditing] = useState(!real);
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const busy = phase !== 'idle';

  const close = () => {
    if (!busy) useOffice.getState().setSetupOpen(false);
  };

  const finish = async (mode: 'real' | 'sim') => {
    setPhase('restarting');
    if (!(await waitForMode(mode))) throw new Error('O escritório não voltou a tempo. Confira o terminal do pnpm dev.');
    const s = useOffice.getState();
    await s.loadConfig();
    s.setSetupSkipped(mode === 'sim');
    s.setSetupOpen(false);
  };

  const connect = async (force = false) => {
    setPhase('checking');
    setError(null);
    setMissing(null);
    try {
      const res = await api<{ keyHint: string; missing: string[]; warning: string | null }>('/api/setup/openai', {
        method: 'POST',
        json: { apiKey: key, force },
      });
      setKey('');
      await finish('real');
      const s = useOffice.getState();
      s.toast({
        kind: 'success',
        title: 'Modo real ligado',
        body: `Chave ${res.keyHint}. Os agentes pensam com os modelos da OpenAI, até o teto de cada missão.`,
      });
      if (res.warning) s.toast({ kind: 'warning', title: 'Chave conectada com ressalva', body: res.warning });
      if (res.missing.length) {
        s.toast({
          kind: 'warning',
          title: 'Modelos sem acesso',
          body: `${res.missing.join(', ')}: troque esses cargos na aba Equipe.`,
          panel: 'team',
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.body?.code === 'missing_models') setMissing((err.body.missing as string[] | undefined) ?? []);
      else setError((err as Error).message);
      setPhase('idle');
    }
  };

  const disconnect = async () => {
    setPhase('checking');
    setError(null);
    try {
      await api('/api/setup/openai', { method: 'DELETE' });
      await finish('sim');
      useOffice
        .getState()
        .toast({ kind: 'info', title: 'De volta à simulação', body: 'Chave removida desta máquina; nada mais é cobrado.' });
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  };

  const explore = () => {
    const s = useOffice.getState();
    s.setSetupSkipped(true);
    s.setSetupOpen(false);
  };

  const spinner = <LoaderCircle size={16} className="animate-spin" />;

  const form = (
    <>
      <p className="mt-4 text-[13.5px] leading-relaxed text-ink-200">
        É só isso. Com a sua chave, a CEO, os líderes e o time passam a pensar com os modelos GPT de verdade, e você acompanha cada centavo
        no cofre.
      </p>
      <Team config={config} />
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim() && !busy) void connect();
        }}
      >
        <label className="text-xs font-medium text-ink-200" htmlFor="openai-key">
          Chave da API da OpenAI
        </label>
        <div className="relative mt-1.5">
          <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            id="openai-key"
            className={cx(inputClass, '!h-11 pl-9 pr-11 font-mono text-[13px]')}
            type={reveal ? 'text' : 'password'}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-proj-…"
            value={key}
            disabled={busy}
            onChange={(e) => {
              setKey(e.target.value);
              setError(null);
              setMissing(null);
            }}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-300 hover:bg-ink-700 hover:text-ink-100"
            onClick={() => setReveal((v) => !v)}
            title={reveal ? 'Esconder' : 'Mostrar'}
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <a
          className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-cyan/90 hover:text-cyan"
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          Criar uma chave em platform.openai.com <ExternalLink size={11} />
        </a>

        {error && <Notice tone="danger">{error}</Notice>}
        {missing && (
          <Notice tone="amber">
            Sua conta não enxerga {missing.join(', ')}. Os cargos que usam {missing.length === 1 ? 'esse modelo' : 'esses modelos'} vão
            falhar até você trocá-los na aba Equipe.
            <div className="mt-2">
              <Button type="button" variant="gold" size="sm" disabled={busy} onClick={() => void connect(true)}>
                Conectar mesmo assim
              </Button>
            </div>
          </Notice>
        )}

        <Button variant="primary" className="mt-4 !h-11 w-full text-[14px]" disabled={busy || !key.trim()}>
          {phase === 'checking' ? (
            <>{spinner} Conferindo com a OpenAI…</>
          ) : phase === 'restarting' ? (
            <>{spinner} Religando o escritório em modo real…</>
          ) : (
            <>
              <Zap size={16} /> Conectar e ligar o modo real
            </>
          )}
        </Button>
      </form>
      <ul className="mt-5 grid gap-2.5">
        <Fact icon={<Lock size={14} />}>
          Fica só nesta máquina, em <code className="font-mono text-ink-200">.env.local</code> (fora do git). Não volta para o navegador nem
          entra no ambiente dos agentes.
        </Fact>
        <Fact icon={<Gauge size={14} />}>
          Cada missão tem teto de gasto rígido. Vale definir também um limite mensal no projeto da OpenAI.
        </Fact>
        <Fact icon={<ShieldCheck size={14} />}>A conferência é gratuita: só lista os modelos que a chave enxerga.</Fact>
      </ul>
      {real && (
        <button type="button" className="mt-4 text-[12px] text-ink-300 hover:text-ink-100" onClick={() => setEditing(false)}>
          ← manter a chave atual
        </button>
      )}
    </>
  );

  const connected = (
    <>
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-money/30 bg-money/[0.07] px-4 py-3">
        <CircleCheck size={18} className="shrink-0 text-money" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] text-ink-100">{setup.keyHint ?? 'chave configurada'}</div>
          <div className="text-[11.5px] text-ink-300">
            {setup.keySource === 'ui' ? 'Salva pela tela inicial em .env.local' : 'Vem do ambiente (LLM_PROVIDER=openai)'}
          </div>
        </div>
      </div>
      <Team config={config} />
      {setup.sandboxNote && <Notice tone="amber">{setup.sandboxNote}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {setup.canConfigure ? (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void disconnect()}>
            {busy ? spinner : <Unplug size={15} />} Voltar para simulação
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => setEditing(true)}>
            <RefreshCw size={15} /> Trocar chave
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-[12px] leading-snug text-ink-300">{setup.lockedReason}</p>
      )}
    </>
  );

  const locked = (
    <>
      <p className="mt-4 text-[13.5px] leading-relaxed text-ink-200">{setup.lockedReason}</p>
      {setup.lockedReason?.includes('LLM_PROVIDER') && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
          Para usar esta tela, tire <code className="font-mono text-ink-200">LLM_PROVIDER</code> do ambiente (ou do{' '}
          <code className="font-mono text-ink-200">.env</code>) e reinicie o <code className="font-mono text-ink-200">pnpm dev</code>.
        </p>
      )}
    </>
  );

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-ink-950/80 p-4" onMouseDown={first ? undefined : close}>
      <div className="panel relative my-auto w-full max-w-[540px] overflow-hidden rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(420px_170px_at_15%_0%,rgba(167,139,250,0.24),transparent_70%),radial-gradient(380px_150px_at_95%_0%,rgba(94,234,212,0.16),transparent_70%)]" />
        {!first && (
          <button
            className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-ink-700 hover:text-ink-100"
            onClick={close}
            title="Fechar (Esc)"
          >
            <X size={17} />
          </button>
        )}
        <div className="relative p-6">
          <div className="flex items-center gap-3.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-cyan/30 bg-cyan/10 text-cyan shadow-[0_0_36px_-6px_rgba(94,234,212,0.55)]">
              <KeyRound size={26} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.2em] text-ink-300">
                {first ? 'configuração inicial · 1 passo' : real ? 'modo real' : 'simulação'}
              </div>
              <h2 className="font-pixel text-[26px] leading-tight text-ink-100">
                {real && !editing ? 'OpenAI conectada' : 'Conecte sua conta OpenAI'}
              </h2>
            </div>
          </div>
          {real && !editing ? connected : setup.canConfigure ? form : locked}
        </div>
        {first && (
          <footer className="relative flex flex-wrap items-center justify-between gap-2 border-t border-ink-600/60 px-6 py-3.5">
            <span className="text-[12px] text-ink-300">Quer só olhar antes?</span>
            <Button variant="subtle" size="sm" disabled={busy} onClick={explore}>
              <FlaskConical size={14} /> Explorar em simulação (sem custo)
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
