import type {
  Arbitration,
  CeoDirective,
  CeoOrder,
  LeadPlan,
  PlannedTask,
  Respec,
  ReviewVerdict,
  TeamReportOut,
  WikiPageOut,
} from '@office/contracts';
import { formatUsd } from '@office/contracts';

// Roteiro do modo simulação. A empresa inteira roda pelos mesmos workflows,
// atividades, livro-caixa e CI — só a "cabeça" dos agentes vem daqui. O produto
// simulado é o PrecifiCalc: uma calculadora de preço para freelancers.

export const SIM_PRODUCT = {
  name: 'PrecifiCalc',
  tagline: 'Descubra quanto cobrar por hora e por projeto em 30 segundos.',
  priceUsd: 19,
};

type Hint = Record<string, unknown>;
const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// ---------------------------------------------------------------- pensamentos

export function thoughtsFor(purpose: string, h: Hint): string[] {
  switch (purpose) {
    case 'worker.turn':
      return arr<string>(h.thoughts);
    case 'ceo.decide': {
      const launched = Boolean(h.launched);
      const net = n(h.netUsd);
      const goal = n(h.goalUsd, 100);
      const left = n(h.budgetLeftUsd);
      return [
        `Lendo os relatórios condensados dos líderes (gatilho: ${s(h.trigger, 'início')}).`,
        `Lucro líquido ${formatUsd(net)} de ${formatUsd(goal)}; sobram ${formatUsd(left)} de teto.`,
        launched
          ? 'Produto no ar: só gasto mais com evidência de retorno.'
          : 'Ainda sem produto no ar: prioridade é MVP testado e página de venda.',
        'Definindo ordens com critérios verificáveis e orçamento por time.',
      ];
    }
    case 'lead.plan':
      return [
        `Quebrando a ordem do CEO em tarefas pequenas para ${s(h.team)}.`,
        'Cada tarefa precisa de um critério de aceite que o CI ou um teste comprove.',
        'Somando orçamentos para ficar abaixo do teto da ordem.',
      ];
    case 'lead.review':
      return [
        'Abrindo o diff e o resultado do CI antes de ler o relatório.',
        n(h.round) <= 1 && s(h.title).toLowerCase().includes('núcleo')
          ? 'Testes cobrem o caminho feliz, mas falta validar entrada negativa ou zero.'
          : 'Critérios de aceite comprovados pelas evidências.',
        'Aplicando a rubrica: correção, testes, clareza, riscos.',
      ];
    case 'lead.report':
      return ['Condensando o ciclo para o CEO — ele não lê código.', 'Listando entregas com referência ao artefato.'];
    case 'lead.respec':
      return ['A tarefa travou mesmo no modelo maior: o problema é a especificação.', 'Cortando escopo e deixando o critério explícito.'];
    case 'ceo.arbitrate':
      return ['Tarefa escalada. Vale aceitar como está ou cortar?'];
    case 'finance.report':
      return ['Números já vieram do livro-caixa; só redijo.'];
    case 'postmortem':
      return ['Juntando a linha do tempo da missão para o post-mortem.'];
    default:
      return ['Pensando…'];
  }
}

// ---------------------------------------------------------------- CEO

