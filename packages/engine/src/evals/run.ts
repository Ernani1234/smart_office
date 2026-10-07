// Evals: “antes de fixar a escada de modelos, rode as mesmas tarefas do backlog
// nos dois modelos e compare a taxa de aprovação no CI com o custo. É esse número
// que decide, não a tabela.”
//
//   pnpm eval -- --models gpt-6-luna,gpt-6.1-sol            (simulação, grátis)
//   LLM_PROVIDER=openai pnpm eval -- --models ... --yes --cap 2   (real, cobra!)
//
// Cada tarefa tem testes OCULTOS (o agente não vê): só entram depois da entrega,
// junto com o CI. Aprovação = todos os portões verdes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRoster, formatUsd, microsToUsd, type AgentSpec, type Role, type WorkOrder } from '@office/contracts';
import { readEnv } from '../env';
import { createServices } from '../services';
import { newId } from '../util';

interface EvalTask {
  id: string;
  title: string;
  objective: string;
  context: string;
  acceptanceCriteria: string[];
  hiddenTests: Record<string, string>;
}

interface Result {
  task: string;
  model: string;
  pass: boolean;
  costUsd: number;
  ms: number;
  note: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Taxas simuladas por tier — só para demonstrar o relatório sem gastar. */
const SIM_PASS: Record<string, number> = { astra: 0.94, sol: 0.86, luna: 0.58 };

async function main() {
  const base = readEnv();
  const env = { ...base, dataDir: path.join(base.dataDir, 'evals') };
  const models = (arg('models', 'gpt-6-luna,gpt-6.1-sol') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const tasksDir = path.resolve(env.root, arg('tasks', 'evals/tasks')!);
  const repeat = Math.max(1, Number(arg('repeat', env.mode === 'sim' ? '5' : '1')));
  const cap = Number(arg('cap', '2'));
  const tasks: EvalTask[] = readdirSync(tasksDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(tasksDir, f), 'utf8')) as EvalTask);

  if (env.mode === 'real' && !process.argv.includes('--yes')) {
    console.error(
      `Modo REAL: ${tasks.length} tarefas × ${models.length} modelos × ${repeat} vezes, teto ${formatUsd(cap)}. Rode de novo com --yes para confirmar (ou LLM_PROVIDER=sim para simular).`,
    );
    process.exit(2);
  }

  const s = await createServices(env);
  const pricing = s.pricing.get();
  for (const m of models) if (!pricing.models[m]) throw new Error(`Modelo sem preço em pricing.yaml: ${m}`);
  const missionId = newId('eval');
  await s.missions.create(missionId, {
    title: `Eval ${models.join(' × ')}`,
    brief: 'Evals de calibração de modelo por cargo',
    goalUsd: 1,
    spendCapUsd: cap,
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    revenueSource: 'sim',
  });
  await s.repos.ensureRepo(missionId, { name: 'evals', missionTitle: 'Evals' });

  const roles = s.roles.get();
  const devRole: Role = roles.roles.dev ?? Object.values(roles.roles).find((r) => r.level === 'worker' && r.tools.includes('shell'))!;
  const devSpec: AgentSpec = buildRoster(roles).find((a) => a.roleId === 'dev') ?? buildRoster(roles).find((a) => a.level === 'worker')!;
  const results: Result[] = [];
  console.log(
    `\nEvals (${env.mode === 'sim' ? 'SIMULADO — taxas ilustrativas' : 'REAL'}): ${tasks.length} tarefas × ${models.length} modelos × ${repeat}\n`,
  );

