// Workflows da empresa. Código determinístico: só orquestra. Tudo que toca o
// mundo (modelos, banco, Git, dinheiro) está nas atividades. Missões de semanas
// sobrevivem a crash e deploy porque o Temporal reexecuta o histórico.

import {
  ApplicationFailure,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  isCancellation,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import { afterReview, onCiFailure, planWaves } from '@office/contracts/logic';
import type { ApprovalAsk, DeliveryReport, EndReason, TeamReport } from '@office/contracts';
import type { Activities } from '../activities';
import type { Feedback } from '../../runtime/types';
import {
  FAILURES,
  QUERIES,
  SIGNALS,
  type ApprovalDecisionMsg,
  type FinanceStatus,
  type PlannedAssignment,
  type TaskInput,
  type TaskResult,
  type TeamInput,
  type WorkflowStatus,
} from '../shared';

// ------------------------------------------------------------------ sinais

export const pauseSignal = defineSignal(SIGNALS.pause);
export const resumeSignal = defineSignal(SIGNALS.resume);
export const approvalSignal = defineSignal<[ApprovalDecisionMsg]>(SIGNALS.approval);
export const statusQuery = defineQuery<WorkflowStatus>(QUERIES.status);

// ------------------------------------------------------------------ atividades

const NON_RETRYABLE = [FAILURES.missionBudget, FAILURES.taskBudget, FAILURES.unknownModel, FAILURES.invalidConfig];

const quick = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 6, initialInterval: '1s', backoffCoefficient: 2, nonRetryableErrorTypes: NON_RETRYABLE },
});

const thinking = proxyActivities<Activities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 4,
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    nonRetryableErrorTypes: NON_RETRYABLE,
  },
});

const labor = proxyActivities<Activities>({
  startToCloseTimeout: '90 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    nonRetryableErrorTypes: NON_RETRYABLE,
  },
});

// ------------------------------------------------------------------ utilidades

