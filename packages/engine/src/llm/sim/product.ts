// Arquivos do PrecifiCalc que os agentes simulados escrevem. São código de
// verdade: o CI roda sintaxe, lint, testes e varredura sobre eles. As versões
// "Luna" do núcleo têm bugs plausíveis que o CI pega — é isso que dispara a
// escada de modelos na demonstração.

export const PRICING_BUGGY_NO_TAX = `// Núcleo de precificação do PrecifiCalc.

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Valor-hora = (renda desejada + custos) / horas faturáveis. */
export function hourlyRate({ monthlyIncome, monthlyCosts = 0, billableHours, taxRate = 0 }) {
  const base = (monthlyIncome + monthlyCosts) / billableHours;
  return round2(base);
}

export function projectQuote({ hours, rate, complexity = 'media' }) {
  const factor = { simples: 1, media: 1.3, complexa: 1.7 }[complexity] ?? 1.3;
  return round2(hours * rate * factor);
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
`;

export const PRICING_BUGGY_FLOOR = `// Núcleo de precificação do PrecifiCalc.

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Valor-hora = (renda desejada + custos) / horas faturáveis, acrescido de impostos. */
export function hourlyRate({ monthlyIncome, monthlyCosts = 0, billableHours, taxRate = 0 }) {
  const base = (monthlyIncome + monthlyCosts) / billableHours;
  return Math.floor(base * (1 + taxRate));
}

export function projectQuote({ hours, rate, complexity = 'media' }) {
  const factor = { simples: 1, media: 1.3, complexa: 1.7 }[complexity] ?? 1.3;
  return round2(hours * rate * factor);
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
`;

export const PRICING_OK = `// Núcleo de precificação do PrecifiCalc.

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Valor-hora = (renda desejada + custos) / horas faturáveis, acrescido de impostos. */
export function hourlyRate({ monthlyIncome, monthlyCosts = 0, billableHours, taxRate = 0 }) {
  const base = (monthlyIncome + monthlyCosts) / billableHours;
  return round2(base * (1 + taxRate));
}

export function projectQuote({ hours, rate, complexity = 'media' }) {
  const factor = { simples: 1, media: 1.3, complexa: 1.7 }[complexity] ?? 1.3;
  return round2(hours * rate * factor);
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
`;

export const PRICING_VALIDATED = `// Núcleo de precificação do PrecifiCalc.

/** Multiplicador de esforço por complexidade do projeto. */
export const COMPLEXITY = Object.freeze({ simples: 1, media: 1.3, complexa: 1.7 });

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function assertPositive(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(\`\${name} precisa ser um número maior que zero\`);
  }
}

function assertNonNegative(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(\`\${name} não pode ser negativo\`);
  }
}

/** Valor-hora = (renda desejada + custos) / horas faturáveis, acrescido de impostos. */
export function hourlyRate({ monthlyIncome, monthlyCosts = 0, billableHours, taxRate = 0 }) {
  assertPositive('monthlyIncome', monthlyIncome);
  assertNonNegative('monthlyCosts', monthlyCosts);
  assertPositive('billableHours', billableHours);
  if (typeof taxRate !== 'number' || taxRate < 0 || taxRate >= 1) {
    throw new RangeError('taxRate deve estar entre 0 e 1');
  }
  const base = (monthlyIncome + monthlyCosts) / billableHours;
  return round2(base * (1 + taxRate));
}

export function projectQuote({ hours, rate, complexity = 'media' }) {
  assertPositive('hours', hours);
  assertPositive('rate', rate);
  const factor = COMPLEXITY[complexity];
  if (!factor) throw new RangeError(\`complexidade desconhecida: \${complexity}\`);
  return round2(hours * rate * factor);
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
`;

export const PRICING_TESTS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, hourlyRate, projectQuote } from '../src/pricing.js';

test('valor-hora considera custos, horas e impostos', () => {
  assert.equal(hourlyRate({ monthlyIncome: 8000, monthlyCosts: 2000, billableHours: 100, taxRate: 0.1 }), 110);
});

