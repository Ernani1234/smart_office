import { DeliveryReportOutSchema, newEvent, usdToMicros } from '@office/contracts';
import type { Env } from '../env';
import type { Ledger } from '../db/ledger';
import type { PricingStore } from '../config/stores';
import type { LlmGateway } from '../llm/gateway';
import type { LlmInputItem } from '../llm/types';
import type { Sandbox } from '../sandbox/exec';
import { executeTool, toolsFor } from './tools';
import { renderJob, type WorkerHooks, type WorkerJob, type WorkerOutcome, type WorkerRuntime } from './types';

// Trabalhador real com a Responses API: loop de ferramentas com estado no
// servidor (previous_response_id), sandbox local/Docker para as mãos e
// `submit_delivery` como única saída. Mensagens do Conselho entram entre turnos
// (mid-turn steering do jeito simples).

export class ToolLoopRuntime implements WorkerRuntime {
  readonly id = 'toolloop';

  constructor(private readonly d: { gateway: LlmGateway; sandbox: Sandbox; env: Env; ledger: Ledger; pricing: PricingStore }) {}

  async run(job: WorkerJob, hooks: WorkerHooks): Promise<WorkerOutcome> {
    const tools = toolsFor(job.role.tools, this.d.env);
    let input: LlmInputItem[] = [{ role: 'user', content: renderJob(job) }];
    let previousResponseId: string | null = null;
    let calls = 0;
    let nudges = 0;

    const recordSearchCost = async (tool: 'tavily' | 'firecrawl') => {
      const p = this.d.pricing.get().tools;
      const usd = tool === 'tavily' ? p.tavilyPerCall : p.firecrawlPerPage;
      await this.d.ledger.recordCost({
        missionId: job.missionId,
        taskId: job.taskId,
        agentId: job.agent.id,
        role: job.roleId,
        team: job.role.team,
        kind: 'search',
        model: null,
        billing: null,
        micros: usdToMicros(usd),
        note: tool,
      });
    };

    for (let turn = 0; turn < this.d.env.maxWorkerTurns; turn++) {
      const messages = await hooks.takeMessages();
      if (messages.length) {
        input = [...input, { role: 'user', content: messages.map((m) => `[Mensagem do Conselho — prioridade] ${m}`).join('\n') }];
      }
      const r = await this.d.gateway.turn(hooks.ctx, {
        roleId: job.roleId,
        model: job.model,
        effort: job.effort,
        billing: job.billing,
        input,
        tools,
        previousResponseId,
        maxOutputTokens: 16_000,
        sim: { purpose: 'worker.turn' },
        name: `worker.${job.workOrder.kind}`,
      });
      previousResponseId = r.responseId;

      if (r.toolCalls.length === 0) {
        if (++nudges > 3) throw new Error('O agente parou de usar ferramentas sem chamar submit_delivery.');
        input = [{ role: 'user', content: 'Continue a tarefa com as ferramentas. Quando terminar, chame submit_delivery.' }];
        continue;
      }

      const outputs: LlmInputItem[] = [];
      for (const call of r.toolCalls) {
        if (call.name === 'submit_delivery') {
          const parsed = DeliveryReportOutSchema.safeParse(JSON.parse(call.arguments || '{}'));
          if (parsed.success) return { report: parsed.data };
          outputs.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: `Relatório inválido: ${parsed.error.message.slice(0, 500)}`,
          });
          continue;
        }
        const res = await executeTool(call, job, hooks, { sandbox: this.d.sandbox, env: this.d.env, recordSearchCost }, ++calls);
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: res.output });
      }
      input = outputs;
    }
    await hooks.emit(newEvent('agent.status', { activity: 'blocked', note: 'Limite de turnos atingido' }));
    throw new Error(`Limite de ${this.d.env.maxWorkerTurns} turnos sem submit_delivery.`);
  }
}
