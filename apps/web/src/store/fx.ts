import type { OfficeEvent } from '@office/contracts';

// Barramento de efeitos: a projeção diz ONDE cada um está; os efeitos dizem o
// que ANIMAR (moedas, confete, visitas, faíscas). No replay, os mesmos eventos
// passam por aqui na velocidade escolhida; num salto da linha do tempo, "snap".

export type FxMessage = { type: 'event'; event: OfficeEvent; speed: number } | { type: 'snap' } | { type: 'focus'; agentId: string };

type Handler = (m: FxMessage) => void;

const handlers = new Set<Handler>();

export const fx = {
  on(h: Handler): () => void {
    handlers.add(h);
    return () => handlers.delete(h);
  },
  emit(m: FxMessage): void {
    for (const h of handlers) {
      try {
        h(m);
      } catch (err) {
        console.error('fx', err);
      }
    }
  },
};
