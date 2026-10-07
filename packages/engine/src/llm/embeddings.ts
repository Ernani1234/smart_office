import type { Embedder } from './types';

// Embedding determinístico por hashing de termos (sem chave, sem custo). Bom o
// bastante para a busca semântica da wiki no modo simulação: textos com
// palavras em comum ficam próximos no cosseno.

function fnv(s: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

export class HashEmbedder implements Embedder {
  readonly id = 'hash';
  constructor(readonly dim: number) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dim).fill(0);
      const tokens = tokenize(text);
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        v[fnv(t, 1) % this.dim] += fnv(t, 2) % 2 === 0 ? 1 : -1;
        if (i + 1 < tokens.length) {
          const bigram = `${t}_${tokens[i + 1]}`;
          v[fnv(bigram, 3) % this.dim] += 0.5;
        }
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
