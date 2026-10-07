import type { OfficeEvent } from '../events';
import { formatUsd } from '../money';
import {
  createFinance,
  type AgentView,
  type Bubble,
  type CompanyState,
  type FeedItem,
  type FeedKind,
  type FinanceView,
  type MissionView,
  type TaskView,
} from './state';

const CAP_THOUGHTS = 60;
const CAP_TOOLS = 40;
const CAP_FILES = 40;
const CAP_CHAT = 40;
const CAP_FEED = 400;
const CAP_SERIES = 1200;

function capPush<T>(arr: T[], item: T, cap: number): void {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function feed(s: CompanyState, e: OfficeEvent, kind: FeedKind, icon: string, text: string): void {
  const item: FeedItem = {
    id: e.id,
    ts: e.ts,
    kind,
    icon,
    text,
    agentId: e.agentId,
    missionId: e.missionId,
    taskId: e.taskId,
  };
  capPush(s.feed, item, CAP_FEED);
}

function bubble(a: AgentView | undefined, ts: string, kind: Bubble['kind'], text: string): void {
  if (a) a.bubble = { kind, ts, text: clip(text, 90) };
}

function nameOf(s: CompanyState, id: string | null | undefined): string {
  if (!id) return 'alguém';
  return s.agents[id]?.name ?? id;
}

function fin(s: CompanyState, missionId: string | null): FinanceView[] {
  const views = [s.finance._all];
  if (missionId) {
    s.finance[missionId] ??= createFinance();
    views.push(s.finance[missionId]);
  }
  return views;
}

function addSeries(f: FinanceView, ts: string): void {
  const last = f.series[f.series.length - 1];
  const point = { ts, spentUsd: f.spentUsd, revenueUsd: f.revenueUsd };
  if (last && Date.parse(ts) - Date.parse(last.ts) < 2000) {
    f.series[f.series.length - 1] = point;
  } else {
    f.series.push(point);
    if (f.series.length > CAP_SERIES) {
      // Mantém a forma da curva: descarta pontos alternados da metade antiga.
      f.series = f.series.filter((_, i) => i >= CAP_SERIES / 2 || i % 2 === 0);
    }
  }
}

function syncMissionMoney(s: CompanyState, missionId: string | null): void {
  if (!missionId) return;
  const m = s.missions[missionId];
  const f = s.finance[missionId];
  if (m && f) {
    f.netUsd = f.revenueUsd - f.spentUsd;
  }
}

function settle(a: AgentView): void {
  // Ocioso ou bloqueado depois de ter trabalhado → copa. Antes disso, mesa.
  if (a.activity === 'idle' || a.activity === 'blocked') {
    a.location = a.hasWorked ? 'copa' : 'desk';
  } else if (a.activity !== 'reviewing' && a.activity !== 'waiting') {
    a.location = 'desk';
  }
}

function toolActivity(tool: string): AgentView['activity'] {
  const t = tool.toLowerCase();
  if (t.includes('test') || t.includes('ci') || t === 'run') return 'testing';
  if (t.includes('search') || t.includes('web') || t.includes('scrape') || t.includes('crawl')) return 'researching';
  return 'typing';
}

function newTask(e: Extract<OfficeEvent, { type: 'task.created' }>): TaskView {
  const wo = e.data.workOrder;
  return {
    id: e.taskId ?? wo.id,
    missionId: e.missionId,
    parentId: e.data.parentId,
    team: e.data.team,
    role: e.data.role,
    kind: e.data.kind,
    title: e.data.title,
    objective: wo.objective,
    acceptance: wo.acceptanceCriteria,
    budgetUsd: wo.budgetUsd,
    status: 'backlog',
    assignee: null,
    reviewer: null,
    model: null,
    attempt: 0,
    round: 0,
    ciFailures: 0,
    respecs: 0,
    escalations: 0,
    ci: null,
    costUsd: 0,
    verdict: null,
    delivery: null,
    pr: null,
    files: [],
    createdAt: e.ts,
    updatedAt: e.ts,
  };
}

const LATE_IGNORED = new Set<string>([
  'task.assigned',
  'task.started',
  'task.respec',
  'task.escalated',
  'tool.called',
  'tool.result',
  'file.changed',
  'ci.started',
  'ci.completed',
  'pr.opened',
  'delivery.submitted',
  'review.started',
  'review.completed',
  'agent.thought',
  'agent.status',
]);

function missionEnded(s: CompanyState, missionId: string | null): boolean {
  const m = missionId ? s.missions[missionId] : undefined;
  return !!m && (m.status === 'completed' || m.status === 'failed' || m.status === 'cancelled');
}

/** Aplica um evento ao estado (mutável — use com immer ou num clone). */
export function applyEvent(s: CompanyState, e: OfficeEvent): void {
  if (e.id <= s.lastEventId) return; // idempotente: reaplicar o mesmo evento não muda nada
  s.lastEventId = e.id;
  s.lastTs = e.ts;
  const agent = e.agentId ? s.agents[e.agentId] : undefined;
  const task = e.taskId ? s.tasks[e.taskId] : undefined;
  // Depois que a missão acaba, atividades ainda em voo podem emitir eventos:
  // o custo conta (foi gasto de verdade), mas tarefa e agentes não se mexem mais.
  if (task && LATE_IGNORED.has(e.type) && missionEnded(s, e.missionId)) {
    if (agent) agent.lastActiveTs = e.ts;
    return;
  }
  if (agent) agent.lastActiveTs = e.ts;
  if (task) task.updatedAt = e.ts;

  switch (e.type) {
    // ---------------------------------------------------------------- empresa
    case 'company.booted':
      s.mode = e.data.mode;
      s.companyName = e.data.companyName;
      feed(s, e, 'info', '🏢', `${e.data.companyName} abriu as portas (modo ${e.data.mode === 'sim' ? 'simulação' : 'real'}).`);
      break;
    case 'company.paused':
      s.paused = true;
      feed(s, e, 'error', '🚨', `PÂNICO: empresa pausada por ${e.data.by}. ${e.data.reason}`);
      break;
    case 'company.resumed':
      s.paused = false;
      feed(s, e, 'success', '▶️', `Empresa retomada por ${e.data.by}.`);
      break;
    case 'roles.updated':
      feed(s, e, 'board', '🗂️', `roles.yaml atualizado: ${e.data.changes.join('; ') || 'sem mudanças'}`);
      break;

    // ---------------------------------------------------------------- agentes
    case 'agent.hired': {
      const id = e.agentId!;
      const prev = s.agents[id];
      const d = e.data;
      s.agents[id] = {
        id,
        name: d.name,
        roleId: d.roleId,
        title: d.title,
        team: d.team,
        level: d.level,
        model: d.model,
        effort: d.effort,
        billing: d.billing,
        desk: d.desk,
        seed: d.seed,
        activity: prev?.activity ?? 'idle',
        location: prev?.location ?? 'desk',
        taskId: prev?.taskId ?? null,
        bubble: prev?.bubble ?? null,
        costUsd: prev?.costUsd ?? 0,
        tokensIn: prev?.tokensIn ?? 0,
        tokensOut: prev?.tokensOut ?? 0,
        calls: prev?.calls ?? 0,
        thoughts: prev?.thoughts ?? [],
        tools: prev?.tools ?? [],
        files: prev?.files ?? [],
        chat: prev?.chat ?? [],
        promotedFrom: prev?.promotedFrom ?? null,
        hasWorked: prev?.hasWorked ?? false,
        tasksDone: prev?.tasksDone ?? 0,
        lastActiveTs: e.ts,
      };
      if (!prev) {
        s.agentOrder.push(id);
        feed(s, e, 'info', '🤝', `${d.name} contratado(a) como ${d.title} (${d.model}).`);
      }
      break;
    }
    case 'agent.promoted':
      if (agent) {
        agent.promotedFrom = e.data.fromModel;
        agent.model = e.data.toModel;
        bubble(agent, e.ts, 'success', `Promovido(a) a ${e.data.toModel}!`);
      }
      feed(
        s,
        e,
        e.data.by === 'board' ? 'board' : 'warning',
        '⬆️',
        `${nameOf(s, e.agentId)}: ${e.data.fromModel} → ${e.data.toModel} (${e.data.reason})`,
      );
      break;
    case 'agent.status':
      if (agent) {
        agent.activity = e.data.activity;
        if (e.data.note) bubble(agent, e.ts, e.data.activity === 'blocked' ? 'alert' : 'speech', e.data.note);
        settle(agent);
      }
      break;
    case 'agent.said':
      if (agent) {
        bubble(agent, e.ts, 'speech', e.data.text);
        capPush(agent.chat, { ts: e.ts, from: 'agent', text: e.data.text }, CAP_CHAT);
      }
      break;
    case 'agent.thought':
      if (agent) {
        capPush(agent.thoughts, { ts: e.ts, text: e.data.text, taskId: e.taskId }, CAP_THOUGHTS);
        bubble(agent, e.ts, 'thought', e.data.text);
        if (agent.activity === 'idle') agent.activity = 'thinking';
      }
      break;
    case 'agent.steered':
      if (agent) {
        capPush(agent.chat, { ts: e.ts, from: 'board', text: e.data.text }, CAP_CHAT);
        bubble(agent, e.ts, 'alert', '📩 Mensagem do Conselho');
      }
      feed(s, e, 'board', '📩', `Conselho → ${nameOf(s, e.agentId)}: “${clip(e.data.text, 80)}”`);
      break;

    // ---------------------------------------------------------------- missão
    case 'mission.created': {
      const id = e.missionId!;
      const d = e.data;
      const m: MissionView = {
        id,
        title: d.title,
        brief: d.brief,
        goalUsd: d.goalUsd,
        spendCapUsd: d.spendCapUsd,
        deadline: d.deadline,
        revenueSource: d.revenueSource,
        status: 'created',
        cycle: 0,
        createdAt: e.ts,
        startedAt: null,
        endedAt: null,
        endReason: null,
        lastDecision: null,
        launched: false,
        product: null,
        productUrl: null,
        priceUsd: null,
        budgetWarned: false,
        analytics: null,
      };
      s.missions[id] = m;
      if (!s.missionOrder.includes(id)) s.missionOrder.push(id);
      s.activeMissionId = id;
      s.finance[id] ??= createFinance();
      // Nova missão: todo mundo de volta à mesa, sem a comemoração da anterior.
      for (const a of Object.values(s.agents)) {
        a.activity = 'idle';
        a.location = 'desk';
        a.taskId = null;
        a.hasWorked = false;
      }
      feed(s, e, 'board', '🎯', `Nova missão: “${d.title}” — meta ${formatUsd(d.goalUsd)} de lucro, teto ${formatUsd(d.spendCapUsd)}.`);
      break;
    }
    case 'mission.started': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      if (m) {
        m.status = 'running';
        m.startedAt ??= e.ts;
      }
      feed(s, e, 'info', '🚦', `Missão em andamento.`);
      break;
    }
    case 'mission.cycle': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      if (m) {
        m.cycle = e.data.cycle;
        m.status = 'running';
      }
      break;
    }
    case 'mission.launched': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      if (m) {
        m.launched = true;
        m.product = e.data.product;
        m.productUrl = e.data.url;
        m.priceUsd = e.data.priceUsd;
        m.status = 'waiting';
      }
      feed(s, e, 'success', '🚀', `${e.data.product} está no ar${e.data.priceUsd ? ` por ${formatUsd(e.data.priceUsd)}` : ''}.`);
      break;
    }
    case 'mission.completed': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      const won = e.data.reason === 'goal_reached';
      if (m) {
        m.status = won ? 'completed' : e.data.reason === 'cancelled' ? 'cancelled' : 'failed';
        m.endReason = e.data.reason;
        m.endedAt = e.ts;
      }
      for (const a of Object.values(s.agents)) {
        a.activity = won ? 'celebrating' : 'idle';
        a.taskId = null;
        a.location = 'desk';
      }
      // Trabalho em andamento quando a missão acabou foi cancelado pelo workflow.
      for (const t of Object.values(s.tasks)) {
        if (t.missionId === e.missionId && !['done', 'failed', 'cancelled'].includes(t.status)) {
          t.status = 'cancelled';
          t.updatedAt = e.ts;
        }
      }
      for (const ap of Object.values(s.approvals)) {
        if (ap.missionId === e.missionId && ap.status === 'pending') ap.status = 'expired';
      }
      const labels: Record<string, string> = {
        goal_reached: 'META BATIDA',
        budget_exhausted: 'orçamento esgotado',
        deadline: 'prazo vencido',
        cancelled: 'cancelada',
        failed: 'falhou',
      };
      feed(
        s,
        e,
        won ? 'success' : 'error',
        won ? '🏆' : '🛑',
        `Missão encerrada: ${labels[e.data.reason]}. Lucro líquido ${formatUsd(e.data.netProfitUsd)} (receita ${formatUsd(e.data.revenueUsd)}, gasto ${formatUsd(e.data.spentUsd)}).`,
      );
      break;
    }

    // ---------------------------------------------------------------- decisões
    case 'ceo.decision': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      if (m) m.lastDecision = e.data.summary;
      if (agent) {
        agent.activity = 'idle';
        bubble(agent, e.ts, 'speech', e.data.summary);
        settle(agent);
        agent.location = 'desk';
      }
      const verb = { delegate: 'delegou', wait: 'decidiu esperar', pivot: 'pivotou', request_approval: 'pediu aprovação' }[e.data.decision];
      feed(s, e, 'info', '👔', `CEO ${verb}: ${clip(e.data.summary, 140)}`);
      break;
    }
    case 'lead.planned':
      if (agent) {
        agent.activity = 'idle';
        bubble(agent, e.ts, 'speech', `Plano pronto: ${e.data.tasks} tarefa(s)`);
        agent.location = 'desk';
      }
      feed(s, e, 'info', '🗺️', `${nameOf(s, e.agentId)} planejou ${e.data.tasks} tarefa(s): ${clip(e.data.summary, 120)}`);
      break;
    case 'report.submitted':
      if (agent) bubble(agent, e.ts, 'speech', 'Relatório entregue ao CEO');
      feed(s, e, 'info', '📑', `${nameOf(s, e.agentId)} → CEO: ${clip(e.data.report.summary, 140)}`);
      break;

    // ---------------------------------------------------------------- tarefas
    case 'task.created': {
      const t = newTask(e);
      if (!s.tasks[t.id]) s.taskOrder.push(t.id);
      s.tasks[t.id] = t;
      break;
    }
    case 'task.assigned':
      if (task) {
        task.assignee = e.data.assignee;
        task.reviewer = e.data.reviewer;
        task.model = e.data.model;
      }
      {
        const a = s.agents[e.data.assignee];
        if (a) {
          a.taskId = e.taskId;
          a.activity = 'working';
          a.hasWorked = true;
          a.location = 'desk';
        }
      }
      feed(s, e, 'info', '📋', `${nameOf(s, e.data.assignee)} pegou “${task?.title ?? e.taskId}” (${e.data.model}).`);
      break;
    case 'task.started':
      if (task) {
        task.status = 'in_progress';
        task.attempt = e.data.attempt;
        task.model = e.data.model;
      }
      if (agent) {
        agent.activity = 'working';
        agent.taskId = e.taskId;
        agent.location = 'desk';
        agent.hasWorked = true;
      }
      break;
    case 'task.respec':
      if (task) {
        task.respecs += 1;
        task.ciFailures = 0;
        task.status = 'in_progress';
      }
      if (agent) bubble(agent, e.ts, 'speech', 'Reescrevendo a especificação…');
      feed(s, e, 'warning', '✏️', `${nameOf(s, e.agentId)} reescreveu a especificação de “${task?.title ?? ''}”.`);
      break;
    case 'task.escalated': {
      if (task) {
        task.escalations += 1;
        if (e.data.toModel) task.model = e.data.toModel;
        if (e.data.to === 'ceo' || e.data.to === 'board') task.status = 'blocked';
      }
      const assignee = task?.assignee ? s.agents[task.assignee] : agent;
      const msg =
        e.data.to === 'model'
          ? `Socorro, sênior! Subindo para ${e.data.toModel}`
          : e.data.to === 'lead'
            ? 'Travei — voltando ao líder'
            : e.data.to === 'ceo'
              ? 'Escalado ao CEO'
              : 'Escalado ao Conselho';
      bubble(assignee, e.ts, 'alert', msg);
      feed(s, e, 'warning', '🧗', `“${task?.title ?? e.taskId}” escalada (${e.data.to}): ${clip(e.data.reason, 120)}`);
      break;
    }
    case 'task.completed': {
      if (task) {
        task.status = e.data.status === 'done' ? 'done' : e.data.status === 'failed' ? 'failed' : 'cancelled';
        task.costUsd = Math.max(task.costUsd, e.data.costUsd);
      }
      const a = task?.assignee ? s.agents[task.assignee] : agent;
      if (a && a.taskId === e.taskId) {
        a.taskId = null;
        a.activity = 'idle';
        if (e.data.status === 'done') a.tasksDone += 1;
        bubble(
          a,
          e.ts,
          e.data.status === 'done' ? 'success' : 'alert',
          e.data.status === 'done' ? 'Tarefa concluída ✓' : 'Tarefa encerrada sem sucesso',
        );
        settle(a);
      }
      feed(
        s,
        e,
        e.data.status === 'done' ? 'success' : 'error',
        e.data.status === 'done' ? '✅' : '❌',
        `“${task?.title ?? e.taskId}” ${e.data.status === 'done' ? 'concluída' : e.data.status === 'failed' ? 'falhou' : 'cancelada'} — ${formatUsd(e.data.costUsd)}.`,
      );
      break;
    }

    // ---------------------------------------------------------------- trabalho braçal
    case 'tool.called':
      if (agent) {
        capPush(
          agent.tools,
          { callId: e.data.callId, tool: e.data.tool, label: e.data.label, ok: null, summary: null, ms: null, ts: e.ts },
          CAP_TOOLS,
        );
        agent.activity = toolActivity(e.data.tool);
        agent.location = 'desk';
        bubble(agent, e.ts, 'speech', e.data.label);
      }
      break;
    case 'tool.result':
      if (agent) {
        const call = agent.tools.find((t) => t.callId === e.data.callId);
        if (call) {
          call.ok = e.data.ok;
          call.summary = e.data.summary;
          call.ms = e.data.ms;
        }
        if (agent.activity === 'testing' || agent.activity === 'researching') agent.activity = 'working';
      }
      break;
    case 'file.changed':
      if (agent) {
        capPush(agent.files, { ...e.data, ts: e.ts, taskId: e.taskId }, CAP_FILES);
        agent.activity = 'typing';
      }
      if (task && !task.files.includes(e.data.path)) task.files.push(e.data.path);
      break;
    case 'ci.started':
      s.ci = { running: true, runId: e.data.runId, lastOk: s.ci.lastOk, taskId: e.taskId, ts: e.ts };
      if (task) {
        task.status = 'ci';
        task.ci = { runId: e.data.runId, ok: null, checks: [] };
      }
      if (agent) {
        agent.activity = 'testing';
        bubble(agent, e.ts, 'speech', 'Rodando o CI…');
      }
      break;
    case 'ci.completed':
      s.ci = { running: false, runId: e.data.runId, lastOk: e.data.ok, taskId: e.taskId, ts: e.ts };
      if (task) {
        task.ci = { runId: e.data.runId, ok: e.data.ok, checks: e.data.checks };
        if (!e.data.ok) task.ciFailures += 1;
        task.status = 'in_progress';
      }
      if (agent) {
        agent.activity = 'working';
        if (e.data.ok) bubble(agent, e.ts, 'success', 'CI verde ✓');
        else {
          const failed = e.data.checks.filter((c) => !c.ok).map((c) => c.name);
          bubble(agent, e.ts, 'alert', `CI falhou: ${failed.join(', ')}`);
        }
      }
      feed(
        s,
        e,
        e.data.ok ? 'success' : 'error',
        e.data.ok ? '🟢' : '🔴',
        `CI de “${task?.title ?? e.taskId}”: ${e.data.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}`).join('  ')}`,
      );
      break;
    case 'pr.opened':
      if (task) task.pr = { branch: e.data.branch, url: e.data.url, commit: e.data.commit, merged: false };
      feed(s, e, 'info', '🔀', `PR aberto: ${e.data.branch} — ${clip(e.data.title, 80)}`);
      break;
    case 'pr.merged':
      if (task?.pr) task.pr.merged = true;
      feed(s, e, 'success', '🔀', `PR ${e.data.branch} integrado em main (${e.data.commit.slice(0, 7)}).`);
      break;
    case 'delivery.submitted':
      if (task) {
        const r = e.data.report;
        task.delivery = { summary: r.summary, risks: r.risks, questions: r.questions, done: r.done };
      }
      if (agent) bubble(agent, e.ts, 'speech', 'Entrega enviada para revisão');
      break;
    case 'review.started': {
      if (task) {
        task.status = 'review';
        task.round = e.data.round;
      }
      const reviewer = s.agents[e.data.reviewerId];
      const assignee = task?.assignee ? s.agents[task.assignee] : undefined;
      for (const a of [reviewer, assignee]) {
        if (a) {
          a.activity = 'reviewing';
          a.location = 'meeting';
        }
      }
      bubble(reviewer, e.ts, 'speech', `Revisão #${e.data.round}: vamos ver a evidência`);
      break;
    }
    case 'review.completed': {
      const v = e.data.verdict;
      if (task) {
        task.verdict = { approved: v.approved, summary: v.summary, changes: v.changes };
        task.status = v.approved ? 'review' : 'in_progress';
      }
      const reviewer = s.agents[e.data.reviewerId];
      const assignee = task?.assignee ? s.agents[task.assignee] : undefined;
      if (reviewer) {
        reviewer.activity = 'idle';
        reviewer.location = 'desk';
        bubble(reviewer, e.ts, v.approved ? 'success' : 'alert', v.approved ? 'Aprovado ✅' : `${v.changes.length} mudança(s) pedida(s)`);
      }
      if (assignee) {
        assignee.activity = v.approved ? 'idle' : 'working';
        assignee.location = 'desk';
      }
      feed(
        s,
        e,
        v.approved ? 'success' : 'warning',
        v.approved ? '👍' : '📝',
        `Revisão #${e.data.round} de “${task?.title ?? ''}”: ${v.approved ? 'aprovada' : v.changes.map((c) => `[${c.severity}] ${c.item}`).join('; ')}`,
      );
      break;
    }

    // ---------------------------------------------------------------- dinheiro
    case 'cost.recorded': {
      const d = e.data;
      for (const f of fin(s, e.missionId)) {
        f.spentUsd += d.amountUsd;
        if (d.model) f.byModel[d.model] = (f.byModel[d.model] ?? 0) + d.amountUsd;
        if (d.team) f.byTeam[d.team] = (f.byTeam[d.team] ?? 0) + d.amountUsd;
        if (d.role) f.byRole[d.role] = (f.byRole[d.role] ?? 0) + d.amountUsd;
        f.byKind[d.kind] = (f.byKind[d.kind] ?? 0) + d.amountUsd;
        f.netUsd = f.revenueUsd - f.spentUsd;
        addSeries(f, e.ts);
      }
      if (agent) {
        agent.costUsd += d.amountUsd;
        agent.calls += 1;
        // fim de uma chamada de modelo sem tarefa (CEO, líder, staff): volta ao normal
        if (agent.activity === 'thinking' && !agent.taskId) agent.activity = 'idle';
        if (d.tokens) {
          agent.tokensIn += d.tokens.input;
          agent.tokensOut += d.tokens.output;
        }
      }
      if (task) task.costUsd += d.amountUsd;
      syncMissionMoney(s, e.missionId);
      break;
    }
    case 'revenue.recorded': {
      for (const f of fin(s, e.missionId)) {
        f.revenueUsd += e.data.netUsd;
        f.grossUsd += e.data.grossUsd;
        f.sales += 1;
        f.netUsd = f.revenueUsd - f.spentUsd;
        addSeries(f, e.ts);
      }
      syncMissionMoney(s, e.missionId);
      feed(s, e, 'money', '💰', `Venda ${e.data.orderId}: +${formatUsd(e.data.netUsd)} líquido (${formatUsd(e.data.grossUsd)} bruto).`);
      break;
    }
    case 'budget.warning': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      if (m) m.budgetWarned = true;
      feed(
        s,
        e,
        'warning',
        '⚠️',
        `Gasto em ${Math.round(e.data.pct * 100)}% do teto (${formatUsd(e.data.spentUsd)} de ${formatUsd(e.data.capUsd)}).`,
      );
      break;
    }
    case 'finance.goal_reached':
      bubble(agent, e.ts, 'money', `Meta batida: ${formatUsd(e.data.netProfitUsd)}!`);
      feed(
        s,
        e,
        'success',
        '🎉',
        `Financeiro declara: meta de ${formatUsd(e.data.goalUsd)} batida (lucro ${formatUsd(e.data.netProfitUsd)}).`,
      );
      break;

    // ---------------------------------------------------------------- conselho
    case 'approval.requested':
      s.approvals[e.data.approvalId] = {
        id: e.data.approvalId,
        missionId: e.missionId,
        taskId: e.taskId,
        kind: e.data.kind,
        title: e.data.title,
        detail: e.data.detail,
        amountUsd: e.data.amountUsd,
        requestedBy: e.data.requestedBy,
        status: 'pending',
        note: null,
        createdAt: e.ts,
        decidedAt: null,
      };
      if (agent) bubble(agent, e.ts, 'alert', `Pedido ao Conselho: ${e.data.title}`);
      feed(s, e, 'board', '🛎️', `Pedido de aprovação (${e.data.kind}): ${e.data.title}`);
      break;
    case 'approval.decided': {
      const a = s.approvals[e.data.approvalId];
      if (a) {
        a.status = e.data.approved ? 'approved' : 'rejected';
        a.note = e.data.note;
        a.decidedAt = e.ts;
      }
      feed(
        s,
        e,
        'board',
        e.data.approved ? '✔️' : '✖️',
        `Conselho ${e.data.approved ? 'aprovou' : 'rejeitou'}: ${a?.title ?? e.data.approvalId}${e.data.note ? ` — “${clip(e.data.note, 80)}”` : ''}`,
      );
      break;
    }

    // ---------------------------------------------------------------- conhecimento
    case 'wiki.written':
      s.wiki = s.wiki.filter((w) => w.slug !== e.data.slug);
      s.wiki.push({ slug: e.data.slug, title: e.data.title, kind: e.data.kind, ts: e.ts });
      feed(s, e, 'info', '📚', `Wiki: “${e.data.title}”`);
      break;
    case 'analytics.snapshot': {
      const m = e.missionId ? s.missions[e.missionId] : undefined;
      if (m) m.analytics = { visits: e.data.visits, signups: e.data.signups, checkouts: e.data.checkouts };
      break;
    }
  }
}

export function applyEvents(s: CompanyState, events: OfficeEvent[]): void {
  for (const e of events) applyEvent(s, e);
}
