import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import {
  applyEvents,
  ArbitrationOutSchema,
  createState,
  CeoDirectiveOutSchema,
  fitToContext,
  formatUsd,
  LeadPlanOutSchema,
  microsToUsd,
  newEvent,
  RespecOutSchema,
  ReviewVerdictOutSchema,
  TeamReportOutSchema,
  UnknownModelError,
  WikiPageOutSchema,
  type AgentSpec,
  type ApprovalKind,
  type Arbitration,
  type CeoDirective,
  type CeoOrder,
  type DeliveryReport,
  type EndReason,
  type NewEvent,
  type Respec,
  type ReviewVerdict,
  type TeamReport,
  type WorkOrder,
} from '@office/contracts';
import { BudgetExceededError, type CallContext } from '../llm/gateway';
import type { CiCheckResult } from '../repo/ci';
import type { Feedback } from '../runtime/types';
import { SIM_PRODUCT } from '../llm/sim/script';
import type { Services } from '../services';
import { clip, newId, sleep, slugify } from '../util';
import { FAILURES, type FinanceStatus, type MissionInfo, type PlannedAssignment, type TaskResult } from './shared';

// Atividades: tudo que tem efeito colateral (modelo, banco, Git, CI, dinheiro).
// Os workflows só orquestram; se o processo cair no meio, o Temporal repete a
// atividade e retoma a missão de onde parou.

function heartbeat(): void {
  try {
    Context.current().heartbeat();
  } catch {
    // fora de uma atividade (testes/evals)
  }
}

function toFailure(err: unknown): unknown {
  if (err instanceof BudgetExceededError) {
    return ApplicationFailure.create({
      type: err.scope === 'mission' ? FAILURES.missionBudget : FAILURES.taskBudget,
      message: err.message,
      nonRetryable: true,
    });
  }
  if (err instanceof UnknownModelError) {
    return ApplicationFailure.create({ type: FAILURES.unknownModel, message: err.message, nonRetryable: true });
  }
  return err;
}

