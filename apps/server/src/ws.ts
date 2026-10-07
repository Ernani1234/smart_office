import type { FastifyInstance } from 'fastify';
import type { OfficeEvent, WsServerMessage } from '@office/contracts';
import type { Services } from '@office/engine';

// Stream de eventos para o escritório. O cliente conecta com ?after=<último id>,
// recebe o backlog em lotes e depois tudo ao vivo, sem buracos nem duplicatas:
// assina o barramento ANTES de ler o backlog e descarta o que já foi enviado.

export function registerWs(app: FastifyInstance, s: Services): void {
  app.get<{ Querystring: { after?: string } }>('/ws', { websocket: true }, (socket, req) => {
    let lastSent = Number(req.query.after ?? 0) || 0;
    let ready = false;
    const buffer: OfficeEvent[] = [];
    const send = (msg: WsServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const forward = (events: OfficeEvent[]) => {
      const fresh = events.filter((e) => e.id > lastSent);
      if (!fresh.length) return;
      lastSent = fresh[fresh.length - 1].id;
      send({ type: 'events', events: fresh, backlog: false });
    };
    const unsubscribe = s.bus.subscribe((events) => {
      if (ready) forward(events);
      else buffer.push(...events);
    });
    const ping = setInterval(() => send({ type: 'ping', t: Date.now() }), 20_000);
    socket.on('close', () => {
      unsubscribe();
      clearInterval(ping);
    });

    void (async () => {
      send({
        type: 'hello',
        serverTime: new Date().toISOString(),
        mode: s.env.mode,
        paused: await s.settings.isPaused(),
        lastEventId: await s.events.lastId(),
      });
      for (;;) {
        const batch = await s.events.list({ after: lastSent, limit: 1000 });
        if (!batch.length) break;
        lastSent = batch[batch.length - 1].id;
        send({ type: 'events', events: batch, backlog: true });
        if (batch.length < 1000) break;
      }
      send({ type: 'backlog_done', lastEventId: lastSent });
      ready = true;
      forward(buffer.sort((a, b) => a.id - b.id));
      buffer.length = 0;
    })().catch((err) => {
      s.log.warn(`ws backlog falhou: ${String(err)}`);
      socket.close();
    });
  });
}
