import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { OfficeCanvas } from './office/OfficeCanvas';
import { ApiError, api, setToken } from './lib/api';
import { connect } from './store/connection';
import { useOffice } from './store/store';
import { BootScreen, useApiReady } from './ui/Boot';
import { Inspector } from './ui/Inspector';
import { Button, inputClass } from './ui/kit';
import { NewMissionDialog } from './ui/NewMission';
import { Rail } from './ui/Rail';
import { Roster } from './ui/Roster';
import { SetupGate } from './ui/Setup';
import { PanelHost, Toasts, useShortcuts, Welcome } from './ui/Shell';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';

function TokenGate({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="grid h-full place-items-center p-4">
      <form
        className="panel w-full max-w-sm rounded-2xl p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setToken(value.trim());
          onDone();
        }}
      >
        <div className="mb-3 flex items-center gap-2 text-cyan">
          <KeyRound size={18} /> <span className="font-pixel text-lg text-ink-100">Acesso do Conselho</span>
        </div>
        <p className="mb-3 text-sm text-ink-300">Este escritório exige o OFFICE_TOKEN configurado no servidor.</p>
        <input
          className={inputClass}
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="token"
        />
        <Button variant="primary" className="mt-3 w-full">
          Entrar
        </Button>
      </form>
    </div>
  );
}

export function App() {
  const { ready, waitedMs } = useApiReady();
  const [auth, setAuth] = useState<'checking' | 'ok' | 'needed'>('checking');
  const selected = useOffice((s) => s.selectedAgentId);
  const newMission = useOffice((s) => s.newMissionOpen);
  const configError = useOffice((s) => s.configError);
  useShortcuts();

  useEffect(() => {
    if (!ready || auth !== 'checking') return;
    api('/api/config')
      .then(() => setAuth('ok'))
      .catch((err) => setAuth(err instanceof ApiError && err.status === 401 ? 'needed' : 'ok'));
  }, [ready, auth]);

  useEffect(() => {
    if (auth !== 'ok') return;
    void useOffice.getState().loadConfig();
    const stop = connect();
    const t = setInterval(() => void useOffice.getState().loadConfig(), 30_000);
    return () => {
      stop();
      clearInterval(t);
    };
  }, [auth]);

  if (!ready) return <BootScreen waitedMs={waitedMs} />;
  if (auth === 'needed') return <TokenGate onDone={() => setAuth('checking')} />;

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <Roster />
        <main className="relative min-w-0 flex-1">
          <OfficeCanvas />
          <PanelHost />
          <Welcome />
          <Toasts />
          {configError && (
            <div
              className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-amber/50 bg-ink-900/95 px-4 py-2 text-sm text-amber"
              title={configError}
            >
              <LoaderCircle size={14} className="animate-spin" /> Reconectando à API…
            </div>
          )}
        </main>
        {selected && <Inspector />}
      </div>
      <Timeline />
      {newMission && <NewMissionDialog />}
      <SetupGate />
    </div>
  );
}
