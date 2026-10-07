import type { WsServerMessage } from '@office/contracts';
import { health, wsUrl } from '../lib/api';
import { useOffice } from './store';

// WebSocket com reconexão exponencial. Reconecta pedindo só o que perdeu
// (?after=<último id>): o servidor manda o backlog e emenda o ao vivo. Antes de
// abrir, confere se a API respondeu (ela religa ao trocar de modo).

export function connect(): () => void {
  let ws: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    timer = setTimeout(() => void open(), Math.min(5_000, 400 * 2 ** retry++));
  };

  const open = async () => {
    useOffice.getState().setConn('connecting');
    if (!(await health())) {
      if (!closed) later();
      return;
    }
    if (closed) return;
    const store = useOffice.getState();
    const after = store.events.length ? store.events[store.events.length - 1].id : 0;
    ws = new WebSocket(wsUrl(after));
    ws.onopen = () => {
      retry = 0;
      useOffice.getState().setConn('open');
    };
    ws.onmessage = (m) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(String(m.data)) as WsServerMessage;
      } catch {
        return;
      }
      const s = useOffice.getState();
      switch (msg.type) {
        case 'hello':
          s.hello(msg.serverTime);
          break;
        case 'events':
          s.ingest(msg.events, msg.backlog);
          break;
        case 'backlog_done':
          s.finishBacklog();
          break;
      }
    };
    ws.onclose = () => {
      useOffice.getState().setConn('closed');
      if (closed) return;
      later();
    };
    ws.onerror = () => ws?.close();
  };

  void open();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