test('valor-hora arredonda para centavos', () => {
  assert.equal(hourlyRate({ monthlyIncome: 5000, monthlyCosts: 1234, billableHours: 87, taxRate: 0.06 }), 75.95);
});

test('orçamento aplica a complexidade', () => {
  assert.equal(projectQuote({ hours: 10, rate: 100, complexity: 'complexa' }), 1700);
});

test('formata em reais', () => {
  assert.match(formatBRL(1234.5), /1\\.234,50/);
});
`;

export const PRICING_VALIDATION_TESTS = `

test('rejeita horas faturáveis zero ou valores negativos', () => {
  assert.throws(() => hourlyRate({ monthlyIncome: 1000, billableHours: 0 }), RangeError);
  assert.throws(() => hourlyRate({ monthlyIncome: -1, billableHours: 10 }), RangeError);
  assert.throws(() => projectQuote({ hours: -2, rate: 50 }), RangeError);
});
`;

export const INTERFACE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PrecifiCalc — quanto cobrar</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    form { background: #1e293b; padding: 2rem; border-radius: 1rem; width: min(420px, 92vw); display: grid; gap: .75rem; }
    label { display: grid; gap: .25rem; font-size: .9rem; }
    input, select { padding: .6rem; border-radius: .5rem; border: 1px solid #334155; background: #0f172a; color: inherit; }
    output { font-size: 1.6rem; font-weight: 700; color: #5eead4; }
  </style>
</head>
<body>
  <form id="calc">
    <h1>PrecifiCalc</h1>
    <label>Renda mensal desejada (R$) <input name="income" type="number" min="1" value="8000" required></label>
    <label>Custos mensais (R$) <input name="costs" type="number" min="0" value="2000"></label>
    <label>Horas faturáveis por mês <input name="hours" type="number" min="1" value="100" required></label>
    <label>Impostos (%) <input name="tax" type="number" min="0" max="99" value="10"></label>
    <label>Complexidade do projeto
      <select name="complexity">
        <option value="simples">Simples</option>
        <option value="media" selected>Média</option>
        <option value="complexa">Complexa</option>
      </select>
    </label>
    <label>Horas do projeto <input name="projectHours" type="number" min="1" value="40"></label>
    <p>Valor-hora: <output id="rate">—</output></p>
    <p>Orçamento do projeto: <output id="quote">—</output></p>
  </form>
  <script type="module">
    import { formatBRL, hourlyRate, projectQuote } from '../src/pricing.js';
    const form = document.getElementById('calc');
    function update() {
      const d = Object.fromEntries(new FormData(form));
      try {
        const rate = hourlyRate({
          monthlyIncome: Number(d.income),
          monthlyCosts: Number(d.costs),
          billableHours: Number(d.hours),
          taxRate: Number(d.tax) / 100,
        });
        document.getElementById('rate').textContent = formatBRL(rate);
        document.getElementById('quote').textContent = formatBRL(projectQuote({ hours: Number(d.projectHours), rate, complexity: d.complexity }));
      } catch (err) {
        document.getElementById('rate').textContent = err.message;
      }
    }
    form.addEventListener('input', update);
    update();
  </script>
</body>
</html>
`;

export const CI_WORKFLOW = `name: CI
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node scripts/ci.mjs
`;

export const DOCKERFILE = `FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["node", "scripts/serve.mjs"]
`;

export const SERVE_SCRIPT = `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css' };
const root = path.resolve('.');

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = url.pathname === '/' ? 'public/landing.html' : url.pathname.slice(1);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
}).listen(Number(process.env.PORT ?? 8080));
`;

export const SPEC_MD = `# PrecifiCalc — especificação do MVP

## Problema
Freelancers de design e desenvolvimento definem preço "no chute" e trabalham por menos do que precisam.

## Público
Freelancers brasileiros em início de carreira (1 a 5 anos), que vendem por hora ou por projeto.

## Proposta de valor
Em 30 segundos, saber o valor-hora mínimo e o orçamento de um projeto, com impostos e custos incluídos.

## Fluxo principal
1. Informar renda mensal desejada, custos fixos, horas faturáveis e alíquota de impostos.
2. Ver o valor-hora.
3. Informar horas e complexidade do projeto e ver o orçamento.

## Fora do MVP
Contas de usuário, histórico, exportar PDF, múltiplas moedas.

## Critérios de aceite
- Valor-hora = (renda + custos) / horas × (1 + impostos), arredondado em centavos.
- Complexidade: simples ×1, média ×1,3, complexa ×1,7.
- Entradas inválidas (zero, negativas) geram erro claro.
`;

