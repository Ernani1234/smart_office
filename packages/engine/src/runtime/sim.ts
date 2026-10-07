import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { imageCostMicros, newEvent, type DeliveryReportOut } from '@office/contracts';
import type { PricingStore } from '../config/stores';
import type { Ledger } from '../db/ledger';
import type { LlmGateway } from '../llm/gateway';
import * as P from '../llm/sim/product';
import type { Sandbox } from '../sandbox/exec';
import { splitCommand } from '../sandbox/exec';
import { sleep, tail } from '../util';
import type { WorkerHooks, WorkerJob, WorkerOutcome, WorkerRuntime } from './types';

// Trabalhador simulado. A "cabeça" é roteirizada, mas as mãos são reais:
// escreve arquivos de verdade no worktree, roda comandos de verdade no sandbox,
// e cada "turno" passa pelo gateway (pausa, orçamento, livro-caixa, pensamentos).

type Step =
  | { kind: 'think'; thoughts: string[]; webSearches?: number }
  | { kind: 'list'; dir: string }
  | { kind: 'read'; path: string }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'append'; path: string; content: string }
  | { kind: 'run'; command: string }
  | { kind: 'search'; query: string };

interface Plan {
  steps: Step[];
  report: DeliveryReportOut;
}

function isLuna(model: string): boolean {
  return model.includes('luna');
}

function accept(job: WorkerJob, evidence: string): DeliveryReportOut['acceptance'] {
  return job.workOrder.acceptanceCriteria.map((criterion) => ({ criterion, met: true, evidence }));
}

