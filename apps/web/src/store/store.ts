import { create } from 'zustand';
import { produce } from 'immer';
import { applyEvent, createState, formatUsd, type CompanyState, type OfficeEvent, type ServerConfig } from '@office/contracts';
import { api } from '../lib/api';
import { sound } from '../lib/sound';
import { fx } from './fx';

// Estado do front: a mesma projeção pura do servidor (applyEvent) aplicada a
// todos os eventos (ao vivo) ou até o cursor da linha do tempo (replay).

export type PanelId = 'board' | 'finance' | 'approvals' | 'team' | 'wiki' | 'missions' | 'repo';
export type DayMode = 'auto' | 'day' | 'night';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error' | 'board' | 'money';
  title: string;
  body?: string;
  ts: number;
  panel?: PanelId;
  agentId?: string;
}

export interface ReplayState {
  active: boolean;
  playing: boolean;
  speed: number;
  cursor: number;
  start: number;
  end: number;
  index: number;
  skipSilence: boolean;
}

interface OfficeStore {
  conn: 'connecting' | 'open' | 'closed';
  serverOffset: number;
  backlogDone: boolean;
  config: ServerConfig | null;
  configError: string | null;
  /** Mutável por desempenho; `eventsVersion` sinaliza mudanças. */
  events: OfficeEvent[];
  eventTimes: number[];
  eventsVersion: number;
  live: CompanyState;
  replay: ReplayState;
  replayState: CompanyState | null;
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  panel: PanelId | null;
  following: boolean;
  dayMode: DayMode;
  muted: boolean;
  toasts: Toast[];
  newMissionOpen: boolean;
  /** Tela da chave da OpenAI aberta pelo selo de modo. */
  setupOpen: boolean;
  /** O Conselho preferiu explorar em simulação: não insistir na tela inicial. */
  setupSkipped: boolean;

  ingest(events: OfficeEvent[], backlog: boolean): void;
  loadConfig(): Promise<void>;
  setConn(c: OfficeStore['conn']): void;
  hello(serverTime: string): void;
  finishBacklog(): void;
  selectAgent(id: string | null): void;
  selectTask(id: string | null): void;
  openPanel(p: PanelId | null): void;
  setFollowing(v: boolean): void;
  setDayMode(m: DayMode): void;
  toggleMute(): void;
  toast(t: Omit<Toast, 'id' | 'ts'>): void;
  dismissToast(id: number): void;
  setNewMissionOpen(v: boolean): void;
  setSetupOpen(v: boolean): void;
  setSetupSkipped(v: boolean): void;

  startReplay(from?: number): void;
  stopReplay(): void;
  seek(ts: number): void;
  setSpeed(s: number): void;
  togglePlay(): void;
  setSkipSilence(v: boolean): void;
  tick(dtMs: number): void;
}

let toastSeq = 0;
let configRetry: ReturnType<typeof setTimeout> | null = null;

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`pixel-office.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pixel-office.${key}`, JSON.stringify(value));
  } catch {
    // sem armazenamento: preferências só nesta aba
  }
}