export const QA_TESTS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourlyRate, projectQuote } from '../src/pricing.js';

test('QA: complexidade desconhecida é rejeitada', () => {
  assert.throws(() => projectQuote({ hours: 1, rate: 10, complexity: 'epica' }), RangeError);
});

test('QA: impostos de 100% ou mais são rejeitados', () => {
  assert.throws(() => hourlyRate({ monthlyIncome: 1000, billableHours: 10, taxRate: 1 }), RangeError);
});

test('QA: custos zero são aceitos', () => {
  assert.equal(hourlyRate({ monthlyIncome: 1000, monthlyCosts: 0, billableHours: 10 }), 100);
});

test('QA: valores enormes mantêm os centavos', { todo: 'acima de 1e12 o arredondamento diverge em 1 centavo (minor)' }, () => {
  assert.equal(hourlyRate({ monthlyIncome: 1e12 + 0.07, billableHours: 1 }), 1e12 + 0.07);
});
`;

export const LANDING_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PrecifiCalc — pare de cobrar no chute</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0b1020; color: #e2e8f0; }
    main { max-width: 760px; margin: 0 auto; padding: 4rem 1.5rem; }
    h1 { font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.1; }
    .cta { display: inline-block; background: #5eead4; color: #0b1020; padding: 1rem 1.6rem; border-radius: .8rem; font-weight: 800; text-decoration: none; }
    li { margin: .4rem 0; }
  </style>
</head>
<body>
  <main>
    <img src="assets/logo.svg" alt="PrecifiCalc" width="72" height="72">
    <h1>Descubra quanto cobrar por hora e por projeto em 30 segundos.</h1>
    <p>O PrecifiCalc soma sua renda desejada, seus custos e seus impostos e devolve o valor-hora mínimo para você não trabalhar no prejuízo.</p>
    <ul>
      <li>Valor-hora com impostos e custos incluídos</li>
      <li>Orçamento de projeto por complexidade</li>
      <li>Funciona no navegador, sem cadastro</li>
    </ul>
    <p><strong>US$ 19</strong>, pagamento único.</p>
    <a class="cta" href="#checkout">Quero cobrar o preço certo</a>
  </main>
</body>
</html>
`;

export function blogPost(n: number): string {
  const titles = ['Como calcular seu valor-hora como freelancer', 'Orçamento de projeto: hora × complexidade'];
  return `# ${titles[n - 1] ?? `Artigo ${n}`}

Freelancer que cobra no chute paga a conta no fim do mês. Neste artigo mostramos, passo a passo, como somar renda desejada,
custos fixos e impostos para chegar a um preço que se sustenta.

1. Defina a renda mensal que você quer levar para casa.
2. Some os custos fixos do seu trabalho.
3. Divida pelas horas que você realmente consegue faturar.
4. Acrescente os impostos.

Quer fazer a conta em 30 segundos? Use o [PrecifiCalc](../public/landing.html).
`;
}

/** Logo em pixel art, desenhado como SVG de retângulos. */
export function logoSvg(): string {
  const grid = [
    '..XXXXXXXX..',
    '.XooooooooX.',
    'XooXXXXXXooX',
    'XooXccccXooX',
    'XooXccccXooX',
    'XooXXXXXXooX',
    'XooooooooooX',
    'XooXoXoXooX.',
    'XooooooooooX',
    'XooXoXoXooX.',
    '.XooooooooX.',
    '..XXXXXXXX..',
  ];
  const colors: Record<string, string> = { X: '#1f2937', o: '#5eead4', c: '#0f766e' };
  const rects: string[] = [];
  grid.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (colors[ch]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[ch]}"/>`);
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">\n${rects.join('\n')}\n</svg>\n`;
}