function plan(job: WorkerJob): Plan {
  const wo = job.workOrder;
  const title = wo.title.toLowerCase();
  const reviewChanges = job.feedback.some((f) => f.kind === 'review');
  const ciFailed = job.feedback.some((f) => f.kind === 'ci');
  const base = { risks: [] as string[], questions: [] as string[] };

  switch (wo.kind) {
    case 'build': {
      if (title.includes('núcleo')) {
        if (reviewChanges) {
          return {
            steps: [
              {
                kind: 'think',
                thoughts: ['Parecer pede validação de entrada e constante nomeada.', 'Vou lançar RangeError e cobrir com teste.'],
              },
              { kind: 'read', path: 'src/pricing.js' },
              { kind: 'write', path: 'src/pricing.js', content: P.PRICING_VALIDATED },
              { kind: 'append', path: 'test/pricing.test.js', content: P.PRICING_VALIDATION_TESTS },
              { kind: 'run', command: 'node --test' },
            ],
            report: {
              summary: 'Validação de entrada com RangeError e constante COMPLEXITY extraída, com testes novos.',
              done: ['RangeError para valores ≤ 0', 'COMPLEXITY como constante congelada', 'Teste de entradas inválidas'],
              evidence: [
                { kind: 'test', ref: 'test/pricing.test.js', description: '5 testes passando localmente' },
                { kind: 'file', ref: 'src/pricing.js', description: 'Validações no início de cada função' },
              ],
              acceptance: accept(job, 'node --test verde'),
              ...base,
            },
          };
        }
        if (isLuna(job.model) && job.attempt === 1) {
          return {
            steps: [
              { kind: 'think', thoughts: ['Lendo a ordem e a spec do produto.', 'Fórmula: renda mais custos dividido pelas horas.'] },
              { kind: 'list', dir: '.' },
              { kind: 'read', path: 'docs/spec.md' },
              { kind: 'write', path: 'src/pricing.js', content: P.PRICING_BUGGY_NO_TAX },
              { kind: 'write', path: 'test/pricing.test.js', content: P.PRICING_TESTS },
              { kind: 'run', command: 'node --test' },
              { kind: 'think', thoughts: ['Teste de impostos falhou… esqueci a alíquota.', 'Ajusto e sigo, deve passar agora.'] },
              { kind: 'write', path: 'src/pricing.js', content: P.PRICING_BUGGY_FLOOR },
            ],
            report: {
              summary: 'hourlyRate e projectQuote implementados com testes.',
              done: ['src/pricing.js', 'test/pricing.test.js'],
              evidence: [{ kind: 'file', ref: 'src/pricing.js', description: 'Funções exportadas' }],
              acceptance: accept(job, 'Implementado conforme a spec'),
              risks: ['Não rodei os testes de novo depois do ajuste final.'],
              questions: [],
            },
          };
        }
        if (isLuna(job.model)) {
          return {
            steps: [
              {
                kind: 'think',
                thoughts: ['CI acusou arredondamento: Math.floor corta os centavos.', 'Arredondo antes de aplicar o imposto.'],
              },
              { kind: 'read', path: 'src/pricing.js' },
              {
                kind: 'write',
                path: 'src/pricing.js',
                content: P.PRICING_OK.replace('return round2(base * (1 + taxRate));', 'return round2(base) * (1 + taxRate);'),
              },
              { kind: 'run', command: 'node --test' },
              { kind: 'think', thoughts: ['Ainda vermelho por uma casa decimal… vou entregar e sinalizar.'] },
            ],
            report: {
              summary: 'Corrigido o arredondamento apontado pelo CI.',
              done: ['Arredondamento em centavos'],
              evidence: [{ kind: 'file', ref: 'src/pricing.js', description: 'round2 aplicado' }],
              acceptance: job.workOrder.acceptanceCriteria.map((c) => ({
                criterion: c,
                met: !c.includes('node --test'),
                evidence: 'parcial',
              })),
              risks: ['Teste de arredondamento ainda instável.'],
              questions: ['Arredondar antes ou depois do imposto?'],
            },
          };
        }
        return {
          steps: [
            {
              kind: 'think',
              thoughts: [
                ciFailed ? 'Duas falhas de CI: o erro é a ordem das operações.' : 'Implementando direto da spec.',
                'Imposto entra antes do arredondamento: round2(base × (1 + t)).',
              ],
            },
            { kind: 'read', path: 'docs/spec.md' },
            { kind: 'write', path: 'src/pricing.js', content: P.PRICING_OK },
            { kind: 'write', path: 'test/pricing.test.js', content: P.PRICING_TESTS },
            { kind: 'run', command: 'node --test' },
          ],
          report: {
            summary: 'Núcleo corrigido: imposto aplicado antes do arredondamento. Todos os testes passam.',
            done: ['hourlyRate com impostos', 'projectQuote com complexidade', 'formatBRL'],
            evidence: [
              { kind: 'test', ref: 'test/pricing.test.js', description: '4 testes passando localmente' },
              { kind: 'file', ref: 'src/pricing.js', description: 'Fórmula da spec' },
            ],
            acceptance: accept(job, 'node --test verde'),
            ...base,
          },
        };
      }
      return {
        steps: [
          { kind: 'think', thoughts: ['Interface simples, sem dependências.', 'Formulário chama o núcleo a cada alteração.'] },
          { kind: 'list', dir: '.' },
          { kind: 'write', path: 'public/index.html', content: P.INTERFACE_HTML },
          { kind: 'run', command: 'node scripts/lint.mjs' },
        ],
        report: {
          summary: 'Interface web da calculadora criada em public/index.html.',
          done: ['Formulário acessível', 'Resultado formatado em BRL', 'Erros de validação exibidos'],
          evidence: [{ kind: 'file', ref: 'public/index.html', description: 'Formulário + script módulo' }],
          acceptance: accept(job, 'public/index.html'),
          ...base,
        },
      };
    }
    case 'devops':
      return {
        steps: [
          { kind: 'think', thoughts: ['Mesmos portões no GitHub Actions via scripts/ci.mjs.', 'Dockerfile mínimo servindo public/.'] },
          { kind: 'write', path: '.github/workflows/ci.yml', content: P.CI_WORKFLOW },
          { kind: 'write', path: 'Dockerfile', content: P.DOCKERFILE },
          { kind: 'write', path: 'scripts/serve.mjs', content: P.SERVE_SCRIPT },
          { kind: 'run', command: 'node scripts/check-syntax.mjs' },
        ],
        report: {
          summary: 'CI no GitHub Actions e Dockerfile com servidor estático.',
          done: ['.github/workflows/ci.yml', 'Dockerfile', 'scripts/serve.mjs'],
          evidence: [{ kind: 'file', ref: '.github/workflows/ci.yml', description: 'Roda node scripts/ci.mjs' }],
          acceptance: accept(job, 'Arquivos no PR'),
          ...base,
        },
      };
    case 'spec':
      return {
        steps: [
          { kind: 'think', thoughts: ['Pesquisa da wiki confirma a dor.', 'Spec de uma tela, com critérios testáveis.'] },
          { kind: 'write', path: 'docs/spec.md', content: P.SPEC_MD },
        ],
        report: {
          summary: 'Spec do MVP em docs/spec.md com critérios de aceite testáveis.',
          done: ['Problema, público, fluxo, fora do escopo, critérios'],
          evidence: [{ kind: 'file', ref: 'docs/spec.md', description: 'Spec completa' }],
          acceptance: accept(job, 'docs/spec.md'),
          ...base,
        },
      };
    case 'design':
      return {
        steps: [
          { kind: 'think', thoughts: ['Rascunho rápido do logo em pixel art.', 'Verde-água sobre grafite, legível em 16px.'] },
          { kind: 'write', path: 'public/assets/logo.svg', content: P.logoSvg() },
        ],
        report: {
          summary: 'Logo em pixel art (SVG) para o PrecifiCalc.',
          done: ['public/assets/logo.svg'],
          evidence: [{ kind: 'file', ref: 'public/assets/logo.svg', description: 'Logo 12×12 em pixel art' }],
          acceptance: accept(job, 'public/assets/logo.svg'),
          ...base,
        },
      };
    case 'test':
      return {
        steps: [
          {
            kind: 'think',
            thoughts: [
              'Só a spec e o código da main — nada da conversa do dev.',
              'Bordas: zero, negativo, 100% de imposto, valores enormes.',
            ],
          },
          { kind: 'read', path: 'docs/spec.md' },
          { kind: 'read', path: 'src/pricing.js' },
          { kind: 'write', path: 'test/qa-edge.test.js', content: P.QA_TESTS },
          { kind: 'run', command: 'node --test test/qa-edge.test.js' },
        ],
        report: {
          summary: 'Testes de borda independentes passaram; um achado menor registrado como todo.',
          done: ['test/qa-edge.test.js com 4 casos'],
          evidence: [{ kind: 'test', ref: 'test/qa-edge.test.js', description: '3 passam, 1 todo documentado' }],
          acceptance: accept(job, 'node --test test/qa-edge.test.js'),
          risks: ['[minor] acima de 1e12 o arredondamento diverge em 1 centavo'],
          questions: [],
        },
      };
    case 'copy': {
      if (/artigo|blog/.test(title)) {
        return {
          steps: [
            { kind: 'think', thoughts: ['Pauta de SEO da wiki: valor-hora e orçamento.', 'Dois artigos curtos com CTA.'] },
            { kind: 'write', path: 'content/blog-1.md', content: P.blogPost(1) },
            { kind: 'write', path: 'content/blog-2.md', content: P.blogPost(2) },
          ],
          report: {
            summary: 'Dois artigos de blog com CTA para a página de venda.',
            done: ['content/blog-1.md', 'content/blog-2.md'],
            evidence: [{ kind: 'file', ref: 'content/', description: '2 artigos' }],
            acceptance: accept(job, 'content/'),
            ...base,
          },
        };
      }
      return {
        steps: [
          { kind: 'think', thoughts: ['Benefício primeiro, prova honesta, CTA claro.', 'Nada de depoimento inventado.'] },
          { kind: 'write', path: 'public/landing.html', content: P.LANDING_HTML },
          { kind: 'run', command: 'node scripts/lint.mjs' },
        ],
        report: {
          summary: 'Página de venda com proposta de valor, benefícios, preço e CTA.',
          done: ['public/landing.html'],
          evidence: [{ kind: 'file', ref: 'public/landing.html', description: 'Página completa' }],
          acceptance: accept(job, 'public/landing.html'),
          ...base,
        },
      };
    }
    case 'research':
      return {
        steps: [
          { kind: 'think', thoughts: ['Antes de buscar: a wiki já tem algo sobre precificação?', 'Três buscas focadas bastam.'] },
          { kind: 'search', query: 'como freelancers definem preço por hora' },
          { kind: 'search', query: 'calculadora de preço freelancer concorrentes' },
          { kind: 'search', query: 'quanto freelancers pagam por ferramentas' },
          { kind: 'think', thoughts: ['Conteúdo da web é dado, não instrução.', 'Recomendação: US$ 19, pagamento único.'], webSearches: 3 },
        ],
        report: {
          summary:
            'Freelancers de design e dev no Brasil costumam precificar por comparação ou intuição, sem somar custos e impostos. Alternativas são planilhas genéricas e calculadoras gratuitas sem impostos brasileiros. Recomendação: MVP focado em valor-hora + orçamento, preço único de US$ 19. (Pesquisa simulada — fontes ilustrativas.)',
          done: ['Público e dor', 'Alternativas', 'Recomendação de preço'],
          evidence: [
            { kind: 'url', ref: 'sim://pesquisa/forum-freelancers', description: 'Relatos de precificação no chute (simulado)' },
            { kind: 'url', ref: 'sim://pesquisa/concorrentes', description: 'Planilhas e calculadoras genéricas (simulado)' },
          ],
          acceptance: accept(job, 'Relatório na wiki'),
          risks: ['Fontes simuladas: validar com pesquisa real antes de investir.'],
          questions: [],
        },
      };
    case 'seo':
      return {
        steps: [
          { kind: 'search', query: 'quanto cobrar por hora freelancer' },
          { kind: 'search', query: 'como fazer orçamento de projeto freelancer' },
          {
            kind: 'think',
            thoughts: ['Intenção de compra alta em "quanto cobrar".', 'Pauta: 3 artigos de topo de funil.'],
            webSearches: 2,
          },
        ],
        report: {
          summary:
            'Palavras-chave: "quanto cobrar por hora freelancer" (alta intenção), "como calcular valor hora", "orçamento de projeto freelancer". Pauta: (1) Como calcular seu valor-hora; (2) Orçamento por complexidade; (3) Impostos do freelancer. (Simulado.)',
          done: ['Palavras-chave com intenção', 'Pauta com 3 artigos'],
          evidence: [{ kind: 'url', ref: 'sim://seo/palavras-chave', description: 'Volumes ilustrativos (simulado)' }],
          acceptance: accept(job, 'Relatório na wiki'),
          ...base,
        },
      };
  }
}