/** Notificações e sons para eventos ao vivo que pedem atenção do Conselho. */
function notify(get: () => OfficeStore, e: OfficeEvent): void {
  const s = get();
  const name = (id: string | null) => (id ? (s.live.agents[id]?.name ?? id) : 'alguém');
  switch (e.type) {
    case 'approval.requested':
      s.toast({ kind: 'board', title: 'Pedido ao Conselho', body: e.data.title, panel: 'approvals' });
      sound.play('bell');
      break;
    case 'mission.launched':
      s.toast({ kind: 'success', title: `${e.data.product} no ar!`, body: 'Agora o Financeiro acompanha as vendas.' });
      sound.play('success');
      break;
    case 'mission.completed':
      s.toast({
        kind: e.data.reason === 'goal_reached' ? 'success' : 'error',
        title: e.data.reason === 'goal_reached' ? 'META BATIDA!' : 'Missão encerrada',
        body: `Lucro líquido ${formatUsd(e.data.netProfitUsd)} · gasto ${formatUsd(e.data.spentUsd)}`,
        panel: 'finance',
      });
      sound.play(e.data.reason === 'goal_reached' ? 'fanfare' : 'fail');
      break;
    case 'budget.warning':
      s.toast({
        kind: 'warning',
        title: 'Orçamento quase no teto',
        body: `${Math.round(e.data.pct * 100)}% do teto usado`,
        panel: 'finance',
      });
      sound.play('alert');
      break;
    case 'company.paused':
      s.toast({ kind: 'error', title: 'PÂNICO: empresa pausada', body: e.data.reason });
      sound.play('alarm');
      break;
    case 'company.resumed':
      s.toast({ kind: 'info', title: 'Empresa retomada' });
      break;
    case 'revenue.recorded':
      sound.play('coin');
      break;
    case 'finance.goal_reached':
      s.toast({ kind: 'money', title: 'Financeiro declara a meta batida', body: formatUsd(e.data.netProfitUsd) });
      break;
    case 'task.escalated':
      if (e.data.to === 'board') s.toast({ kind: 'board', title: 'Tarefa escalada ao Conselho', body: e.data.reason, panel: 'approvals' });
      break;
    case 'agent.said':
      if (e.data.to === 'conselho' && e.agentId) {
        s.toast({ kind: 'info', title: name(e.agentId), body: e.data.text, agentId: e.agentId });
      }
      break;
  }
}

