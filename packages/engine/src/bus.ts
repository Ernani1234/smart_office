import { EventEmitter } from 'node:events';
import type { OfficeEvent } from '@office/contracts';

// Distribuição de eventos para as abas abertas. Em memória quando tudo roda num
// processo só; Redis pub/sub quando servidor e workers são processos separados.

export interface EventBus {
  readonly kind: 'memory' | 'redis';
  publish(events: OfficeEvent[]): Promise<void>;
  subscribe(fn: (events: OfficeEvent[]) => void): () => void;
  close(): Promise<void>;
}

export class MemoryBus implements EventBus {
  readonly kind = 'memory' as const;
  private readonly emitter = new EventEmitter().setMaxListeners(1000);

  async publish(events: OfficeEvent[]): Promise<void> {
    if (events.length) this.emitter.emit('events', events);
  }

  subscribe(fn: (events: OfficeEvent[]) => void): () => void {
    this.emitter.on('events', fn);
    return () => this.emitter.off('events', fn);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

const CHANNEL = 'pixel-office:events';

export async function createRedisBus(url: string): Promise<EventBus> {
  const { Redis } = await import('ioredis');
  const pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  const sub = new Redis(url, { lazyConnect: false });
  const local = new MemoryBus();
  await sub.subscribe(CHANNEL);
  sub.on('message', (_channel: string, message: string) => {
    try {
      void local.publish(JSON.parse(message) as OfficeEvent[]);
    } catch {
      // mensagem malformada: ignora
    }
  });
  return {
    kind: 'redis',
    async publish(events) {
      if (events.length) await pub.publish(CHANNEL, JSON.stringify(events));
    },
    subscribe: (fn) => local.subscribe(fn),
    async close() {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