/** Batimento contínuo (o primeiro token de um modelo pensando pode demorar) + falhas tipadas. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  const ticker = setInterval(heartbeat, 5000);
  try {
    return await fn();
  } catch (err) {
    throw toFailure(err);
  } finally {
    clearInterval(ticker);
  }
}

export function createActivities(s: Services) {
  const emit = (events: NewEvent | NewEvent[]) => s.events.append(events);

  const ctxFor = (agent: AgentSpec, missionId: string | null, taskId: string | null, taskBudgetUsd: number | null): CallContext => ({
    missionId,
    taskId,
    agentId: agent.id,
    taskBudgetUsd,
    heartbeat,
  });

  const identity = (a: AgentSpec) => ({ name: `${a.name} (${a.title})`, email: `${a.id}@pixel.corp` });

  async function missionOrThrow(missionId: string) {
    const m = await s.missions.get(missionId);
    if (!m)
      throw ApplicationFailure.create({ type: FAILURES.invalidConfig, message: `Missão ${missionId} não existe`, nonRetryable: true });
    return m;
  }

  async function wikiContext(query: string): Promise<string> {
    const [vec] = await s.embedder.embed([query]).catch(() => [null]);
    const pages = await s.wiki.search(vec ?? null, query.split(' ').slice(0, 3).join(' '), 3);
    return pages
      .filter((p) => (p.score ?? 0) > 0.15)
      .map((p) => `### ${p.title} (wiki/${p.slug})\n${clip(p.body, 900)}`)
      .join('\n\n');
  }

  async function writeWiki(p: {
    slug: string;
    title: string;
    body: string;
    tags: string[];
    kind: string;
    missionId: string | null;
    agentId: string | null;
  }) {
    const [vec] = await s.embedder.embed([`${p.title}\n${p.body}`]).catch(() => [null]);
    await s.wiki.upsert({
      slug: p.slug,
      title: p.title,
      body: p.body,
      tags: p.tags,
      kind: p.kind,
      missionId: p.missionId,
      embedding: vec ?? null,
    });
    await emit(newEvent('wiki.written', { slug: p.slug, title: p.title, kind: p.kind }, { missionId: p.missionId, agentId: p.agentId }));
  }

  function rosterById(): Map<string, AgentSpec> {
    return new Map(s.roles.roster().map((a) => [a.id, a]));
  }

  function teamWorkers(team: string): AgentSpec[] {
    return s.roles.roster().filter((a) => a.team === team && a.level === 'worker');
  }

  return {
    // ------------------------------------------------------------------ missão
    async missionLoad(missionId: string): Promise<MissionInfo> {
      const m = await missionOrThrow(missionId);
      const rules = s.roles.get().company.rules;
      return {
        id: m.id,
        title: m.title,
        goalUsd: m.goalUsd,
        spendCapUsd: m.spendCapUsd,
        deadline: m.deadline,
        launched: Boolean(m.launchedAt),
        simMode: s.env.mode === 'sim',
        // Ler o mercado simulado é uma consulta local: dá para conferir sempre.
        financePollMs: (m.revenueSource === 'sim' ? Math.min(s.env.finance.pollSeconds, 5) : s.env.finance.pollSeconds) * 1000,
        stagnationMs: s.env.finance.stagnationMinutes * 60_000,
        approvalTimeoutMs: rules.approvalTimeoutHours * 3_600_000,
        maxCycles: 12,
        rules: {
          maxReviewRounds: rules.maxReviewRounds,
          ciFailuresBeforePromotion: rules.ciFailuresBeforePromotion,
          maxRespecs: rules.maxRespecs,
        },
      };
    },

    async missionStart(input: { missionId: string; workflowId: string }): Promise<{ roster: AgentSpec[] }> {
      const m = await missionOrThrow(input.missionId);
      await s.missions.setWorkflow(m.id, input.workflowId);
      await s.repos.ensureRepo(m.id, {
        name: s.env.mode === 'sim' ? SIM_PRODUCT.name : slugify(m.title) || 'produto',
        missionTitle: m.title,
      });
      await s.syncStaff();
      const already = await s.events.latestOfType('mission.started', m.id);
      if (!already) await emit(newEvent('mission.started', { workflowId: input.workflowId }, { missionId: m.id }));
      return { roster: s.roles.roster() };
    },

    async missionCycle(input: { missionId: string; cycle: number; trigger: string }): Promise<void> {
      await emit(newEvent('mission.cycle', { cycle: input.cycle, trigger: input.trigger }, { missionId: input.missionId }));
    },

    /** O Financeiro (código) lê a fonte de receita e fecha as contas. */
    async financeCheck(missionId: string): Promise<FinanceStatus> {
      const m = await missionOrThrow(missionId);
      const source = s.revenue.get(m.revenueSource);
      if (source) {
        try {
          const orders = await source.listOrders(m.id, m.createdAt);
          for (const o of orders) {
            await s.ledger.recordRevenue({
              missionId: m.id,
              orderId: o.id,
              grossMicros: o.grossMicros,
              netMicros: o.netMicros,
              source: m.revenueSource,
              ts: o.createdAt,
            });
          }
        } catch (err) {
          s.log.warn(`fonte de receita ${m.revenueSource} falhou: ${String(err)}`);
        }
      }
      const totals = await s.ledger.totals(m.id);
      const status: FinanceStatus = {
        spentUsd: microsToUsd(totals.spentMicros),
        revenueUsd: microsToUsd(totals.revenueMicros),
        netUsd: microsToUsd(totals.netMicros),
        sales: totals.sales,
        budgetLeftUsd: microsToUsd(m.capMicros - totals.spentMicros),
        goalReached: totals.netMicros >= m.goalMicros,
        lastSaleAt: await s.ledger.lastRevenueAt(m.id),
      };
      const pct = s.roles.get().company.rules.budgetWarningPct;
      if (totals.spentMicros >= m.capMicros * pct && !(await s.settings.get(`budgetWarned:${m.id}`, false))) {
        await s.settings.set(`budgetWarned:${m.id}`, true);
        await emit(
          newEvent(
            'budget.warning',
            { spentUsd: status.spentUsd, capUsd: m.spendCapUsd, pct: totals.spentMicros / m.capMicros },
            { missionId: m.id },
          ),
        );
      }
      if (status.goalReached && !(await s.settings.get(`goalDeclared:${m.id}`, false))) {
        await s.settings.set(`goalDeclared:${m.id}`, true);
        const fin = s.roles.roster().find((a) => a.roleId === 'financeiro');
        await emit(
          newEvent(
            'finance.goal_reached',
            { netProfitUsd: status.netUsd, goalUsd: m.goalUsd },
            { missionId: m.id, agentId: fin?.id ?? null },
          ),
        );
      }
      return status;
    },

    // ------------------------------------------------------------------ CEO
    async ceoDecide(input: {
      missionId: string;
      cycle: number;
      trigger: string;
      reports: TeamReport[];
      finance: FinanceStatus;
      launched: boolean;
      lastApproval: 'approved' | 'rejected' | null;
      growthBoosts: number;
    }): Promise<CeoDirective> {
      return guarded(async () => {
        const m = await missionOrThrow(input.missionId);
        const roster = s.roles.roster();
        const ceo = roster.find((a) => a.level === 'executive')!;
        const role = s.roles.role(ceo.roleId);
        const rules = s.roles.get().company.rules;
        const teams = [...new Set(roster.filter((a) => a.level === 'lead').map((a) => a.team))];
        const teamLines = teams.map((t) => {
          const workers = [...new Set(teamWorkers(t).map((w) => w.roleId))];
          return `- ${t} (${s.roles.get().teams[t]?.name ?? t}): ${workers.join(', ')}`;
        });
        const fitted = fitToContext(input.reports, (r) => JSON.stringify(r), rules.ceoMaxContextTokens, 30_000);
        const pivot =
          ['stagnation', 'approval_rejected'].includes(input.trigger) ||
          (input.trigger === 'reports' && !input.launched && input.cycle >= 1);
        const effort = pivot ? (role.pivotEffort ?? role.effort) : role.effort;
        const prompt = [
          `# Missão: ${m.title}`,
          m.brief,
          `**Métrica:** lucro líquido. Meta ${formatUsd(m.goalUsd)}. Teto de gasto ${formatUsd(m.spendCapUsd)}. Prazo ${m.deadline}.`,
          `**Gatilho desta decisão:** ${input.trigger} (ciclo ${input.cycle})`,
          `**Financeiro (por código):** gasto ${formatUsd(input.finance.spentUsd)}, receita líquida ${formatUsd(input.finance.revenueUsd)}, lucro ${formatUsd(input.finance.netUsd)}, ${input.finance.sales} venda(s), restam ${formatUsd(input.finance.budgetLeftUsd)} de teto.`,
          `**Produto no ar:** ${input.launched ? 'sim' : 'não'}${input.lastApproval ? ` · última decisão do Conselho: ${input.lastApproval}` : ''}`,
          `**Times e cargos trabalhadores:**\n${teamLines.join('\n')}`,
          fitted.kept.length
            ? `**Relatórios dos líderes (${fitted.kept.length}${fitted.dropped ? `, ${fitted.dropped} antigos omitidos` : ''}):**\n${fitted.kept.map((r) => `- [${r.team} · ciclo ${r.cycle}] ${r.summary} | riscos: ${r.risks.join('; ') || '—'} | custo ${formatUsd(r.costUsd)}`).join('\n')}`
            : '**Relatórios:** nenhum ainda.',
        ].join('\n\n');
        const { value } = await s.gateway.structured(ctxFor(ceo, m.id, null, role.taskBudgetUsd), {
          roleId: ceo.roleId,
          model: ceo.model,
          effort,
          name: 'ceo.decide',
          schemaName: 'ceo_directive',
          schema: CeoDirectiveOutSchema,
          input: prompt,
          maxOutputTokens: 12_000,
          sim: {
            purpose: 'ceo.decide',
            cycle: input.cycle,
            trigger: input.trigger,
            launched: input.launched,
            lastApproval: input.lastApproval,
            growthBoosts: input.growthBoosts,
            teams,
            netUsd: input.finance.netUsd,
            goalUsd: m.goalUsd,
            budgetLeftUsd: input.finance.budgetLeftUsd,
          },
        });
        // Ordens só para times que existem; orçamento total limitado a 80% do que resta.
        const orders = value.orders.filter((o) => teams.includes(o.team));
        const total = orders.reduce((sum, o) => sum + Math.max(0, o.budgetUsd), 0);
        const ceiling = Math.max(0, input.finance.budgetLeftUsd * 0.8);
        const scale = total > ceiling && total > 0 ? ceiling / total : 1;
        const directive: CeoDirective = {
          ...value,
          orders: orders.map((o) => ({ ...o, budgetUsd: Math.max(0.01, Number((o.budgetUsd * scale).toFixed(4))) })),
        };
        await emit(
          newEvent(
            'ceo.decision',
            {
              decision: directive.decision,
              summary: directive.summary,
              rationale: directive.rationale,
              effort,
              orders: directive.orders.map((o) => ({ team: o.team, title: o.title })),
              cycle: input.cycle,
            },
            { missionId: m.id, agentId: ceo.id },
          ),
        );
        return directive;
      });
    },

    async ceoArbitrate(input: { missionId: string; taskId: string; title: string; reason: string }): Promise<Arbitration> {
      return guarded(async () => {
        const ceo = s.roles.roster().find((a) => a.level === 'executive')!;
        const role = s.roles.role(ceo.roleId);
        const { value } = await s.gateway.structured(ctxFor(ceo, input.missionId, input.taskId, null), {
          roleId: ceo.roleId,
          model: ceo.model,
          name: 'ceo.arbitrate',
          schemaName: 'arbitration',
          schema: ArbitrationOutSchema,
          input: `Tarefa escalada: “${input.title}”.\nMotivo: ${input.reason}\nDecida: accept (aceitar como está e registrar o risco), drop (abandonar) ou board (levar ao Conselho).`,
          maxOutputTokens: 4000,
          effort: role.effort,
          sim: { purpose: 'ceo.arbitrate' },
        });
        await emit(
          newEvent(
            'agent.said',
            { text: `Arbitragem: ${value.decision} — ${clip(value.rationale, 80)}`, to: null },
            { missionId: input.missionId, agentId: ceo.id, taskId: input.taskId },
          ),
        );
        return value;
      });
    },

    // ------------------------------------------------------------------ líderes
    async teamPlan(input: { missionId: string; cycle: number; order: CeoOrder }): Promise<PlannedAssignment[]> {
      return guarded(async () => {
        const roster = s.roles.roster();
        const lead = roster.find((a) => a.level === 'lead' && a.team === input.order.team);
        if (!lead) return [];
        const role = s.roles.role(lead.roleId);
        const workers = teamWorkers(input.order.team);
        const workerRoles = [...new Set(workers.map((w) => w.roleId))];
        const roleLines = workerRoles.map((r) => {
          const def = s.roles.role(r);
          return `- ${r}: ${def.title} · ${def.model} · ferramentas [${def.tools.join(', ') || 'nenhuma'}] · orçamento por tarefa ${formatUsd(def.taskBudgetUsd)}`;
        });
        const prompt = [
          `# Ordem do CEO para o time ${input.order.team}`,
          `**${input.order.title}**`,
          `Objetivo: ${input.order.objective}`,
          `Contexto: ${input.order.context}`,
          `Critérios de aceite:\n${input.order.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
          `Orçamento da ordem: ${formatUsd(input.order.budgetUsd)}`,
          `Cargos trabalhadores disponíveis (use estes ids em "role"):\n${roleLines.join('\n')}`,
          `Tipos de tarefa (kind): research, spec, design, build, devops, test, copy, seo.`,
        ].join('\n\n');
        const { value } = await s.gateway.structured(ctxFor(lead, input.missionId, null, role.taskBudgetUsd), {
          roleId: lead.roleId,
          model: lead.model,
          name: 'lead.plan',
          schemaName: 'lead_plan',
          schema: LeadPlanOutSchema,
          input: prompt,
          maxOutputTokens: 8000,
          sim: { purpose: 'lead.plan', team: input.order.team, workerRoles, orderTitle: input.order.title },
        });
        const valid = value.tasks.filter((t) => workerRoles.includes(t.role));
        const total = valid.reduce((sum, t) => sum + Math.max(0, t.budgetUsd), 0);
        const scale = total > input.order.budgetUsd && total > 0 ? input.order.budgetUsd / total : 1;
        const load = new Map<string, number>();
        const out: PlannedAssignment[] = valid.map((t) => {
          const candidates = workers.filter((w) => w.roleId === t.role);
          candidates.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
          const assignee = candidates[0];
          load.set(assignee.id, (load.get(assignee.id) ?? 0) + 1);
          const taskId = newId('t');
          const roleDef = s.roles.role(t.role);
          const workOrder: WorkOrder = {
            id: taskId,
            missionId: input.missionId,
            team: input.order.team,
            role: t.role,
            kind: t.kind,
            title: t.title,
            objective: t.objective,
            context: t.context,
            acceptanceCriteria: t.acceptanceCriteria,
            budgetUsd: Math.min(roleDef.taskBudgetUsd * 3, Math.max(0.01, Number((t.budgetUsd * scale).toFixed(4)))),
            inputs: [],
            constraints: roleDef.tools.includes('web') ? ['Sem escrita: devolva tudo no relatório.'] : [],
          };
          const needsCi = roleDef.kind === 'image' || roleDef.tools.includes('workspace') || roleDef.tools.includes('shell');
          return { taskId, workOrder, assignee, reviewer: lead, needsCi };
        });
        await emit(
          newEvent(
            'lead.planned',
            { team: input.order.team, summary: value.summary, tasks: out.length },
            { missionId: input.missionId, agentId: lead.id },
          ),
        );
        return out;
      });
    },

    async taskOpen(input: { missionId: string; parentId: string | null; a: PlannedAssignment }): Promise<void> {
      const { a } = input;
      await emit([
        newEvent(
          'task.created',
          {
            title: a.workOrder.title,
            team: a.workOrder.team,
            role: a.workOrder.role,
            kind: a.workOrder.kind,
            parentId: input.parentId,
            workOrder: a.workOrder,
          },
          { missionId: input.missionId, taskId: a.taskId, agentId: a.reviewer.id },
        ),
        newEvent(
          'task.assigned',
          { assignee: a.assignee.id, reviewer: a.reviewer.id, model: a.assignee.model, effort: a.assignee.effort },
          { missionId: input.missionId, taskId: a.taskId, agentId: a.assignee.id },
        ),
      ]);
    },

    // ------------------------------------------------------------------ trabalho braçal
    async workerRun(input: {
      missionId: string;
      taskId: string;
      attempt: number;
      assigneeId: string;
      model: string;
      workOrder: WorkOrder;
      feedback: Feedback[];
    }): Promise<{ report: DeliveryReport; commit: string | null }> {
      return guarded(async () => {
        const agent = rosterById().get(input.assigneeId) ?? s.roles.agent(input.assigneeId);
        const role = s.roles.role(agent.roleId);
        const refs = { missionId: input.missionId, taskId: input.taskId, agentId: agent.id };
        await emit(newEvent('task.started', { attempt: input.attempt, model: input.model }, refs));

        const writes = role.tools.includes('workspace') || role.kind === 'image';
        let workspace: { dir: string; branch: string } | null = null;
        if (writes) {
          workspace = await s.repos.ensureWorktree(input.missionId, input.taskId);
          if (input.feedback.some((f) => f.kind === 'merge_conflict')) await s.repos.resetToMain(input.missionId, workspace.dir);
          else if (input.attempt > 1) await s.repos.syncWithMain(input.missionId, workspace.dir, identity(agent));
        }
        const runtime = s.runtimeFor(role);
        const outcome = await runtime.run(
          {
            missionId: input.missionId,
            taskId: input.taskId,
            attempt: input.attempt,
            agent,
            roleId: agent.roleId,
            role,
            model: input.model,
            effort: agent.effort,
            billing: role.billing,
            workOrder: input.workOrder,
            feedback: input.feedback,
            workspace,
            wikiContext: await wikiContext(`${input.workOrder.title} ${input.workOrder.objective}`),
            sim: {},
          },
          {
            ctx: ctxFor(agent, input.missionId, input.taskId, input.workOrder.budgetUsd),
            emit: async (e) => {
              await emit({ ...e, missionId: input.missionId, taskId: input.taskId, agentId: agent.id } as NewEvent);
            },
            takeMessages: () => s.messages.take(agent.id),
            heartbeat,
          },
        );

        if (outcome.files?.length && workspace) {
          for (const f of outcome.files) {
            const full = path.resolve(workspace.dir, f.path);
            if (!full.startsWith(path.resolve(workspace.dir) + path.sep) || full.includes(`${path.sep}.git${path.sep}`)) continue;
            mkdirSync(path.dirname(full), { recursive: true });
            writeFileSync(full, f.content, 'utf8');
          }
        }

        let commit: string | null = null;
        let filesChanged: string[] = [];
        if (workspace) {
          const c = await s.repos.commitAll(
            input.missionId,
            workspace.dir,
            `${input.workOrder.kind}: ${input.workOrder.title} (tentativa ${input.attempt})`,
            identity(agent),
          );
          commit = c.commit ?? (await s.repos.headCommit(workspace.dir));
          filesChanged = c.files.map((f) => f.path);
          if (c.commit) {
            const prKey = `pr:${input.taskId}`;
            const known = await s.settings.get<string | null>(prKey, null);
            const url = s.github
              ? await s.github.pushAndOpen(workspace.dir, workspace.branch, input.workOrder.title, known).catch((err) => {
                  s.log.warn(`GitHub: ${String(err)}`);
                  return known;
                })
              : null;
            if (known === null) {
              await s.settings.set(prKey, url ?? '');
              await emit(
                newEvent('pr.opened', { branch: workspace.branch, title: input.workOrder.title, url: url || null, commit: c.commit }, refs),
              );
            }
          }
        }

        if (role.tools.includes('web')) {
          const slug = slugify(`${input.workOrder.title}-${input.missionId.slice(-4)}`);
          await writeWiki({
            slug,
            title: input.workOrder.title,
            body: `${outcome.report.summary}\n\n## Evidências\n${outcome.report.evidence.map((e) => `- ${e.description}: ${e.ref}`).join('\n')}\n\n## Riscos\n${outcome.report.risks.map((r) => `- ${r}`).join('\n') || '- —'}`,
            tags: [input.workOrder.kind, input.workOrder.team],
            kind: input.workOrder.kind,
            missionId: input.missionId,
            agentId: agent.id,
          });
          outcome.report.evidence.push({ kind: 'wiki', ref: `wiki/${slug}`, description: 'Relatório salvo na wiki' });
        }

        const report: DeliveryReport = {
          ...outcome.report,
          costUsd: microsToUsd(await s.ledger.taskSpentMicros(input.taskId)),
          model: input.model,
          attempt: input.attempt,
          commit,
          filesChanged,
        };
        await emit(newEvent('delivery.submitted', { report }, refs));
        return { report, commit };
      });
    },

    async ciRun(input: {
      missionId: string;
      taskId: string;
      assigneeId: string;
      attempt: number;
    }): Promise<{ ok: boolean; checks: CiCheckResult[]; summary: string }> {
      return guarded(async () => {
        const dir = s.repos.taskDir(input.missionId, input.taskId);
        const refs = { missionId: input.missionId, taskId: input.taskId, agentId: input.assigneeId };
        if (!existsSync(path.join(dir, '.git'))) return { ok: true, checks: [], summary: 'sem código' };
        const runId = newId('ci');
        const checks = s.ci.checksOf(dir).map((c) => c.name);
        await emit(newEvent('ci.started', { runId, checks, attempt: input.attempt }, refs));
        if (s.env.mode === 'sim') await sleep(1200 / s.env.sim.speed);
        const run = await s.ci.run(dir, () => heartbeat());
        await emit(newEvent('ci.completed', { runId, ok: run.ok, checks: run.checks, ms: run.ms }, refs));
        const failed = run.checks.filter((c) => !c.ok).map((c) => c.name);
        return { ok: run.ok, checks: run.checks, summary: run.ok ? 'todos os portões verdes' : `falhou: ${failed.join(', ')}` };
      });
    },

    // ------------------------------------------------------------------ revisão
    async leadReview(input: {
      missionId: string;
      taskId: string;
      reviewerId: string;
      round: number;
      workOrder: WorkOrder;
      report: DeliveryReport;
      ci: { ok: boolean; summary: string } | null;
    }): Promise<ReviewVerdict> {
      return guarded(async () => {
        const reviewer = rosterById().get(input.reviewerId) ?? s.roles.agent(input.reviewerId);
        const role = s.roles.role(reviewer.roleId);
        const refs = { missionId: input.missionId, taskId: input.taskId, agentId: reviewer.id };
        await emit(newEvent('review.started', { reviewerId: reviewer.id, round: input.round }, refs));
        if (s.env.mode === 'sim') await sleep(2600 / s.env.sim.speed); // tempo de todo mundo chegar na sala de reunião
        const diff = await s.repos.diff(input.missionId, input.taskId, 24_000);
        const prompt = [
          `# Revisão #${input.round} — ${input.workOrder.title}`,
          `Objetivo: ${input.workOrder.objective}`,
          `Critérios de aceite:\n${input.workOrder.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
          `CI: ${input.ci ? input.ci.summary : 'não se aplica'}`,
          `Relatório de entrega:\n${JSON.stringify({ summary: input.report.summary, done: input.report.done, evidence: input.report.evidence, acceptance: input.report.acceptance, risks: input.report.risks }, null, 1)}`,
          diff.diff ? `Diff do PR:\n\`\`\`diff\n${diff.diff}\n\`\`\`` : 'Sem diff (entrega só em relatório/wiki).',
          `Limite: ${s.roles.get().company.rules.maxReviewRounds} rodadas. Esta é a #${input.round}.`,
        ].join('\n\n');
        const { value } = await s.gateway.structured(ctxFor(reviewer, input.missionId, input.taskId, null), {
          roleId: reviewer.roleId,
          model: reviewer.model,
          effort: role.reviewEffort ?? role.effort,
          name: 'lead.review',
          schemaName: 'review_verdict',
          schema: ReviewVerdictOutSchema,
          input: prompt,
          maxOutputTokens: 8000,
          sim: { purpose: 'lead.review', title: input.workOrder.title, round: input.round, kind: input.workOrder.kind },
        });
        // `nit` não bloqueia: aprovação automática se só sobrar perfumaria.
        const blocking = value.changes.filter((c) => c.severity !== 'nit');
        const verdict: ReviewVerdict = !value.approved && blocking.length === 0 ? { ...value, approved: true } : value;
        await emit(newEvent('review.completed', { reviewerId: reviewer.id, round: input.round, verdict }, refs));
        return verdict;
      });
    },

    async leadRespec(input: {
      missionId: string;
      taskId: string;
      reviewerId: string;
      workOrder: WorkOrder;
      reason: string;
    }): Promise<WorkOrder> {
      return guarded(async () => {
        const lead = rosterById().get(input.reviewerId) ?? s.roles.agent(input.reviewerId);
        const { value } = await s.gateway.structured(ctxFor(lead, input.missionId, input.taskId, null), {
          roleId: lead.roleId,
          model: lead.model,
          name: 'lead.respec',
          schemaName: 'respec',
          schema: RespecOutSchema,
          input: `A tarefa travou mesmo após promoção de modelo.\nMotivo: ${input.reason}\nOrdem atual:\n${JSON.stringify(input.workOrder, null, 1)}\nReescreva com escopo menor e critérios mais claros.`,
          maxOutputTokens: 6000,
          sim: {
            purpose: 'lead.respec',
            objective: input.workOrder.objective,
            context: input.workOrder.context,
            acceptanceCriteria: input.workOrder.acceptanceCriteria,
          },
        });
        const v: Respec = value;
        await emit(
          newEvent(
            'task.respec',
            { by: lead.id, summary: v.summary },
            { missionId: input.missionId, taskId: input.taskId, agentId: lead.id },
          ),
        );
        return {
          ...input.workOrder,
          objective: v.objective,
          context: v.context,
          acceptanceCriteria: v.acceptanceCriteria.length ? v.acceptanceCriteria : input.workOrder.acceptanceCriteria,
        };
      });
    },

    async taskEscalated(input: {
      missionId: string;
      taskId: string;
      agentId: string;
      to: 'model' | 'lead' | 'ceo' | 'board';
      fromModel: string | null;
      toModel: string | null;
      reason: string;
    }): Promise<void> {
      await emit(
        newEvent(
          'task.escalated',
          { to: input.to, fromModel: input.fromModel, toModel: input.toModel, reason: input.reason },
          { missionId: input.missionId, taskId: input.taskId, agentId: input.agentId },
        ),
      );
    },

    /** Integra o PR (se aprovado) e fecha a tarefa. Conflito devolve para retrabalho. */
    async taskClose(input: {
      missionId: string;
      taskId: string;
      assigneeId: string;
      title: string;
      status: 'done' | 'failed' | 'cancelled';
      summary: string;
      merge: boolean;
    }): Promise<{ conflict: boolean; costUsd: number }> {
      const agent = rosterById().get(input.assigneeId) ?? s.roles.agent(input.assigneeId);
      const refs = { missionId: input.missionId, taskId: input.taskId, agentId: agent.id };
      const dir = s.repos.taskDir(input.missionId, input.taskId);
      if (input.merge && input.status === 'done' && existsSync(path.join(dir, '.git'))) {
        const r = await s.repos.merge(input.missionId, input.taskId, input.title, identity(agent));
        if (!r.ok) return { conflict: true, costUsd: 0 };
        if (r.commit) await emit(newEvent('pr.merged', { branch: s.repos.branchOf(input.taskId), commit: r.commit }, refs));
        if (s.github) await s.github.pushMain(s.repos.mainDir(input.missionId)).catch((err) => s.log.warn(`GitHub: ${String(err)}`));
      }
      if (existsSync(dir)) await s.repos.removeWorktree(input.missionId, input.taskId);
      const costUsd = microsToUsd(await s.ledger.taskSpentMicros(input.taskId));
      await emit(newEvent('task.completed', { status: input.status, summary: input.summary, costUsd }, refs));
      return { conflict: false, costUsd };
    },

    async teamReport(input: { missionId: string; cycle: number; order: CeoOrder; results: TaskResult[] }): Promise<TeamReport> {
      return guarded(async () => {
        const lead = s.roles.roster().find((a) => a.level === 'lead' && a.team === input.order.team);
        const costUsd = input.results.reduce((sum, r) => sum + r.costUsd, 0);
        const base = {
          team: input.order.team,
          cycle: input.cycle,
          costUsd,
          tasksDone: input.results.filter((r) => r.status === 'done').length,
          tasksFailed: input.results.filter((r) => r.status !== 'done').length,
        };
        if (!lead) {
          return { ...base, summary: 'Time sem líder.', deliverables: [], risks: [], questions: [], needsApproval: [] };
        }
        let out;
        try {
          const r = await s.gateway.structured(ctxFor(lead, input.missionId, null, null), {
            roleId: lead.roleId,
            model: lead.model,
            name: 'lead.report',
            schemaName: 'team_report',
            schema: TeamReportOutSchema,
            input: `Ordem: ${input.order.title}\nResultados:\n${input.results.map((r) => `- [${r.status}] ${r.title}: ${clip(r.summary, 300)} (ref ${r.ref ?? '—'}, ${formatUsd(r.costUsd)})${r.report?.risks.length ? ` · riscos: ${r.report.risks.join('; ')}` : ''}`).join('\n')}\nEscreva o relatório condensado para o CEO.`,
            maxOutputTokens: 4000,
            sim: {
              purpose: 'lead.report',
              team: input.order.team,
              results: input.results.map((r) => ({ title: r.title, status: r.status, ref: r.ref })),
            },
          });
          out = r.value;
        } catch (err) {
          if (!(err instanceof BudgetExceededError)) throw err;
          out = {
            summary: `${base.tasksDone}/${input.results.length} tarefas concluídas (relatório por código: orçamento esgotado).`,
            deliverables: input.results.filter((r) => r.status === 'done').map((r) => ({ title: r.title, ref: r.ref ?? 'main' })),
            risks: ['Orçamento esgotado'],
            questions: [],
            needsApproval: [],
          };
        }
        const report: TeamReport = { ...out, ...base };
        await emit(newEvent('report.submitted', { report }, { missionId: input.missionId, agentId: lead.id }));
        return report;
      });
    },

    // ------------------------------------------------------------------ conselho
    async approvalOpen(input: {
      missionId: string;
      taskId: string | null;
      workflowId: string;
      kind: ApprovalKind;
      title: string;
      detail: string;
      amountUsd: number | null;
      requestedBy: string;
    }): Promise<string> {
      const id = newId('ap');
      await s.approvals.create({
        id,
        missionId: input.missionId,
        taskId: input.taskId,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        amountUsd: input.amountUsd,
        requestedBy: input.requestedBy,
        workflowId: input.workflowId,
      });
      await emit(
        newEvent(
          'approval.requested',
          {
            approvalId: id,
            kind: input.kind,
            title: input.title,
            detail: input.detail,
            amountUsd: input.amountUsd,
            requestedBy: input.requestedBy,
          },
          { missionId: input.missionId, taskId: input.taskId, agentId: input.requestedBy },
        ),
      );
      return id;
    },

    async approvalExpire(input: { approvalId: string; missionId: string }): Promise<void> {
      const a = await s.approvals.get(input.approvalId);
      if (a?.status !== 'pending') return;
      await s.approvals.expire(input.approvalId);
      await emit(
        newEvent(
          'approval.decided',
          { approvalId: input.approvalId, approved: false, note: 'Expirou sem decisão', by: 'sistema' },
          { missionId: input.missionId },
        ),
      );
    },

    /** Executa o que o Conselho aprovou. Dinheiro e contato com pessoas nunca são automáticos. */
    async executeApproved(input: {
      missionId: string;
      kind: ApprovalKind;
      title: string;
      note: string | null;
    }): Promise<{ launched: boolean; note: string }> {
      const m = await missionOrThrow(input.missionId);
      if (input.kind === 'publish') {
        const url = input.note?.match(/https?:\/\/\S+/)?.[0] ?? null;
        const product = s.env.mode === 'sim' ? SIM_PRODUCT.name : m.title;
        // Mercado simulado vende pelo preço de tabela, inclusive no modo real.
        const priceUsd = s.env.mode === 'sim' || m.revenueSource === 'sim' ? SIM_PRODUCT.priceUsd : null;
        await s.missions.markLaunched(m.id, { name: product, url, priceUsd });
        await emit(
          newEvent(
            'mission.launched',
            { product, url: url ?? (s.env.mode === 'sim' ? 'https://precificalc.sim' : null), priceUsd },
            { missionId: m.id },
          ),
        );
        return { launched: true, note: 'Produto publicado.' };
      }
      if (input.kind === 'deploy') {
        if (s.env.mode === 'real' && s.env.deployCommand) {
          const { execFile } = await import('node:child_process');
          const out = await new Promise<string>((resolve) => {
            execFile(s.env.deployCommand!, { cwd: s.repos.mainDir(m.id), shell: true, timeout: 15 * 60_000 }, (err, stdout, stderr) =>
              resolve(err ? `falhou: ${stderr || err.message}` : `ok: ${stdout.slice(-300)}`),
            );
          });
          return { launched: false, note: `Deploy: ${out}` };
        }
        return {
          launched: false,
          note: s.env.mode === 'sim' ? 'Deploy simulado concluído.' : 'Sem DEPLOY_COMMAND: deploy fica a cargo do Conselho.',
        };
      }
      return { launched: false, note: 'Registrado. Execução manual pelo Conselho (a empresa nunca gasta nem contata pessoas sozinha).' };
    },

    async emitEvents(events: NewEvent[]): Promise<void> {
      await emit(events);
    },

    // ------------------------------------------------------------------ encerramento
    async missionClose(input: { missionId: string; reason: EndReason; note: string | null }): Promise<void> {
      return guarded(async () => {
        const m = await missionOrThrow(input.missionId);
        if (m.endedAt) return;
        const totals = await s.ledger.totals(m.id);
        await s.missions.end(m.id, input.reason);
        await s.repos.cleanupTasks(m.id).catch(() => undefined);
        for (const a of await s.approvals.list('pending')) {
          if (a.missionId === m.id) await s.approvals.expire(a.id);
        }
        await emit(
          newEvent(
            'mission.completed',
            {
              reason: input.reason,
              netProfitUsd: microsToUsd(totals.netMicros),
              revenueUsd: microsToUsd(totals.revenueMicros),
              spentUsd: microsToUsd(totals.spentMicros),
              note: input.note,
            },
            { missionId: m.id },
          ),
        );
        // Relatório financeiro (o Luna só redige) e post-mortem na wiki.
        const roster = s.roles.roster();
        const fin = roster.find((a) => a.roleId === 'financeiro') ?? roster.find((a) => a.level === 'staff');
        const sec = roster.find((a) => a.roleId === 'secretaria') ?? fin;
        const byModel = await s.db.query<{ model: string | null; team: string | null; usd: number }>(
          `select model, team, sum(-amount_micros)::bigint as usd from ledger where mission_id = $1 and amount_micros < 0 group by model, team order by usd desc limit 6`,
          [m.id],
        );
        const topCosts = byModel.map((r) => ({
          label: `${r.team ?? 'empresa'} · ${r.model ?? 'ferramentas'}`,
          usd: microsToUsd(Number(r.usd)),
        }));
        const numbers = {
          missionTitle: m.title,
          revenueUsd: microsToUsd(totals.revenueMicros),
          spentUsd: microsToUsd(totals.spentMicros),
          netUsd: microsToUsd(totals.netMicros),
          goalUsd: m.goalUsd,
          capUsd: m.spendCapUsd,
          sales: totals.sales,
          topCosts,
        };
        // Linha do tempo com o mesmo texto do diário do escritório (projeção pura).
        const projection = createState();
        applyEvents(projection, await s.events.list({ missionId: m.id, limit: 10_000 }));
        const KEEP = new Set(['🎯', '👔', '🧗', '✔️', '✖️', '🚀', '🎉', '🏆', '🛑', '⚠️', '🛎️', '✏️']);
        const hhmm = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const timeline = projection.feed
          .filter((f) => f.missionId === m.id && KEEP.has(f.icon))
          .slice(-40)
          .map((f) => `${hhmm(f.ts)} · ${f.icon} ${clip(f.text, 160)}`);
        const outcome = {
          goal_reached: 'Meta batida.',
          budget_exhausted: 'Encerrada por orçamento esgotado.',
          deadline: 'Encerrada por prazo.',
          cancelled: 'Cancelada pelo Conselho.',
          failed: 'Falhou.',
        }[input.reason];
        for (const doc of [
          { agent: fin, purpose: 'finance.report', slug: `financeiro-${m.id}`, kind: 'report', hint: numbers },
          {
            agent: sec,
            purpose: 'postmortem',
            slug: `post-mortem-${m.id}`,
            kind: 'postmortem',
            hint: { missionTitle: m.title, outcome: `${outcome} ${input.note ?? ''}`, timeline },
          },
        ]) {
          if (!doc.agent) continue;
          let page;
          try {
            const r = await s.gateway.structured(ctxFor(doc.agent, m.id, null, null), {
              roleId: doc.agent.roleId,
              model: doc.agent.model,
              effort: 'low',
              name: doc.purpose,
              schemaName: 'wiki_page',
              schema: WikiPageOutSchema,
              input: `Dados (já contados por código — não recalcule):\n${JSON.stringify(doc.hint, null, 1)}\nEscreva a página da wiki em Markdown.`,
              maxOutputTokens: 3000,
              sim: { purpose: doc.purpose, ...doc.hint },
            });
            page = r.value;
          } catch (err) {
            if (!(err instanceof BudgetExceededError)) throw toFailure(err);
            page = {
              title: doc.purpose === 'postmortem' ? `Post-mortem — ${m.title}` : `Financeiro — ${m.title}`,
              body: `${outcome}\n\n${timeline.map((t) => `- ${t}`).join('\n')}`,
              tags: [doc.kind],
            };
          }
          await writeWiki({
            slug: doc.slug,
            title: page.title,
            body: page.body,
            tags: page.tags,
            kind: doc.kind,
            missionId: m.id,
            agentId: doc.agent.id,
          });
        }
      });
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
