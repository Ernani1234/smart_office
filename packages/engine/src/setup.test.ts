import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { keyLooksValid, maskKey, normalizeKey, parseEnvText, readLocalEnv, resolveProvider, writeLocalKey } from './setup';

// Gastar é escolha explícita: chave solta no ambiente global não liga o modo
// real; a chave da tela inicial liga; LLM_PROVIDER=sim sempre vence (testes/CI).

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const dir = mkdtempSync(path.join(tmpdir(), 'pixel-setup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('quem decide o modo', () => {
  it('nada configurado → simulação pedindo a chave, mesmo com OPENAI_API_KEY global', () => {
    const c = resolveProvider({ explicit: '', localKey: '', envKey: KEY });
    expect(c).toMatchObject({ provider: 'sim', setupRequired: true, apiKey: '', keySource: null, explicit: false });
  });

  it('chave salva pela tela inicial → modo real', () => {
    const c = resolveProvider({ explicit: '', localKey: KEY, envKey: '' });
    expect(c).toMatchObject({ provider: 'openai', apiKey: KEY, keySource: 'ui', setupRequired: false });
  });

  it('LLM_PROVIDER=sim vence a chave salva', () => {
    const c = resolveProvider({ explicit: 'sim', localKey: KEY, envKey: KEY });
    expect(c).toMatchObject({ provider: 'sim', setupRequired: false, explicit: true });
  });

  it('LLM_PROVIDER=openai usa a chave da tela inicial antes da do ambiente', () => {
    expect(resolveProvider({ explicit: 'openai', localKey: KEY, envKey: 'sk-env-key-0000000000000000' })).toMatchObject({
      apiKey: KEY,
      keySource: 'ui',
    });
    expect(resolveProvider({ explicit: 'OpenAI', localKey: '', envKey: KEY })).toMatchObject({ apiKey: KEY, keySource: 'env' });
  });

  it('LLM_PROVIDER=openai sem chave e valores inválidos falham na partida', () => {
    expect(() => resolveProvider({ explicit: 'openai', localKey: '', envKey: '' })).toThrow(/OPENAI_API_KEY/);
    expect(() => resolveProvider({ explicit: 'anthropic', localKey: '', envKey: '' })).toThrow(/inválido/);
  });
});

describe('.env.local', () => {
  it('grava, troca e remove a chave preservando o resto do arquivo', () => {
    const file = path.join(dir, '.env.local');
    writeFileSync(file, '# minhas coisas\nSIM_SPEED=2\nOPENAI_API_KEY=sk-velha-000000000000000000\n');
    writeLocalKey(file, KEY);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('SIM_SPEED=2');
    expect(text.match(/OPENAI_API_KEY=/g)).toHaveLength(1);
    expect(readLocalEnv(file)).toMatchObject({ SIM_SPEED: '2', OPENAI_API_KEY: KEY });

    writeLocalKey(file, null);
    expect(readLocalEnv(file)).toEqual({ SIM_SPEED: '2' });
  });

  it('apaga o arquivo quando só sobraria comentário', () => {
    const file = path.join(dir, 'so-chave.env');
    writeLocalKey(file, KEY);
    expect(readLocalEnv(file).OPENAI_API_KEY).toBe(KEY);
    writeLocalKey(file, null);
    expect(existsSync(file)).toBe(false);
  });

  it('lê aspas, export e comentários no fim da linha', () => {
    expect(parseEnvText('export A="1 2"\nB=\'x\'\nC=3 # nota\n# D=4\nlixo')).toEqual({ A: '1 2', B: 'x', C: '3' });
  });
});

describe('chave colada', () => {
  it('aceita o jeito que a pessoa copiou', () => {
    expect(normalizeKey(`  ${KEY}\n`)).toBe(KEY);
    expect(normalizeKey(`OPENAI_API_KEY="${KEY}"`)).toBe(KEY);
    expect(normalizeKey(`export OPENAI_API_KEY='${KEY}'`)).toBe(KEY);
  });

  it('formato e máscara', () => {
    expect(keyLooksValid(KEY)).toBe(true);
    expect(keyLooksValid('sk-curta')).toBe(false);
    expect(keyLooksValid('sk-com espaço-000000000000000')).toBe(false);
    expect(maskKey(KEY)).toBe('sk-proj-…0123');
    expect(maskKey('sk-abcdefghijklmnopqrst9876')).toBe('sk-…9876');
    expect(maskKey(KEY)).not.toContain('abcdefgh');
  });
});