const ORDER_TEMPLATES: Record<string, Omit<CeoOrder, 'budgetUsd'>> = {
  produto: {
    team: 'produto',
    title: 'Validar o nicho e especificar o MVP',
    objective: 'Confirmar que freelancers sofrem para precificar e definir o MVP mínimo do PrecifiCalc.',
    context: 'Público: freelancers de design e desenvolvimento no Brasil. Hipótese: pagam US$ 19 por uma calculadora confiável.',
    acceptanceCriteria: [
      'Pesquisa com público, dor, concorrentes e preço na wiki',
      'docs/spec.md com fluxo principal e critérios testáveis',
    ],
    dependsOn: [],
  },
  engenharia: {
    team: 'engenharia',
    title: 'Construir o MVP do PrecifiCalc',
    objective: 'Calculadora de valor-hora e orçamento de projeto, com testes e CI verde.',
    context: 'Seguir docs/spec.md. Sem dependências externas. Node 22, ES modules.',
    acceptanceCriteria: ['src/pricing.js exporta hourlyRate e projectQuote', 'node --test passa', 'public/index.html usa o núcleo'],
    dependsOn: ['produto'],
  },
  qa: {
    team: 'qa',
    title: 'Testar o MVP de forma independente',
    objective: 'Exercitar critérios de aceite e casos de borda sem ler a conversa do dev.',
    context: 'Use apenas a spec e o código integrado na main.',
    acceptanceCriteria: ['test/qa-edge.test.js cobre entradas inválidas e limites', 'Achados listados com severidade'],
    dependsOn: ['engenharia'],
  },
  growth: {
    team: 'growth',
    title: 'Página de venda e SEO',
    objective: 'Página de venda clara e pauta de SEO para o lançamento.',
    context: 'Preço US$ 19, pagamento único. Sem depoimentos inventados.',
    acceptanceCriteria: ['public/landing.html com proposta de valor e CTA', 'Palavras-chave e pauta na wiki'],
    dependsOn: ['produto'],
  },
};

const BUDGETS: Record<string, number> = { produto: 0.6, engenharia: 1.6, qa: 0.5, growth: 0.4 };

function order(team: string, override: Partial<CeoOrder> = {}): CeoOrder {
  return { ...ORDER_TEMPLATES[team], budgetUsd: BUDGETS[team] ?? 0.5, ...override } as CeoOrder;
}

export function ceoDecide(h: Hint): CeoDirective {
  const teams = new Set(arr<string>(h.teams));
  const trigger = s(h.trigger, 'start');
  const launched = Boolean(h.launched);
  const lastApproval = s(h.lastApproval);
  const growthBoosts = n(h.growthBoosts);
  const has = (t: string) => teams.has(t);

  if (!launched && trigger === 'start') {
    const orders = ['produto', 'engenharia', 'growth', 'qa'].filter(has).map((t) => order(t));
    return {
      decision: 'delegate',
      summary: 'Vamos validar o nicho de precificação para freelancers e lançar um MVP enxuto.',
      rationale:
        'Hipótese barata de testar: dor clara, produto pequeno, preço único de US$ 19. Ordem: pesquisa e spec, depois MVP e página, depois QA independente.',
      orders,
      approvals: [],
    };
  }
  if (!launched && lastApproval === 'rejected') {
    return {
      decision: 'delegate',
      summary: 'O Conselho pediu ajustes. Growth refina a página antes de pedirmos de novo.',
      rationale: 'Rejeição é sinal: corrigir o que foi apontado e voltar com evidência.',
      orders: has('growth')
        ? [
            order('growth', {
              title: 'Ajustar a página de venda',
              objective: 'Incorporar o feedback do Conselho na página.',
              dependsOn: [],
            }),
          ]
        : [],
      approvals: [],
    };
  }
  if (!launched) {
    return {
      decision: 'request_approval',
      summary: 'MVP aprovado pelo QA e página pronta. Peço ao Conselho para lançar.',
      rationale: 'Critérios cumpridos com evidência (CI verde, revisão aprovada, testes de borda). Lançar é irreversível.',
      orders: [],
      approvals: [
        {
          kind: 'deploy',
          title: 'Deploy do PrecifiCalc em produção',
          justification: 'CI verde na main, revisão aprovada e QA sem bloqueadores.',
          amountUsd: null,
        },
        {
          kind: 'publish',
          title: `Publicar a página de venda e abrir o checkout a ${formatUsd(SIM_PRODUCT.priceUsd)}`,
          justification: 'Página revisada pelo Growth Lead, sem promessas falsas.',
          amountUsd: null,
        },
      ],
    };
  }
  if ((trigger.startsWith('milestone') || trigger === 'stagnation') && has('growth') && growthBoosts < 2) {
    return {
      decision: 'delegate',
      summary:
        trigger === 'stagnation'
          ? 'Vendas pararam. Growth produz conteúdo de SEO para trazer tráfego qualificado.'
          : 'Primeiras vendas confirmam a hipótese. Investir pouco em conteúdo para acelerar.',
      rationale: 'Conteúdo custa centavos (Luna em flex) e compõe tráfego orgânico. Retorno medido pelo Financeiro.',
      orders: [
        order('growth', {
          title: 'Dois artigos de blog com as palavras-chave da pauta',
          objective: 'Publicar conteúdo útil que leve freelancers ao PrecifiCalc.',
          acceptanceCriteria: ['content/ com 2 artigos em Markdown', 'Cada artigo com CTA para a página de venda'],
          budgetUsd: 0.2,
          dependsOn: [],
        }),
      ],
      approvals: [],
    };
  }
  return {
    decision: 'wait',
    summary: launched ? 'Produto no ar. Agora esperamos sinais de venda — sem gastar à toa.' : 'Aguardando decisões pendentes.',
    rationale: 'Sem decisão nova a tomar; o Financeiro acompanha a receita por código.',
    orders: [],
    approvals: [],
  };
}

