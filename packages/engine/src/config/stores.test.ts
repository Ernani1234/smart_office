import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RolesStore } from './stores';

// A interface edita o roles.yaml no lugar: o diff no git mostra só o que mudou.

const SRC = path.resolve(import.meta.dirname, '../../../../config/roles.yaml');
const dir = mkdtempSync(path.join(tmpdir(), 'pixel-roles-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MODELS = new Set(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']);
const IMAGES = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);

describe('roles.yaml', () => {
  it('troca de valores mexe só nas linhas alteradas e mantém comentários', () => {
    copyFileSync(SRC, path.join(dir, 'roles.yaml'));
    const before = readFileSync(path.join(dir, 'roles.yaml'), 'utf8').split('\n');
    const store = new RolesStore(dir);
    const changes = store.update(
      { roles: { dev: { model: 'gpt-6.1-sol', taskBudgetUsd: 0.5 } }, rules: { maxReviewRounds: 4 } },
      MODELS,
      IMAGES,
    );
    expect(changes).toHaveLength(3);

    const after = readFileSync(path.join(dir, 'roles.yaml'), 'utf8').split('\n');
    expect(after).toHaveLength(before.length);
    const diff = after.filter((l, i) => l !== before[i]);
    expect(diff).toHaveLength(3);
    expect(diff.join('\n')).toMatch(/model: gpt-6\.1-sol\s+# promovido/);
    expect(diff.join('\n')).toMatch(/maxReviewRounds: 4\s+# idas e voltas/);
    expect(store.get().roles.dev.model).toBe('gpt-6.1-sol');
  });

  it('modelo sem preço é recusado sem tocar no arquivo', () => {
    copyFileSync(SRC, path.join(dir, 'roles.yaml'));
    const before = readFileSync(path.join(dir, 'roles.yaml'), 'utf8');
    const store = new RolesStore(dir);
    expect(() => store.update({ roles: { dev: { model: 'gpt-inexistente' } } }, MODELS, IMAGES)).toThrow(/sem preço/);
    expect(readFileSync(path.join(dir, 'roles.yaml'), 'utf8')).toBe(before);
  });
});