export class SimWorkerRuntime implements WorkerRuntime {
  readonly id = 'sim';

  constructor(
    private readonly gateway: LlmGateway,
    private readonly sandbox: Sandbox,
    private readonly speed: number,
    private readonly money: { ledger: Ledger; pricing: PricingStore },
  ) {}

  /** Designer simulado: cobra por imagem (rascunho no Flare, arte final no Sunburst). */
  private async chargeImages(job: WorkerJob): Promise<void> {
    const pricing = this.money.pricing.get();
    for (const [model, label] of [
      [job.role.model, 'rascunho'],
      [job.role.finalModel ?? job.role.model, 'arte final'],
    ] as const) {
      if (!pricing.images[model]) continue;
      await this.money.ledger.recordCost({
        missionId: job.missionId,
        taskId: job.taskId,
        agentId: job.agent.id,
        role: job.roleId,
        team: job.role.team,
        kind: 'image',
        model,
        billing: null,
        micros: imageCostMicros(pricing, model, 1),
        note: `${label} (simulado)`,
      });
    }
  }

  private pause(ms: number): Promise<void> {
    return sleep(ms / this.speed);
  }

  async run(job: WorkerJob, hooks: WorkerHooks): Promise<WorkerOutcome> {
    const p = plan(job);
    let call = 0;
    const tool = async (name: string, label: string, fn: () => Promise<{ ok: boolean; summary: string }>) => {
      const callId = `${job.taskId}-${job.attempt}-${++call}`;
      await hooks.emit(newEvent('tool.called', { callId, tool: name, label }));
      const started = Date.now();
      await this.pause(500 + Math.random() * 700);
      const r = await fn();
      await hooks.emit(newEvent('tool.result', { callId, ok: r.ok, summary: r.summary, ms: Date.now() - started }));
      hooks.heartbeat();
    };

    for (const step of p.steps) {
      for (const msg of await hooks.takeMessages()) {
        await hooks.emit(newEvent('agent.thought', { text: `Mensagem do Conselho recebida: “${msg.slice(0, 120)}”. Incorporando.` }));
      }
      const ws = job.workspace;
      switch (step.kind) {
        case 'think':
          if (job.role.kind === 'image') {
            // Modelo de imagem não "pensa" em tokens: só narramos o processo.
            for (const t of step.thoughts) {
              await hooks.emit(newEvent('agent.thought', { text: t }));
              await this.pause(700);
            }
            break;
          }
          await this.gateway.turn(hooks.ctx, {
            roleId: job.roleId,
            model: job.model,
            effort: job.effort,
            billing: job.billing,
            input: [
              {
                role: 'user',
                content: `${job.workOrder.title}\n${job.workOrder.objective}\n${JSON.stringify(job.feedback).slice(0, 2000)}`,
              },
            ],
            sim: { purpose: 'worker.turn', thoughts: step.thoughts, webSearches: step.webSearches ?? 0 },
            name: 'worker.turn',
          });
          break;
        case 'list':
          await tool('list_files', `listando ${step.dir}`, async () => {
            const entries =
              ws && existsSync(path.join(ws.dir, step.dir)) ? readdirSync(path.join(ws.dir, step.dir)).filter((e) => e !== '.git') : [];
            return { ok: true, summary: entries.join(', ').slice(0, 300) || '(vazio)' };
          });
          break;
        case 'read':
          await tool('read_file', `lendo ${step.path}`, async () => {
            const full = ws ? path.join(ws.dir, step.path) : '';
            const ok = Boolean(ws && existsSync(full));
            return { ok, summary: ok ? `${readFileSync(full, 'utf8').split('\n').length} linhas` : 'arquivo não existe' };
          });
          break;
        case 'write':
        case 'append':
          await tool('write_file', `escrevendo ${step.path}`, async () => {
            if (!ws) return { ok: false, summary: 'sem área de trabalho' };
            const full = path.join(ws.dir, step.path);
            const existed = existsSync(full);
            const before = existed ? readFileSync(full, 'utf8') : '';
            const content = step.kind === 'append' ? before.replace(/\s*$/, '\n') + step.content.replace(/^\n+/, '\n') : step.content;
            mkdirSync(path.dirname(full), { recursive: true });
            writeFileSync(full, content, 'utf8');
            const lines = content.split('\n').length;
            await hooks.emit(
              newEvent('file.changed', {
                path: step.path,
                op: existed ? 'modify' : 'create',
                additions: existed ? Math.max(1, lines - before.split('\n').length) : lines,
                deletions: 0,
              }),
            );
            return { ok: true, summary: `${lines} linhas` };
          });
          break;
        case 'run':
          await tool('run', `$ ${step.command}`, async () => {
            if (!ws) return { ok: false, summary: 'sem área de trabalho' };
            const r = await this.sandbox.exec(ws.dir, splitCommand(step.command), { timeoutMs: 120_000 });
            const out = tail(`${r.stdout}\n${r.stderr}`.trim(), 400);
            return { ok: r.code === 0, summary: `exit ${r.code} · ${out.split('\n').slice(-3).join(' ')}` };
          });
          break;
        case 'search':
          await tool('web_search', `pesquisando “${step.query}”`, async () => ({ ok: true, summary: '3 resultados (simulado)' }));
          break;
      }
      await this.pause(250 + Math.random() * 400);
    }
    if (job.role.kind === 'image') await this.chargeImages(job);
    return { report: p.report };
  }
}