export const useOffice = create<OfficeStore>((set, get) => ({
  conn: 'connecting',
  serverOffset: 0,
  backlogDone: false,
  config: null,
  configError: null,
  events: [],
  eventTimes: [],
  eventsVersion: 0,
  live: createState(),
  replay: { active: false, playing: false, speed: 10, cursor: 0, start: 0, end: 0, index: 0, skipSilence: true },
  replayState: null,
  selectedAgentId: null,
  selectedTaskId: null,
  panel: null,
  following: false,
  dayMode: readPref<DayMode>('dayMode', 'auto'),
  muted: readPref('muted', true),
  toasts: [],
  newMissionOpen: false,
  setupOpen: false,
  setupSkipped: readPref('setupSkipped', false),

  ingest(incoming, backlog) {
    const s = get();
    const lastId = s.events.length ? s.events[s.events.length - 1].id : 0;
    const fresh = incoming.filter((e) => e.id > lastId).sort((a, b) => a.id - b.id);
    if (!fresh.length) return;
    for (const e of fresh) {
      s.events.push(e);
      s.eventTimes.push(Date.parse(e.ts));
    }
    const live = produce(s.live, (draft) => {
      for (const e of fresh) applyEvent(draft, e);
    });
    const replay = s.replay.active ? { ...s.replay, end: Math.max(s.replay.end, s.eventTimes[s.eventTimes.length - 1]) } : s.replay;
    set({ live, eventsVersion: s.eventsVersion + 1, replay });
    if (!backlog && !s.replay.active) {
      for (const e of fresh) fx.emit({ type: 'event', event: e, speed: 1 });
    }
    if (!backlog) for (const e of fresh) notify(get, e);
    // A empresa religa (ex.: troca de modo) e o boot chega como backlog na reconexão.
    const reload = (e: OfficeEvent) => e.type === 'roles.updated' || e.type === 'company.booted' || (!backlog && e.type === 'agent.hired');
    if (fresh.some(reload)) void get().loadConfig();
  },

  async loadConfig() {
    try {
      const config = await api<ServerConfig>('/api/config');
      set({ config, configError: null });
    } catch (err) {
      set({ configError: (err as Error).message });
      // A API pode estar religando: tenta de novo logo, não só no próximo ciclo.
      configRetry ??= setTimeout(() => {
        configRetry = null;
        void get().loadConfig();
      }, 2000);
    }
  },

  setConn(conn) {
    set({ conn });
  },

  hello(serverTime) {
    set({ serverOffset: Date.parse(serverTime) - Date.now() });
  },

  finishBacklog() {
    set({ backlogDone: true });
    fx.emit({ type: 'snap' });
  },

  selectAgent(id) {
    set({ selectedAgentId: id, following: id ? get().following : false });
    if (id) fx.emit({ type: 'focus', agentId: id });
  },

  selectTask(id) {
    set({ selectedTaskId: id });
  },

  openPanel(panel) {
    set({ panel });
  },

  setFollowing(following) {
    set({ following });
  },

  setDayMode(dayMode) {
    writePref('dayMode', dayMode);
    set({ dayMode });
  },

  toggleMute() {
    const muted = !get().muted;
    writePref('muted', muted);
    sound.setMuted(muted);
    set({ muted });
    if (!muted) sound.play('coin');
  },

  toast(t) {
    const toast: Toast = { ...t, id: ++toastSeq, ts: Date.now() };
    set({ toasts: [...get().toasts.slice(-4), toast] });
    setTimeout(() => get().dismissToast(toast.id), t.kind === 'board' ? 12_000 : 7000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setNewMissionOpen(newMissionOpen) {
    set({ newMissionOpen });
  },

  setSetupOpen(setupOpen) {
    set({ setupOpen });
  },

  setSetupSkipped(setupSkipped) {
    writePref('setupSkipped', setupSkipped);
    set({ setupSkipped });
  },

  // ------------------------------------------------------------ replay
  startReplay(from) {
    const s = get();
    if (!s.events.length) return;
    const missionId = s.live.activeMissionId;
    const created = missionId ? s.events.find((e) => e.type === 'mission.created' && e.missionId === missionId) : null;
    const start = created ? Date.parse(created.ts) - 2000 : s.eventTimes[0];
    const end = s.eventTimes[s.eventTimes.length - 1];
    set({ replay: { ...s.replay, active: true, playing: true, start, end, cursor: start, index: 0 } });
    get().seek(from ?? start);
  },

  stopReplay() {
    set({ replay: { ...get().replay, active: false, playing: false }, replayState: null });
    fx.emit({ type: 'snap' });
  },

  seek(ts) {
    const s = get();
    const cursor = Math.max(s.replay.start, Math.min(ts, s.replay.end));
    const state = createState();
    let i = 0;
    for (; i < s.events.length && s.eventTimes[i] <= cursor; i++) applyEvent(state, s.events[i]);
    set({ replayState: produce(state, () => undefined), replay: { ...s.replay, cursor, index: i } });
    fx.emit({ type: 'snap' });
  },

  setSpeed(speed) {
    set({ replay: { ...get().replay, speed } });
  },

  togglePlay() {
    const r = get().replay;
    if (r.cursor >= r.end) {
      get().seek(r.start);
      set({ replay: { ...get().replay, playing: true } });
      return;
    }
    set({ replay: { ...r, playing: !r.playing } });
  },

  setSkipSilence(skipSilence) {
    set({ replay: { ...get().replay, skipSilence } });
  },

  tick(dtMs) {
    const s = get();
    const r = s.replay;
    if (!r.active || !r.playing || !s.replayState) return;
    let cursor = r.cursor + dtMs * r.speed;
    // Pular silêncio: madrugadas sem eventos passam num piscar.
    if (r.skipSilence && r.index < s.events.length) {
      const next = s.eventTimes[r.index];
      if (next - cursor > 4000 * Math.max(1, r.speed / 4)) cursor = next - 1500;
    }
    cursor = Math.min(cursor, r.end);
    const batch: OfficeEvent[] = [];
    let i = r.index;
    while (i < s.events.length && s.eventTimes[i] <= cursor) batch.push(s.events[i++]);
    const replayState = batch.length
      ? produce(s.replayState, (draft) => {
          for (const e of batch) applyEvent(draft, e);
        })
      : s.replayState;
    set({ replayState, replay: { ...r, cursor, index: i, playing: cursor < r.end } });
    for (const e of batch) fx.emit({ type: 'event', event: e, speed: r.speed });
  },
}));

sound.setMuted(useOffice.getState().muted);

/** Estado que o escritório mostra agora (ao vivo ou no cursor do replay). */
export function useView(): CompanyState {
  return useOffice((s) => (s.replay.active && s.replayState ? s.replayState : s.live));
}

export function viewOf(s: OfficeStore): CompanyState {
  return s.replay.active && s.replayState ? s.replayState : s.live;
}

/** "Agora" no relógio do escritório (cursor do replay ou relógio do servidor). */
export function officeNow(): number {
  const s = useOffice.getState();
  return s.replay.active ? s.replay.cursor : Date.now() + s.serverOffset;
}