export function ceoArbitrate(): Arbitration {
  return { decision: 'accept', rationale: 'Entrega suficiente para o MVP; o risco fica registrado no relatório.' };
}

// ---------------------------------------------------------------- líderes

const TASKS: Record<string, PlannedTask[]> = {
  produto: [
    {
      role: 'pesquisa',
      kind: 'research',
      title: 'Pesquisar dor, concorrentes e preço',
      objective: 'Mapear como freelancers definem preço hoje e quanto pagariam por uma calculadora.',
      context: 'Foque em designers e devs freelancers no Brasil. Cite fontes.',
      acceptanceCriteria: ['Público e dor descritos', 'Três alternativas com preço', 'Recomendação de preço'],
      budgetUsd: 0.12,
    },
    {
      role: 'ux',
      kind: 'spec',
      title: 'Especificar o MVP em docs/spec.md',
      objective: 'Spec de uma tela: problema, público, fluxo, fora do escopo e critérios testáveis.',
      context: 'Use a pesquisa da wiki como base.',
      acceptanceCriteria: ['docs/spec.md existe', 'Critérios de aceite testáveis listados'],
      budgetUsd: 0.12,
    },
    {
      role: 'designer',
      kind: 'design',
      title: 'Logo e identidade visual',
      objective: 'Logo simples e legível para o PrecifiCalc.',
      context: 'Estilo pixel art amigável, paleta verde-água e grafite.',
      acceptanceCriteria: ['public/assets/logo.svg criado'],
      budgetUsd: 0.15,
    },
  ],
  engenharia: [
    {
      role: 'dev',
      kind: 'build',
      title: 'Núcleo de precificação com testes',
      objective: 'Implementar hourlyRate e projectQuote em src/pricing.js com testes.',
      context: 'Valor-hora = (renda desejada + custos) / horas faturáveis, acrescido de impostos. Arredondar para 2 casas.',
      acceptanceCriteria: ['hourlyRate considera impostos', 'projectQuote aplica complexidade', 'node --test passa'],
      budgetUsd: 0.4,
    },
    {
      role: 'dev',
      kind: 'build',
      title: 'Interface web da calculadora',
      objective: 'public/index.html com formulário que usa o núcleo.',
      context: 'HTML + JS puro, acessível, sem dependências.',
      acceptanceCriteria: ['Formulário com renda, custos, horas e impostos', 'Resultado formatado em BRL'],
      budgetUsd: 0.3,
    },
    {
      role: 'devops',
      kind: 'devops',
      title: 'CI no GitHub Actions e Dockerfile',
      objective: 'Rodar os mesmos portões do CI local no GitHub e empacotar o app.',
      context: 'Node 22. O CI local lê ci.json.',
      acceptanceCriteria: ['.github/workflows/ci.yml roda scripts/ci.mjs', 'Dockerfile serve public/'],
      budgetUsd: 0.2,
    },
  ],
  qa: [
    {
      role: 'testador',
      kind: 'test',
      title: 'Testes de borda independentes',
      objective: 'Testar entradas inválidas, limites e arredondamento sem ler a conversa do dev.',
      context: 'Base: docs/spec.md e o código na main.',
      acceptanceCriteria: ['test/qa-edge.test.js criado', 'Achados com severidade no relatório'],
      budgetUsd: 0.2,
    },
  ],
  growth: [
    {
      role: 'copy',
      kind: 'copy',
      title: 'Página de venda (public/landing.html)',
      objective: 'Página com proposta de valor, como funciona, preço e CTA.',
      context: 'US$ 19, pagamento único. Sem depoimentos inventados.',
      acceptanceCriteria: ['public/landing.html criado', 'CTA claro para o checkout'],
      budgetUsd: 0.08,
    },
    {
      role: 'seo',
      kind: 'seo',
      title: 'Palavras-chave e pauta de conteúdo',
      objective: 'Levantar palavras-chave com intenção de compra e uma pauta de artigos.',
      context: 'Mercado brasileiro de freelancers.',
      acceptanceCriteria: ['Lista de palavras-chave com intenção', 'Pauta com 3 artigos'],
      budgetUsd: 0.08,
    },
  ],
};

