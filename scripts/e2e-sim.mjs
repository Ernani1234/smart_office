// Teste de ponta a ponta no modo simulação: cria uma missão, aprova o que o
// Conselho precisa aprovar e espera a Missão terminar. Requer a API no ar
// (pnpm dev). Uso: node scripts/e2e-sim.mjs [--goal 60] [--cap 5] [--api http://127.0.0.1:4000]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
const API = args.api ?? process.env.API ?? 'http://127.0.0.1:4000';
const goal = Number(args.goal ?? 60);
const cap = Number(args.cap ?? 5);
const timeoutMin = Number(args.timeout ?? 25);

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const ICON = {
  'ceo.decision': '👔',
  'lead.planned': '🗺️',
  'task.assigned': '📋',
  'ci.completed': '🧪',
  'task.escalated': '🧗',
  'review.completed': '📝',
  'pr.merged': '🔀',
  'task.completed': '✅',
  'approval.requested': '🛎️',
  'approval.decided': '⚖️',
  'mission.launched': '🚀',
  'revenue.recorded': '💰',
  'finance.goal_reached': '🎉',
  'mission.completed': '🏁',
  'wiki.written': '📚',
  'budget.warning': '⚠️',
};

function describe(e) {
  const d = e.data;
  switch (e.type) {
    case 'ceo.decision':
      return `CEO ${d.decision}: ${d.summary}`;
    case 'lead.planned':
      return `${e.agentId} planejou ${d.tasks} tarefa(s)`;
    case 'task.assigned':
      return `${d.assignee} ← ${e.taskId} (${d.model})`;
    case 'ci.completed':
      return `CI ${d.ok ? 'verde' : 'VERMELHO'} ${e.taskId}: ${d.checks.map((c) => `${c.ok ? '✓' : '✗'}${c.name}`).join(' ')}`;
    case 'task.escalated':
      return `escalada ${e.taskId} → ${d.to} ${d.toModel ?? ''} (${d.reason})`;
    case 'review.completed':
      return `revisão #${d.round} ${e.taskId}: ${d.verdict.approved ? 'aprovada' : `${d.verdict.changes.length} mudança(s)`}`;
    case 'pr.merged':
      return `merge ${d.branch} ${d.commit.slice(0, 7)}`;
    case 'task.completed':
      return `${e.taskId} ${d.status} US$ ${d.costUsd.toFixed(4)}`;
    case 'approval.requested':
      return `Conselho? ${d.kind}: ${d.title}`;
    case 'approval.decided':
      return `Conselho ${d.approved ? 'aprovou' : 'rejeitou'} ${d.approvalId}`;
    case 'mission.launched':
      return `${d.product} no ar`;
    case 'revenue.recorded':
      return `venda ${d.orderId} +US$ ${d.netUsd.toFixed(2)}`;
    case 'finance.goal_reached':
      return `meta batida: US$ ${d.netProfitUsd.toFixed(2)}`;
    case 'mission.completed':
      return `FIM: ${d.reason} · lucro US$ ${d.netProfitUsd.toFixed(2)} · receita US$ ${d.revenueUsd.toFixed(2)} · gasto US$ ${d.spentUsd.toFixed(4)}`;
    case 'wiki.written':
      return `wiki: ${d.title}`;
    case 'budget.warning':
      return `gasto em ${Math.round(d.pct * 100)}% do teto`;
    default:
      return e.type;
  }
}

const started = Date.now();
const health = await api('/api/health');
if (health.mode !== 'sim') {
  console.error('A API não está em modo simulação — abortando para não gastar dinheiro de verdade.');
  process.exit(2);
}
const mission = await api('/api/missions', {
  method: 'POST',
  body: JSON.stringify({
    title: 'E2E: primeiros dólares com o PrecifiCalc',
    brief: 'Validar um micro-SaaS de precificação para freelancers, lançar e vender. Missão de teste automatizado.',
    goalUsd: goal,
    spendCapUsd: cap,
    deadline: new Date(Date.now() + 2 * 3600_000).toISOString(),
    revenueSource: 'sim',
  }),
});
console.log(`missão ${mission.id} criada (meta US$ ${goal}, teto US$ ${cap})`);

let after = 0;
const seenApprovals = new Set();
let result = null;
const counters = {};
while (!result) {
  if (Date.now() - started > timeoutMin * 60_000) {
    console.error('Tempo esgotado.');
    process.exit(1);
  }
  const events = await api(`/api/events?missionId=${mission.id}&after=${after}&limit=2000`);
  for (const e of events) {
    after = e.id;
    counters[e.type] = (counters[e.type] ?? 0) + 1;
    if (e.missionId && e.missionId !== mission.id) continue;
    if (ICON[e.type]) console.log(`${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s ${ICON[e.type]} ${describe(e)}`);
    if (e.type === 'approval.requested' && !seenApprovals.has(e.data.approvalId)) {
      seenApprovals.add(e.data.approvalId);
      setTimeout(() => {
        api(`/api/approvals/${e.data.approvalId}`, {
          method: 'POST',
          body: JSON.stringify({ approved: true, note: 'Aprovado pelo teste E2E' }),
        }).catch((err) => console.error('aprovação falhou', err.message));
      }, 1500);
    }
    if (e.type === 'mission.completed') result = e.data;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('\nEventos por tipo:', JSON.stringify(counters));
const ledger = await api(`/api/ledger?missionId=${mission.id}&limit=1000`);
const spent = ledger.filter((l) => l.amountUsd < 0).reduce((s, l) => s - l.amountUsd, 0);
const revenue = ledger.filter((l) => l.kind === 'revenue').reduce((s, l) => s + l.amountUsd, 0);
console.log(`Livro-caixa: ${ledger.length} linhas · gasto US$ ${spent.toFixed(4)} · receita US$ ${revenue.toFixed(2)}`);
const tree = await api(`/api/repo/${mission.id}/tree`);
console.log(`Repositório: ${tree.length} arquivos na main → ${tree.map((f) => f.path).join(', ')}`);
if (result.reason !== 'goal_reached') {
  console.error(`Missão terminou sem bater a meta: ${result.reason}`);
  process.exit(1);
}
if (spent > cap) {
  console.error('Gasto acima do teto!');
  process.exit(1);
}
console.log(`\n✔ E2E ok em ${((Date.now() - started) / 1000).toFixed(0)}s`);
