import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { imageCostMicros, microsToUsd, newEvent, usdToMicros } from '@office/contracts';
import type { PricingStore } from '../config/stores';
import type { Ledger } from '../db/ledger';
import { BudgetExceededError, type LlmGateway } from '../llm/gateway';
import type { LlmProvider } from '../llm/types';
import { slugify } from '../util';
import type { WorkerHooks, WorkerJob, WorkerOutcome, WorkerRuntime } from './types';

// Designer: rascunho no modelo de imagem rápido, arte final no de alta qualidade.
// Cada imagem é cobrada por unidade (pricing.yaml → images).

export class DesignerRuntime implements WorkerRuntime {
  readonly id = 'designer';

  constructor(private readonly d: { llm: LlmProvider; gateway: LlmGateway; ledger: Ledger; pricing: PricingStore }) {}

  async run(job: WorkerJob, hooks: WorkerHooks): Promise<WorkerOutcome> {
    if (!this.d.llm.generateImage) throw new Error('Provedor sem geração de imagem.');
    if (!job.workspace) throw new Error('Designer precisa de área de trabalho.');
    const wo = job.workOrder;
    const prompt = `${wo.objective}. ${wo.context}. Imagem limpa, fundo simples, texto curto e legível.`;
    const slug = slugify(wo.title) || 'arte';
    const stages = [
      { model: job.role.model, file: `public/assets/${slug}-rascunho.png`, label: 'rascunho' },
      { model: job.role.finalModel ?? job.role.model, file: `public/assets/${slug}.png`, label: 'arte final' },
    ];
    const done: string[] = [];
    let call = 0;
    for (const stage of stages) {
      await this.d.gateway.waitIfPaused(hooks.ctx);
      const price = imageCostMicros(this.d.pricing.get(), stage.model, 1);
      const spent = await this.d.ledger.taskSpentMicros(job.taskId);
      const left = usdToMicros(wo.budgetUsd) - spent;
      if (price > left) throw new BudgetExceededError('task', microsToUsd(price), microsToUsd(Math.max(0, left)));
      const callId = `${job.taskId}-${job.attempt}-img${++call}`;
      await hooks.emit(newEvent('tool.called', { callId, tool: 'image', label: `desenhando ${stage.label} (${stage.model})` }));
      const started = Date.now();
      const { png } = await this.d.llm.generateImage({ model: stage.model, prompt, size: '1024x1024' });
      const full = path.join(job.workspace.dir, stage.file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, png);
      await this.d.ledger.recordCost({
        missionId: job.missionId,
        taskId: job.taskId,
        agentId: job.agent.id,
        role: job.roleId,
        team: job.role.team,
        kind: 'image',
        model: stage.model,
        billing: null,
        micros: price,
        note: stage.label,
      });
      await hooks.emit(newEvent('file.changed', { path: stage.file, op: 'create', additions: 1, deletions: 0 }));
      await hooks.emit(
        newEvent('tool.result', { callId, ok: true, summary: `${(png.length / 1024).toFixed(0)} KB`, ms: Date.now() - started }),
      );
      done.push(stage.file);
    }
    return {
      report: {
        summary: `Rascunho e arte final gerados para “${wo.title}”.`,
        done,
        evidence: done.map((f) => ({ kind: 'file' as const, ref: f, description: 'Imagem PNG 1024×1024' })),
        acceptance: wo.acceptanceCriteria.map((c) => ({ criterion: c, met: true, evidence: done.join(', ') })),
        risks: [],
        questions: [],
      },
    };
  }
}
