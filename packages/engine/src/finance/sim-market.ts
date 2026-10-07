import { newEvent } from '@office/contracts';
import type { Db } from '../db/db';
import type { EventStore } from '../db/event-store';
import type { MissionRepo, SimOrderRepo } from '../db/repos';
import { SIM_PRODUCT } from '../llm/sim/script';
import { createLogger, rng, hash } from '../util';

// Mercado simulado: depois que o Conselho aprova o lançamento, clientes
// fictícios compram o produto num ritmo que depende do que a empresa entregou
// (conteúdo de SEO acelera). Os pedidos vão para `sim_orders`, que o Financeiro
// lê por código — exatamente como leria a API do merchant-of-record.

const log = createLogger('mercado');

export class SimMarket {
  private timer: NodeJS.Timeout | null = null;
  private readonly random = rng(hash('mercado') ^ Date.now());

  constructor(private readonly d: { db: Db; missions: MissionRepo; orders: SimOrderRepo; events: EventStore; speed: number }) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => log.warn(String(err))), 1500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const missions = await this.d.missions.running();
    for (const m of missions) {
      if (m.revenueSource !== 'sim' || !m.launchedAt) continue;
      const rows = await this.d.db.query<{ c: number }>(
        `select count(distinct data->>'path')::int as c from events
         where mission_id = $1 and type = 'file.changed' and data->>'path' like 'content/%'`,
        [m.id],
      );
      const content = Number(rows[0]?.c ?? 0);
      const sold = await this.d.orders.count(m.id);
      // Probabilidade de venda por tick (1,5 s): base + tração por conteúdo, com
      // uma calmaria depois das primeiras vendas (vira gatilho de estagnação).
      const lull = sold >= 3 && sold < 5 && content === 0;
      const p = Math.min(0.9, (lull ? 0.015 : 0.16) * this.d.speed * (1 + content * 0.6));
      if (this.random() < p) {
        const grossCents = Math.round(SIM_PRODUCT.priceUsd * 100);
        const feeCents = Math.round(grossCents * 0.05 + 50);
        const id = `ord_${m.id.slice(-6)}_${(sold + 1).toString().padStart(3, '0')}`;
        await this.d.orders.insert({ id, missionId: m.id, grossCents, feeCents });
        if (this.random() < 0.5) {
          const visits = 40 + sold * 23 + Math.round(this.random() * 30);
          await this.d.events.append(
            newEvent(
              'analytics.snapshot',
              { visits, signups: Math.round(visits * 0.12), checkouts: sold + 1, source: 'sim' },
              { missionId: m.id },
            ),
          );
        }
      }
    }
  }
}