export function leadPlan(h: Hint): LeadPlan {
  const team = s(h.team);
  const available = new Set(arr<string>(h.workerRoles));
  const title = s(h.orderTitle);
  let tasks = (TASKS[team] ?? []).filter((t) => available.has(t.role));
  if (team === 'growth' && /artigo|blog|conte/i.test(title)) {
    tasks = available.has('copy')
      ? [
          {
            role: 'copy',
            kind: 'copy',
            title: 'Dois artigos de blog para SEO',
            objective: 'Escrever 2 artigos úteis com CTA para o PrecifiCalc.',
            context: 'Use a pauta de SEO da wiki.',
            acceptanceCriteria: ['content/ com 2 artigos', 'CTA em cada artigo'],
            budgetUsd: 0.08,
          },
        ]
      : [];
  }
  if (team === 'growth' && /ajustar/i.test(title)) {
    tasks = tasks.filter((t) => t.role === 'copy');
  }
  return {
    summary: `${tasks.length} tarefa(s) para cumprir “${title}”, cada uma com critério verificável.`,
    tasks,
  };
}

export function leadReview(h: Hint): ReviewVerdict {
  const title = s(h.title).toLowerCase();
  const round = n(h.round, 1);
  const kind = s(h.kind);
  if (title.includes('núcleo') && round <= 1) {
    return {
      approved: false,
      summary: 'Lógica correta e CI verde, mas faltou validar entradas inválidas.',
      changes: [
        { item: 'Lançar RangeError para horas faturáveis ≤ 0 ou valores negativos, com teste', severity: 'major' },
        { item: 'Extrair a taxa de complexidade para uma constante nomeada', severity: 'nit' },
      ],
      rubric: [
        { criterion: 'Correção', score: 2, note: 'Cálculo bate com a spec' },
        { criterion: 'Testes', score: 1, note: 'Sem casos de borda' },
        { criterion: 'Clareza', score: 2, note: 'Funções pequenas' },
      ],
    };
  }
  const label =
    kind === 'research' || kind === 'seo' ? 'Pesquisa com fontes e recomendação clara.' : 'Critérios comprovados por evidência.';
  return {
    approved: true,
    summary: `Aprovado. ${label}`,
    changes: [],
    rubric: [
      { criterion: 'Correção', score: 3, note: 'Cumpre os critérios' },
      { criterion: 'Evidência', score: 3, note: 'CI e arquivos conferidos' },
    ],
  };
}