function hasFailureType(err: unknown, type: string): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 12 && cur; i++) {
    if (cur instanceof ApplicationFailure && cur.type === type) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function messageOf(err: unknown): string {
  let cur: unknown = err;
  let last = 'erro desconhecido';
  for (let i = 0; i < 12 && cur; i++) {
    const m = (cur as { message?: string }).message;
    if (m) last = m;
    cur = (cur as { cause?: unknown }).cause;
  }
  return last.slice(0, 300);
}

/** Pausa (botão de pânico) propagada para os filhos em execução. */
function pausable() {
  const state = { paused: false };
  const children = new Set<string>();
  const forward = (signal: typeof pauseSignal | typeof resumeSignal) => {
    for (const id of children) {
      void getExternalWorkflowHandle(id)
        .signal(signal)
        .catch(() => undefined);
    }
  };
  setHandler(pauseSignal, () => {
    state.paused = true;
    forward(pauseSignal);
  });
  setHandler(resumeSignal, () => {
    state.paused = false;
    forward(resumeSignal);
  });
  const gate = () => condition(() => !state.paused);
  async function runChild<A extends unknown[], R>(wf: (...args: A) => Promise<R>, workflowId: string, args: A): Promise<R> {
    await gate();
    children.add(workflowId);
    try {
      const handle = await startChild(wf, { workflowId, args });
      if (state.paused) await handle.signal(pauseSignal);
      return await handle.result();
    } finally {
      children.delete(workflowId);
    }
  }
  return { state, children, gate, runChild };
}

function dedupe(asks: ApprovalAsk[]): ApprovalAsk[] {
  const seen = new Set<string>();
  return asks.filter((a) => {
    const k = `${a.kind}:${a.title.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------------------------------------------------------ Missão

export async function missionWorkflow(input: { missionId: string }): Promise<{ reason: EndReason }> {
  const { missionId } = input;
  const ctl = pausable();
  const decisions = new Map<string, ApprovalDecisionMsg>();
  let phase = 'iniciando';
  let cycle = 0;
  setHandler(approvalSignal, (d) => {
    decisions.set(d.approvalId, d);
  });
  setHandler(statusQuery, () => ({ phase, paused: ctl.state.paused, cycle, children: [...ctl.children] }));

  // Cancelada (ou quebrada) antes de começar: fecha a missão do mesmo jeito,
  // senão ela fica "em andamento" para sempre e trava as próximas.
  const boot = await (async () => {
    try {
      const info = await quick.missionLoad(missionId);
      const { roster } = await quick.missionStart({ missionId, workflowId: workflowInfo().workflowId });
      return { info, roster };
    } catch (err) {
      const reason: EndReason = isCancellation(err) ? 'cancelled' : 'failed';
      await CancellationScope.nonCancellable(() =>
        thinking.missionClose({ missionId, reason, note: reason === 'failed' ? messageOf(err) : null }),
      );
      return { reason };
    }
  })();
  if (boot.reason) return { reason: boot.reason };
  const { info, roster } = boot;
  const ceo = roster.find((a) => a.level === 'executive');
  const deadline = Date.parse(info.deadline);

  async function run(): Promise<{ reason: EndReason; note: string | null }> {
    const reports: TeamReport[] = [];
    let trigger: string | null = 'start';
    let launched = info.launched;
    let launchedAt = launched ? Date.now() : 0;
    let lastApproval: 'approved' | 'rejected' | null = null;
    let growthBoosts = 0;
    let lastCeoAt = Date.now();
    let lastStagnation = 0;
    const milestones = new Set<number>();

    for (;;) {
      await ctl.gate();
      if (Date.now() >= deadline) return { reason: 'deadline', note: null };
      const fin: FinanceStatus = await quick.financeCheck(missionId);
      if (fin.goalReached) return { reason: 'goal_reached', note: null };
      if (fin.budgetLeftUsd <= 0.0001) return { reason: 'budget_exhausted', note: null };

      // O CEO é acionado por evento, nunca por timer: marcos de receita,
      // estagnação, relatórios e decisões do Conselho.
      if (!trigger) {
        if (launched) {
          const progress = (fin.netUsd / info.goalUsd) * 100;
          for (const m of [25, 50, 75]) {
            if (progress >= m && !milestones.has(m)) {
              milestones.add(m);
              trigger = `milestone:${m}`;
            }
          }
          const lastSale = fin.lastSaleAt ? Date.parse(fin.lastSaleAt) : launchedAt;
          if (!trigger && Date.now() - Math.max(lastSale, lastStagnation) > info.stagnationMs) {
            trigger = 'stagnation';
            lastStagnation = Date.now();
          }
        } else if (Date.now() - Math.max(lastCeoAt, lastStagnation) > info.stagnationMs) {
          trigger = 'stagnation';
          lastStagnation = Date.now();
        }
      }
      if (!trigger) {
        phase = launched ? 'produto no ar · Financeiro acompanhando a receita' : 'aguardando';
        await condition(() => ctl.state.paused, info.financePollMs);
        continue;
      }

      if (cycle >= info.maxCycles) return { reason: 'failed', note: `Limite de ${info.maxCycles} ciclos de decisão.` };
      phase = `CEO decidindo (${trigger})`;
      await quick.missionCycle({ missionId, cycle, trigger });
      const directive = await thinking.ceoDecide({
        missionId,
        cycle,
        trigger,
        reports: reports.slice(-16),
        finance: fin,
        launched,
        lastApproval,
        growthBoosts,
      });
      lastCeoAt = Date.now();
      trigger = null;

      const newReports: TeamReport[] = [];
      if (directive.orders.length) {
        if (launched && directive.orders.some((o) => o.team === 'growth')) growthBoosts++;
        for (const wave of planWaves(directive.orders)) {
          phase = `times trabalhando: ${wave.map((o) => o.team).join(', ')}`;
          const results = await Promise.all(
            wave.map((order, i) =>
              ctl.runChild(teamWorkflow, `${missionId}-c${cycle}-${order.team}-${i}`, [{ missionId, cycle, order, rules: info.rules }]),
            ),
          );
          newReports.push(...results);
        }
        reports.push(...newReports);
        trigger = 'reports';
      }

      let anyRejected = false;
      let anyApproved = false;
      for (const ask of dedupe([...directive.approvals, ...newReports.flatMap((r) => r.needsApproval)])) {
        await ctl.gate();
        phase = `aguardando o Conselho: ${ask.title}`;
        const approvalId = await quick.approvalOpen({
          missionId,
          taskId: null,
          workflowId: workflowInfo().workflowId,
          kind: ask.kind,
          title: ask.title,
          detail: ask.justification,
          amountUsd: ask.amountUsd,
          requestedBy: ceo?.id ?? 'ceo',
        });
        const decided = await condition(() => decisions.has(approvalId), info.approvalTimeoutMs);
        const d = decisions.get(approvalId);
        if (!decided || !d) {
          await quick.approvalExpire({ approvalId, missionId });
          anyRejected = true;
          continue;
        }
        if (!d.approved) {
          anyRejected = true;
          continue;
        }
        anyApproved = true;
        const r = await quick.executeApproved({ missionId, kind: ask.kind, title: ask.title, note: d.note });
        if (r.launched && !launched) {
          launched = true;
          launchedAt = Date.now();
        }
      }
      if (anyRejected) {
        lastApproval = 'rejected';
        trigger = 'approval_rejected';
      } else if (anyApproved) {
        lastApproval = 'approved';
        trigger = trigger ?? 'approval_granted';
      }
      cycle++;
    }
  }

  // Vigia financeiro: o Financeiro lê a receita por código o tempo todo, inclusive
  // com os times trabalhando. A Missão termina no que vier primeiro — meta batida,
  // orçamento esgotado ou prazo vencido — e o trabalho em andamento é cancelado.
  const work = new CancellationScope();
  let stop: EndReason | null = null;
  let finished = false;
  const watcher = (async () => {
    while (!finished) {
      await condition(() => finished, info.financePollMs);
      if (finished || ctl.state.paused) continue;
      if (Date.now() >= deadline) stop ??= 'deadline';
      else {
        // Falha transitória da fonte de receita não derruba a missão: tenta no próximo ciclo.
        const fin = await quick.financeCheck(missionId).catch(() => null);
        if (fin?.goalReached) stop ??= 'goal_reached';
        else if (fin && fin.budgetLeftUsd <= 0.0001) stop ??= 'budget_exhausted';
      }
      if (stop) {
        work.cancel();
        return;
      }
    }
  })();

  let outcome: { reason: EndReason; note: string | null };
  try {
    outcome = await work.run(() => run());
  } catch (err) {
    if (stop) outcome = { reason: stop, note: null };
    else if (isCancellation(err)) outcome = { reason: 'cancelled', note: null };
    else if (hasFailureType(err, FAILURES.missionBudget)) outcome = { reason: 'budget_exhausted', note: messageOf(err) };
    else outcome = { reason: 'failed', note: messageOf(err) };
  }
  finished = true;
  await watcher.catch(() => undefined);
  phase = 'encerrando';
  await CancellationScope.nonCancellable(() => thinking.missionClose({ missionId, reason: outcome.reason, note: outcome.note }));
  return { reason: outcome.reason };
}

// ------------------------------------------------------------------ Time

export async function teamWorkflow(input: TeamInput): Promise<TeamReport> {
  const ctl = pausable();
  let phase = 'planejando';
  setHandler(statusQuery, () => ({ phase, paused: ctl.state.paused, children: [...ctl.children] }));

  await ctl.gate();
  const assignments: PlannedAssignment[] = await thinking.teamPlan({ missionId: input.missionId, cycle: input.cycle, order: input.order });

  // Uma fila por trabalhador; trabalhadores diferentes em paralelo.
  const queues = new Map<string, PlannedAssignment[]>();
  for (const a of assignments) {
    const q = queues.get(a.assignee.id) ?? [];
    q.push(a);
    queues.set(a.assignee.id, q);
  }
  phase = 'executando';
  const results: TaskResult[] = [];
  await Promise.all(
    [...queues.values()].map(async (queue) => {
      for (const a of queue) {
        await ctl.gate();
        await quick.taskOpen({ missionId: input.missionId, parentId: null, a });
        try {
          const r = await ctl.runChild(taskWorkflow, `${input.missionId}-${a.taskId}`, [
            {
              missionId: input.missionId,
              taskId: a.taskId,
              parentId: null,
              workOrder: a.workOrder,
              assignee: a.assignee,
              reviewer: a.reviewer,
              rules: input.rules,
              needsCi: a.needsCi,
            },
          ]);
          results.push(r);
        } catch (err) {
          if (hasFailureType(err, FAILURES.missionBudget) || isCancellation(err)) throw err;
          // Falha inesperada (ex.: modelo sem preço): fecha a tarefa no quadro e segue.
          const summary = messageOf(err);
          const closed = await quick
            .taskClose({
              missionId: input.missionId,
              taskId: a.taskId,
              assigneeId: a.assignee.id,
              title: a.workOrder.title,
              status: 'failed',
              summary,
              merge: false,
            })
            .catch(() => ({ costUsd: 0 }));
          results.push({
            taskId: a.taskId,
            title: a.workOrder.title,
            status: 'failed',
            summary,
            costUsd: closed.costUsd,
            ref: null,
            report: null,
          });
        }
      }
    }),
  );
  phase = 'reportando';
  return thinking.teamReport({ missionId: input.missionId, cycle: input.cycle, order: input.order, results });
}

// ------------------------------------------------------------------ Tarefa

export async function taskWorkflow(input: TaskInput): Promise<TaskResult> {
  const ctl = pausable();
  const decisions = new Map<string, ApprovalDecisionMsg>();
  const { missionId, taskId, assignee, reviewer, rules } = input;
  let workOrder = input.workOrder;
  let model = assignee.model;
  let attempt = 0;
  let ciFailures = 0;
  let respecs = 0;
  let round = 0;
  let conflicts = 0;
  let feedback: Feedback[] = [];
  let phase = 'começando';
  setHandler(approvalSignal, (d) => {
    decisions.set(d.approvalId, d);
  });
  setHandler(statusQuery, () => ({ phase, paused: ctl.state.paused }));

  const result = (
    status: TaskResult['status'],
    summary: string,
    costUsd: number,
    ref: string | null,
    report: DeliveryReport | null,
  ): TaskResult => ({
    taskId,
    title: workOrder.title,
    status,
    summary,
    costUsd,
    ref,
    report,
  });

  const close = (status: TaskResult['status'], summary: string, merge: boolean) =>
    quick.taskClose({ missionId, taskId, assigneeId: assignee.id, title: workOrder.title, status, summary, merge });

  /** CEO arbitra; se mandar ao Conselho, espera a decisão humana. */
  async function escalate(reason: string): Promise<'accept' | 'drop'> {
    await quick.taskEscalated({ missionId, taskId, agentId: assignee.id, to: 'ceo', fromModel: model, toModel: null, reason });
    const arb = await thinking.ceoArbitrate({ missionId, taskId, title: workOrder.title, reason });
    if (arb.decision !== 'board') return arb.decision;
    await quick.taskEscalated({
      missionId,
      taskId,
      agentId: assignee.id,
      to: 'board',
      fromModel: model,
      toModel: null,
      reason: arb.rationale,
    });
    const approvalId = await quick.approvalOpen({
      missionId,
      taskId,
      workflowId: workflowInfo().workflowId,
      kind: 'escalation',
      title: `Aceitar “${workOrder.title}” como está?`,
      detail: `${reason}\n\nCEO: ${arb.rationale}`,
      amountUsd: null,
      requestedBy: reviewer.id,
    });
    const decided = await condition(() => decisions.has(approvalId), '72 hours');
    if (!decided) await quick.approvalExpire({ approvalId, missionId });
    return decisions.get(approvalId)?.approved ? 'accept' : 'drop';
  }

  let last: { report: DeliveryReport; commit: string | null } | null = null;
  while (attempt < 12) {
    await ctl.gate();
    attempt++;
    phase = `tentativa ${attempt} (${model})`;
    try {
      last = await labor.workerRun({ missionId, taskId, attempt, assigneeId: assignee.id, model, workOrder, feedback });
    } catch (err) {
      if (hasFailureType(err, FAILURES.taskBudget)) {
        await quick.taskEscalated({
          missionId,
          taskId,
          agentId: assignee.id,
          to: 'lead',
          fromModel: model,
          toModel: null,
          reason: messageOf(err),
        });
        const c = await close('failed', 'Orçamento da tarefa esgotado', false);
        return result('failed', 'Orçamento da tarefa esgotado', c.costUsd, null, last?.report ?? null);
      }
      throw err;
    }
    feedback = [];

    // Degrau 1: portões automáticos (CI).
    let ci: { ok: boolean; summary: string } | null = null;
    if (input.needsCi) {
      phase = 'CI';
      const run = await labor.ciRun({ missionId, taskId, assigneeId: assignee.id, attempt });
      ci = { ok: run.ok, summary: run.summary };
      if (!run.ok) {
        ciFailures++;
        feedback = [{ kind: 'ci', summary: run.summary, checks: run.checks }];
        const step = onCiFailure({
          ciFailures,
          currentModel: model,
          baseModel: assignee.model,
          escalationModel: assignee.escalationModel,
          afterCiFailures: rules.ciFailuresBeforePromotion,
          respecs,
          maxRespecs: rules.maxRespecs,
        });
        if (step.action === 'promote') {
          await quick.taskEscalated({
            missionId,
            taskId,
            agentId: assignee.id,
            to: 'model',
            fromModel: model,
            toModel: step.toModel,
            reason: `CI falhou ${ciFailures}× (${run.summary})`,
          });
          model = step.toModel;
        } else if (step.action === 'respec') {
          await quick.taskEscalated({
            missionId,
            taskId,
            agentId: assignee.id,
            to: 'lead',
            fromModel: model,
            toModel: null,
            reason: 'CI falhou mesmo após a promoção',
          });
          workOrder = await thinking.leadRespec({ missionId, taskId, reviewerId: reviewer.id, workOrder, reason: run.summary });
          respecs++;
          ciFailures = 0;
          model = assignee.model;
          feedback = [{ kind: 'respec', summary: 'Especificação reescrita pelo líder.' }, ...feedback];
        } else if (step.action === 'escalate_ceo') {
          const decision = await escalate(`CI continua falhando: ${run.summary}`);
          const c = await close(
            decision === 'accept' ? 'done' : 'cancelled',
            decision === 'accept' ? 'Aceita pelo CEO sem merge (CI vermelho)' : 'Abandonada',
            false,
          );
          return result(
            decision === 'accept' ? 'done' : 'cancelled',
            decision === 'accept' ? 'Aceita com risco' : 'Abandonada',
            c.costUsd,
            last.commit,
            last.report,
          );
        }
        continue;
      }
    }

    // Degraus 2-3: autoconferência (no relatório) + revisão do líder com rubrica.
    round++;
    phase = `revisão #${round}`;
    const verdict = await thinking.leadReview({ missionId, taskId, reviewerId: reviewer.id, round, workOrder, report: last.report, ci });
    const step = afterReview({
      approved: verdict.approved,
      round,
      maxRounds: rules.maxReviewRounds,
      currentModel: model,
      escalationModel: assignee.escalationModel,
    });
    if (step.action === 'done') {
      const c = await close('done', last.report.summary, true);
      if (c.conflict) {
        if (++conflicts > 2) {
          const f = await close('failed', 'Conflitos de merge repetidos com a main', false);
          return result('failed', 'Conflitos de merge repetidos com a main', f.costUsd, last.commit, last.report);
        }
        feedback = [
          {
            kind: 'merge_conflict',
            summary: 'A main mudou e o merge conflitou. O branch foi refeito a partir da main: refaça a mudança por cima.',
          },
        ];
        round--;
        continue;
      }
      return result('done', last.report.summary, c.costUsd, last.commit, last.report);
    }
    feedback = [{ kind: 'review', summary: verdict.summary, changes: verdict.changes }];
    if (step.action === 'promote') {
      await quick.taskEscalated({
        missionId,
        taskId,
        agentId: assignee.id,
        to: 'model',
        fromModel: model,
        toModel: step.toModel,
        reason: `${rules.maxReviewRounds} revisões sem aprovação`,
      });
      model = step.toModel;
      round = 0;
    } else if (step.action === 'escalate_ceo') {
      const decision = await escalate(`${rules.maxReviewRounds} revisões sem aprovação: ${verdict.summary}`);
      const c = await close(
        decision === 'accept' ? 'done' : 'cancelled',
        decision === 'accept' ? 'Aceita pelo CEO após o limite de revisões' : 'Abandonada',
        decision === 'accept',
      );
      return result(
        decision === 'accept' ? 'done' : 'cancelled',
        decision === 'accept' ? 'Aceita com risco' : 'Abandonada',
        c.costUsd,
        last.commit,
        last.report,
      );
    }
  }
  const c = await close('failed', 'Tentativas esgotadas', false);
  return result('failed', 'Tentativas esgotadas', c.costUsd, last?.commit ?? null, last?.report ?? null);
}
