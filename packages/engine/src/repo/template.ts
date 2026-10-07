// Esqueleto do repositório de cada missão. O CI usa só o Node (sem npm install,
// sem rede): sintaxe, lint, testes e varredura de segredos. O mesmo ci.json roda
// localmente (por código) e no GitHub Actions (scripts/ci.mjs).

export function templateFiles(product: { name: string; missionTitle: string }): Record<string, string> {
  return {
    'package.json': `${JSON.stringify(
      {
        name: product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { test: 'node --test', ci: 'node scripts/ci.mjs' },
        engines: { node: '>=22' },
      },
      null,
      2,
    )}\n`,

    'ci.json': `${JSON.stringify(
      {
        checks: [
          { name: 'sintaxe', run: ['node', 'scripts/check-syntax.mjs'] },
          { name: 'lint', run: ['node', 'scripts/lint.mjs'] },
          { name: 'testes', run: ['node', '--test'] },
          { name: 'segurança', run: ['node', 'scripts/secret-scan.mjs'] },
        ],
      },
      null,
      2,
    )}\n`,

    'README.md': `# ${product.name}\n\nProduto da missão “${product.missionTitle}”, construído pela Pixel Corp.\n\n- \`node --test\` roda os testes\n- \`node scripts/ci.mjs\` roda todos os portões do CI (ci.json)\n`,

    '.gitignore': 'node_modules/\n.DS_Store\n*.log\n',

    'scripts/walk.mjs': `import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist']);

export function walk(dir, exts) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (!exts || exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}
`,

    'scripts/check-syntax.mjs': `import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { walk } from './walk.mjs';

// node --check em paralelo (um processo por arquivo, alguns de cada vez)
const files = ['src', 'scripts', 'test', 'public'].flatMap((d) => walk(d, ['.js', '.mjs']));
const check = (file) =>
  new Promise((resolve) => execFile(process.execPath, ['--check', file], (err, _out, stderr) => resolve({ file, ok: !err, stderr })));
const results = [];
const queue = [...files];
const workers = Array.from({ length: Math.min(4, availableParallelism()) }, async () => {
  while (queue.length) results.push(await check(queue.shift()));
});
await Promise.all(workers);
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.error(\`✗ \${r.file}\\n\${r.stderr}\`);
console.log(\`sintaxe: \${files.length - failed.length}/\${files.length} arquivos ok\`);
process.exit(failed.length ? 1 : 0);
`,

    'scripts/lint.mjs': `import { readFileSync } from 'node:fs';
import { walk } from './walk.mjs';

const files = ['src', 'scripts', 'test', 'public'].flatMap((d) => walk(d, ['.js', '.mjs', '.html', '.css']));
// Montado por partes para o próprio lint não se acusar.
const FORGOTTEN = new RegExp('\\\\b' + 'debug' + 'ger\\\\b');
const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\\n');
  if (text.length && !text.endsWith('\\n')) problems.push(\`\${file}: sem quebra de linha no fim\`);
  lines.forEach((line, i) => {
    const at = \`\${file}:\${i + 1}\`;
    if (/[ \\t]+$/.test(line)) problems.push(\`\${at}: espaço sobrando no fim da linha\`);
    if (line.length > 160) problems.push(\`\${at}: linha com \${line.length} caracteres (máx. 160)\`);
    if (FORGOTTEN.test(line)) problems.push(\`\${at}: ponto de parada esquecido\`);
    if (file.replaceAll('\\\\', '/').startsWith('src/') && /console\\.log\\(/.test(line)) problems.push(\`\${at}: console.log no código de produção\`);
  });
}
for (const p of problems) console.error('✗', p);
console.log(\`lint: \${files.length} arquivos, \${problems.length} problema(s)\`);
process.exit(problems.length ? 1 : 0);
`,

    'scripts/secret-scan.mjs': `import { readFileSync } from 'node:fs';
import { walk } from './walk.mjs';

const PATTERNS = [
  ['chave OpenAI', /sk-(proj-)?[A-Za-z0-9_-]{20,}/],
  ['chave AWS', /AKIA[0-9A-Z]{16}/],
  ['token GitHub', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['chave privada', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['segredo Stripe', /sk_live_[A-Za-z0-9]{16,}/],
];
const files = walk('.', null).filter((f) => !/\\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(f));
const hits = [];
for (const file of files) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (file.replaceAll('\\\\', '/').endsWith('scripts/secret-scan.mjs')) continue;
  for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(\`\${file}: possível \${label}\`);
}
for (const h of hits) console.error('✗', h);
console.log(\`segurança: \${files.length} arquivos varridos, \${hits.length} achado(s)\`);
process.exit(hits.length ? 1 : 0);
`,

    'scripts/ci.mjs': `import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { checks } = JSON.parse(readFileSync('ci.json', 'utf8'));
let failed = 0;
for (const check of checks) {
  const [cmd, ...args] = check.run;
  const started = Date.now();
  const r = spawnSync(cmd === 'node' ? process.execPath : cmd, args, { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(\`\${ok ? '✓' : '✗'} \${check.name} (\${Date.now() - started} ms)\`);
}
process.exit(failed ? 1 : 0);
`,
  };
}