export function leadReport(h: Hint): TeamReportOut {
  const team = s(h.team);
  const results = arr<{ title: string; status: string; ref?: string }>(h.results);
  const done = results.filter((r) => r.status === 'done');
  const summaries: Record<string, string> = {
    produto: 'Nicho validado: freelancers definem preço no chute e aceitam pagar por uma ferramenta simples. Spec do MVP pronta.',
    engenharia: 'MVP construído: núcleo de precificação com testes, interface web e CI. CI verde na main.',
    qa: 'Testes de borda independentes passaram; um achado menor de arredondamento registrado, sem bloqueadores.',
    growth: 'Página de venda pronta e pauta de SEO na wiki.',
  };
  return {
    summary: `${summaries[team] ?? 'Ciclo concluído.'} (${done.length}/${results.length} tarefas concluídas)`,
    deliverables: done.map((r) => ({ title: r.title, ref: r.ref ?? 'main' })),
    risks: team === 'qa' ? ['Arredondamento em valores muito altos pode divergir em 1 centavo (minor).'] : [],
    questions: [],
    needsApproval: [],
  };
}

export function leadRespec(h: Hint): Respec {
  return {
    summary: 'Escopo reduzido ao essencial e critério explicitado com exemplo numérico.',
    objective: `${s(h.objective)} (versão reduzida)`,
    context: `${s(h.context)}\nExemplo: renda 8000, custos 2000, 100 horas, impostos 10% → 110,00 por hora.`,
    acceptanceCriteria: arr<string>(h.acceptanceCriteria).slice(0, 2),
  };
}

// ---------------------------------------------------------------- staff

export function financeReport(h: Hint): WikiPageOut {
  return {
    title: `Relatório financeiro — ${s(h.missionTitle)}`,
    body: [
      `## Resultado`,
      `- Receita líquida: **${formatUsd(n(h.revenueUsd))}** em ${n(h.sales)} venda(s)`,
      `- Gasto total: **${formatUsd(n(h.spentUsd))}** (teto ${formatUsd(n(h.capUsd))})`,
      `- Lucro líquido: **${formatUsd(n(h.netUsd))}** (meta ${formatUsd(n(h.goalUsd))})`,
      ``,
      `## Maiores custos`,
      ...arr<{ label: string; usd: number }>(h.topCosts).map((c) => `- ${c.label}: ${formatUsd(c.usd)}`),
      ``,
      `## Recomendação`,
      n(h.netUsd) >= n(h.goalUsd)
        ? 'Meta batida com folga no teto. Repetir o playbook com nicho adjacente antes de escalar gasto.'
        : 'Meta não batida. Rever preço e canal antes de investir mais.',
    ].join('\n'),
    tags: ['financeiro', 'relatório'],
  };
}

export function postmortem(h: Hint): WikiPageOut {
  const timeline = arr<string>(h.timeline);
  return {
    title: `Post-mortem — ${s(h.missionTitle)}`,
    body: [
      `## Desfecho`,
      `${s(h.outcome)}`,
      ``,
      `## Linha do tempo`,
      ...timeline.map((t) => `- ${t}`),
      ``,
      `## O que funcionou`,
      '- Verificação por evidência: o CI pegou dois erros antes da revisão humana.',
      '- Escada de modelos: a tarefa travada no Luna passou no Sol sem gastar Astra.',
      '',
      `## O que melhorar`,
      '- Especificação mais explícita sobre validação de entrada desde a primeira ordem.',
    ].join('\n'),
    tags: ['post-mortem'],
  };
}

const ACKS = [
  'Recebido! Vou ajustar agora mesmo.',
  'Anotado, Conselho. Prioridade máxima.',
  'Entendido — incorporo na próxima rodada.',
  'Pode deixar, já estou nisso.',
];

export function secretaryReply(h: Hint): { text: string } {
  const idx = Math.abs(Math.floor(n(h.seed))) % ACKS.length;
  return { text: ACKS[idx] };
}