  for (const model of models) {
    const tier = pricing.models[model].tier ?? 'luna';
    for (let r = 0; r < repeat; r++) {
      for (const t of tasks) {
        const taskId = newId('ev');
        const started = Date.now();
        const workOrder: WorkOrder = {
          id: taskId,
          missionId,
          team: devRole.team,
          role: 'dev',
          kind: 'build',
          title: t.title,
          objective: t.objective,
          context: t.context,
          acceptanceCriteria: t.acceptanceCriteria,
          budgetUsd: Math.max(0.05, devRole.taskBudgetUsd),
          inputs: [],
          constraints: ['Node 22, ES modules, sem dependências externas.'],
        };
        let pass = false;
        let note = '';
        try {
          if (env.mode === 'sim') {
            // Custo pela tabela real sobre tokens estimados; resultado sorteado por tier.
            await s.gateway.turn(
              { missionId, taskId, agentId: devSpec.id, taskBudgetUsd: null },
              {
                roleId: devSpec.roleId,
                model,
                effort: devRole.effort,
                billing: devRole.billing,
                input: [{ role: 'user', content: `${t.objective}\n${t.context}\n${t.acceptanceCriteria.join('\n')}` }],
                sim: { purpose: 'worker.turn', thoughts: [] },
                name: 'eval',
              },
            );
            pass = Math.random() < (SIM_PASS[tier] ?? 0.6);
            note = 'simulado';
          } else {
            const ws = await s.repos.ensureWorktree(missionId, taskId);
            const runtime = s.runtimeFor(devRole);
            await runtime.run(
              {
                missionId,
                taskId,
                attempt: 1,
                agent: { ...devSpec, model },
                roleId: devSpec.roleId,
                role: devRole,
                model,
                effort: devRole.effort,
                billing: devRole.billing,
                workOrder,
                feedback: [],
                workspace: ws,
                wikiContext: '',
                sim: {},
              },
              {
                ctx: { missionId, taskId, agentId: devSpec.id, taskBudgetUsd: workOrder.budgetUsd },
                emit: async () => undefined,
                takeMessages: async () => [],
                heartbeat: () => undefined,
              },
            );
            for (const [file, content] of Object.entries(t.hiddenTests)) {
              const full = path.join(ws.dir, file);
              mkdirSync(path.dirname(full), { recursive: true });
              writeFileSync(full, content, 'utf8');
            }
            const ci = await s.ci.run(ws.dir);
            pass = ci.ok;
            note =
              ci.checks
                .filter((c) => !c.ok)
                .map((c) => c.name)
                .join(', ') || 'ok';
          }
        } catch (err) {
          note = (err as Error).message.slice(0, 120);
        }
        const costUsd = microsToUsd(await s.ledger.taskSpentMicros(taskId));
        results.push({ task: t.id, model, pass, costUsd, ms: Date.now() - started, note });
        console.log(`  ${pass ? '✓' : '✗'} ${model.padEnd(14)} ${t.id.padEnd(10)} ${formatUsd(costUsd).padStart(12)}  ${note}`);
      }
    }
  }

  console.log('\nResumo — é este número que decide a escada de modelos:\n');
  console.log(`  ${'modelo'.padEnd(16)}${'aprovação'.padStart(10)}${'custo médio'.padStart(16)}${'custo por aprovação'.padStart(22)}`);
  const summary = models.map((model) => {
    const rs = results.filter((r) => r.model === model);
    const passes = rs.filter((r) => r.pass).length;
    const total = rs.reduce((a, r) => a + r.costUsd, 0);
    return { model, passRate: passes / rs.length, avgCostUsd: total / rs.length, costPerPassUsd: passes ? total / passes : null };
  });
  for (const x of summary) {
    console.log(
      `  ${x.model.padEnd(16)}${`${Math.round(x.passRate * 100)}%`.padStart(10)}${formatUsd(x.avgCostUsd).padStart(16)}${(x.costPerPassUsd === null ? '—' : formatUsd(x.costPerPassUsd)).padStart(22)}`,
    );
  }
  const outDir = path.join(env.root, 'evals', 'results');
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ mode: env.mode, models, repeat, summary, results }, null, 2));
  console.log(`\nResultados em ${path.relative(env.root, file)}`);
  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
