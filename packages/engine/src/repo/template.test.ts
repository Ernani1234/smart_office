import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as P from '../llm/sim/product';
import { LocalSandbox } from '../sandbox/exec';
import { CiRunner } from './ci';
import { templateFiles } from './template';

// O CI do repositório de cada missão roda só com Node. Este teste garante que o
// esqueleto passa limpo e que o roteiro da simulação se comporta como prometido:
// os bugs "do Luna" quebram os testes, a versão "do Sol" passa.

const dirs: string[] = [];
function repo(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pixel-ci-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries({ ...templateFiles({ name: 'PrecifiCalc', missionTitle: 'teste' }), ...extra })) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ci = new CiRunner(new LocalSandbox());
const failed = async (dir: string) => (await ci.run(dir)).checks.filter((c) => !c.ok).map((c) => c.name);

describe('CI do repositório da missão', () => {
  it('esqueleto passa em todos os portões', async () => {
    expect(await failed(repo())).toEqual([]);
  }, 60_000);

  it('Luna tentativa 1 (sem imposto, depois floor) quebra os testes', async () => {
    expect(await failed(repo({ 'src/pricing.js': P.PRICING_BUGGY_FLOOR, 'test/pricing.test.js': P.PRICING_TESTS }))).toEqual(['testes']);
  }, 60_000);

  it('Luna tentativa 2 (arredonda antes do imposto) ainda quebra', async () => {
    const buggy = P.PRICING_OK.replace('return round2(base * (1 + taxRate));', 'return round2(base) * (1 + taxRate);');
    expect(buggy).not.toBe(P.PRICING_OK);
    expect(await failed(repo({ 'src/pricing.js': buggy, 'test/pricing.test.js': P.PRICING_TESTS }))).toEqual(['testes']);
  }, 60_000);

  it('Sol corrige; validação + QA + páginas passam em tudo', async () => {
    expect(await failed(repo({ 'src/pricing.js': P.PRICING_OK, 'test/pricing.test.js': P.PRICING_TESTS }))).toEqual([]);
    const full = repo({
      'src/pricing.js': P.PRICING_VALIDATED,
      'test/pricing.test.js': P.PRICING_TESTS.replace(/\s*$/, '\n') + P.PRICING_VALIDATION_TESTS.replace(/^\n+/, '\n'),
      'test/qa-edge.test.js': P.QA_TESTS,
      'public/index.html': P.INTERFACE_HTML,
      'public/landing.html': P.LANDING_HTML,
      'public/assets/logo.svg': P.logoSvg(),
      '.github/workflows/ci.yml': P.CI_WORKFLOW,
      Dockerfile: P.DOCKERFILE,
      'scripts/serve.mjs': P.SERVE_SCRIPT,
      'docs/spec.md': P.SPEC_MD,
      'content/blog-1.md': P.blogPost(1),
    });
    expect(await failed(full)).toEqual([]);
  }, 90_000);

  it('varredura de segurança pega chave vazada', async () => {
    const leaked = repo({ 'src/config.js': `export const KEY = 'sk-proj-${'a'.repeat(32)}';\n` });
    expect(await failed(leaked)).toContain('segurança');
  }, 60_000);
});
