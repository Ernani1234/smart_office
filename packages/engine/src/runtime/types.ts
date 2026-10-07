import type { AgentSpec, BillingMode, ChangeRequest, DeliveryReportOut, Effort, NewEvent, Role, WorkOrder } from '@office/contracts';
import type { CallContext } from '../llm/gateway';
import type { CiCheckResult } from '../repo/ci';

// Cada dev ou testador é uma sessão. A hierarquia é nossa (Temporal); o trabalho
// braçal fica atrás desta interface para poder trocar de motor: loop de
// ferramentas na Responses API, Agents API com sandbox hospedada, ou simulação.

export type Feedback =
  | { kind: 'ci'; summary: string; checks: CiCheckResult[] }
  | { kind: 'review'; summary: string; changes: ChangeRequest[] }
  | { kind: 'respec'; summary: string }
  | { kind: 'merge_conflict'; summary: string };

export interface WorkerJob {
  missionId: string;
  taskId: string;
  attempt: number;
  agent: AgentSpec;
  roleId: string;
  role: Role;
  model: string;
  effort: Effort;
  billing: BillingMode;
  workOrder: WorkOrder;
  feedback: Feedback[];
  /** null para quem não escreve (pesquisa lê a web e devolve relatório). */
  workspace: { dir: string; branch: string } | null;
  /** Trechos relevantes da wiki (reaproveitar pesquisa já paga). */
  wikiContext: string;
  /** Pistas para o roteiro simulado. */
  sim: Record<string, unknown>;
}

export interface WorkerHooks {
  ctx: CallContext;
  emit(e: NewEvent): Promise<void>;
  takeMessages(): Promise<string[]>;
  heartbeat(): void;
}

export interface WorkerOutcome {
  report: DeliveryReportOut;
  /** Arquivos produzidos fora do worktree (ex.: sandbox hospedada devolve conteúdo). */
  files?: { path: string; content: string }[];
}

export interface WorkerRuntime {
  readonly id: string;
  run(job: WorkerJob, hooks: WorkerHooks): Promise<WorkerOutcome>;
}

export function renderJob(job: WorkerJob): string {
  const wo = job.workOrder;
  const parts = [
    `# Ordem de serviço ${wo.id} (tentativa ${job.attempt})`,
    `**Título:** ${wo.title}`,
    `**Objetivo:** ${wo.objective}`,
    `**Contexto:** ${wo.context}`,
    `**Critérios de aceite:**\n${wo.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
    `**Orçamento:** US$ ${wo.budgetUsd.toFixed(2)}`,
  ];
  if (wo.inputs.length) parts.push(`**Artefatos de entrada:** ${wo.inputs.join(', ')}`);
  if (wo.constraints.length) parts.push(`**Restrições:**\n${wo.constraints.map((c) => `- ${c}`).join('\n')}`);
  if (job.wikiContext) parts.push(`**Da wiki da empresa:**\n${job.wikiContext}`);
  for (const f of job.feedback) {
    if (f.kind === 'ci') {
      parts.push(
        `**O CI falhou na tentativa anterior:** ${f.summary}\n${f.checks
          .filter((c) => !c.ok)
          .map((c) => `- ${c.name}:\n\`\`\`\n${c.tail}\n\`\`\``)
          .join('\n')}`,
      );
    } else if (f.kind === 'review') {
      parts.push(
        `**Parecer de revisão (mudanças pedidas):** ${f.summary}\n${f.changes.map((c) => `- [${c.severity}] ${c.item}`).join('\n')}`,
      );
    } else if (f.kind === 'respec') {
      parts.push(`**Especificação reescrita pelo líder:** ${f.summary}`);
    } else {
      parts.push(`**Conflito de merge com a main:** ${f.summary}`);
    }
  }
  return parts.join('\n\n');
}
