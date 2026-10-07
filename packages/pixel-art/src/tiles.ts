import { darken, Img, lighten, mix } from './raster';
import { INK, PALETTE as P } from './palette';

// Tiles 16×16 do escritório (visão de cima em 3/4): pisos por material com
// variações, topo de parede com auto-tile por vizinhança e face de parede com
// rodapé. Tudo determinístico para o tileset sair igual a cada geração.

export const TILE = 16;

export type Material =
  'wood' | 'woodDark' | 'stone' | 'marble' | 'board' | 'copa' | 'metal' | 'produto' | 'engenharia' | 'qa' | 'growth' | 'mat';

function lcg(seed: number) {
  let s = seed >>> 0 || 7;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function wood(v: number, dark = false): Img {
  const t = new Img(TILE, TILE);
  const r = lcg(101 + v * 17);
  const base = dark ? ['#7a4e33', '#6c442c', '#87583a'] : [P.woodA, P.woodB, P.woodC];
  const line = dark ? '#4c2f1d' : P.woodLine;
  // tábuas horizontais de 4px com emendas desencontradas
  for (let row = 0; row < 4; row++) {
    const color = base[Math.floor(r() * base.length)];
    t.rect(0, row * 4, TILE, 4, color);
    t.hline(0, row * 4, TILE, lighten(color, 0.08));
    t.hline(0, row * 4 + 3, TILE, line);
    const seam = (row * 7 + v * 5) % TILE;
    t.vline(seam, row * 4, 3, line);
    t.speckle(0, row * 4 + 1, TILE, 2, [darken(color, 0.08), lighten(color, 0.06)], 0.12, v * 31 + row);
  }
  return t;
}

function stone(v: number): Img {
  const t = new Img(TILE, TILE);
  const r = lcg(301 + v * 13);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const c = r() < 0.5 ? P.stoneA : P.stoneB;
      t.rect(i * 8, j * 8, 8, 8, c);
      t.hline(i * 8, j * 8, 8, lighten(c, 0.12));
      t.vline(i * 8, j * 8, 8, lighten(c, 0.06));
      t.speckle(i * 8 + 1, j * 8 + 1, 6, 6, [darken(c, 0.06)], 0.15, v * 7 + i + j * 3);
    }
  }
  t.hline(0, 7, TILE, P.stoneLine).hline(0, 15, TILE, P.stoneLine);
  t.vline(7, 0, TILE, P.stoneLine).vline(15, 0, TILE, P.stoneLine);
  return t;
}

function marble(v: number): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, TILE, TILE, v % 2 ? P.marbleA : P.marbleB);
  const r = lcg(501 + v * 19);
  // veios diagonais
  let x = Math.floor(r() * 16);
  for (let y = 0; y < TILE; y++) {
    if (r() < 0.6) t.px(x, y, P.marbleVein);
    x = (x + (r() < 0.5 ? 1 : 0)) % TILE;
  }
  t.hline(0, 15, TILE, darken(P.marbleB, 0.08)).vline(15, 0, TILE, darken(P.marbleB, 0.08));
  t.hline(0, 0, TILE, lighten(P.marbleA, 0.4));
  return t;
}

function carpet(colors: readonly string[], v: number, pattern: 'dots' | 'diamond' | 'lines'): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, TILE, TILE, colors[0]);
  t.speckle(0, 0, TILE, TILE, [colors[1], colors[2]], 0.22, 700 + v * 23);
  if (pattern === 'dots') {
    t.px(4, 4, colors[1]).px(12, 12, colors[1]).px(12, 4, colors[2]).px(4, 12, colors[2]);
  } else if (pattern === 'diamond') {
    for (let i = 0; i < 4; i++) {
      t.px(8 + i, 4 + i, colors[1])
        .px(8 - i, 4 + i, colors[1])
        .px(8 + i, 12 - i, colors[1])
        .px(8 - i, 12 - i, colors[1]);
    }
  } else {
    t.hline(0, 7, TILE, colors[2]);
  }
  return t;
}

function boardBorder(): Img {
  const t = carpet([P.boardA, P.boardB, P.boardC], 9, 'diamond');
  t.hline(0, 1, TILE, P.gold).hline(0, 2, TILE, P.goldDark);
  return t;
}

function copa(v: number): Img {
  const t = new Img(TILE, TILE);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const c = (i + j + v) % 2 ? P.copaA : P.copaB;
      t.rect(i * 8, j * 8, 8, 8, c);
      t.hline(i * 8, j * 8, 8, lighten(c, 0.2));
    }
  }
  return t;
}

function metal(v: number): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, TILE, TILE, v % 2 ? P.metalA : P.metalB);
  for (let y = 1; y < TILE; y += 3) t.hline(1, y, 14, P.metalC);
  t.rect(0, 0, TILE, 1, lighten(P.metalB, 0.15)).rect(0, 15, TILE, 1, P.metalLine);
  t.px(1, 1, P.steelDark).px(14, 1, P.steelDark).px(1, 14, P.steelDark).px(14, 14, P.steelDark);
  return t;
}

function mat(): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, TILE, TILE, '#3d3a4a');
  t.rect(1, 1, 14, 14, '#4c4860');
  for (let y = 3; y < 14; y += 2) t.hline(2, y, 12, '#5a5672');
  return t;
}

export function floorTile(m: Material, v: number): Img {
  switch (m) {
    case 'wood':
      return wood(v);
    case 'woodDark':
      return wood(v, true);
    case 'stone':
      return stone(v);
    case 'marble':
      return marble(v);
    case 'board':
      return v === 99 ? boardBorder() : carpet([P.boardA, P.boardB, P.boardC], v, 'diamond');
    case 'copa':
      return copa(v);
    case 'metal':
      return metal(v);
    case 'mat':
      return mat();
    default:
      return carpet(P[m], v, m === 'engenharia' ? 'lines' : 'dots');
  }
}

// ---------------------------------------------------------------- paredes

/** Topo de parede (visto de cima). `mask`: bits N=1, L=2, S=4, O=8 indicam vizinho que também é parede. */
export function wallCap(mask: number): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, TILE, TILE, P.cap);
  t.speckle(1, 1, 14, 14, [P.capLight, P.capDark], 0.08, mask + 900);
  const n = mask & 1;
  const e = mask & 2;
  const s = mask & 4;
  const w = mask & 8;
  // bordas claras onde termina a parede (chanfro iluminado de cima/esquerda)
  if (!n) t.hline(0, 0, TILE, P.capEdge).hline(0, 1, TILE, P.capLight);
  if (!w) t.vline(0, 0, TILE, P.capEdge);
  if (!e) t.vline(15, 0, TILE, P.capDark);
  if (!s) t.hline(0, 15, TILE, INK).hline(0, 14, TILE, P.capDark);
  return t;
}

export type FaceVariant = 'plain' | 'panel' | 'exterior';

function faceBase(variant: FaceVariant): string {
  return variant === 'exterior' ? mix(P.face, '#c9b48f', 0.35) : variant === 'panel' ? mix(P.face, '#d9c9e8', 0.18) : P.face;
}

/**
 * Face de parede vista de frente (3/4). A parede tem 2 tiles de altura:
 * `upper` encosta no topo (sombra do beiral), `lower` termina no rodapé.
 */
export function wallFace(part: 'upper' | 'lower', variant: FaceVariant): Img {
  const t = new Img(TILE, TILE);
  const base = faceBase(variant);
  t.rect(0, 0, TILE, TILE, base);
  t.speckle(0, 0, TILE, TILE, [P.faceLight, P.faceShade], 0.05, (part === 'upper' ? 3 : 9) + variant.length * 13);
  if (variant === 'exterior') {
    for (let y = part === 'upper' ? 5 : 2; y < 16; y += 6) t.hline(0, y, TILE, darken(base, 0.07));
    t.vline(part === 'upper' ? 4 : 11, 0, TILE, darken(base, 0.05));
  }
  if (part === 'upper') {
    t.hline(0, 0, TILE, darken(base, 0.45)).hline(0, 1, TILE, darken(base, 0.25)).hline(0, 2, TILE, darken(base, 0.1));
    if (variant === 'panel') t.hline(0, 12, TILE, lighten(base, 0.2)).hline(0, 13, TILE, darken(base, 0.18));
    return t;
  }
  if (variant === 'panel') {
    // lambri: painéis verticais na metade de baixo
    t.rect(0, 0, TILE, 12, darken(base, 0.06));
    t.vline(0, 0, 12, darken(base, 0.2)).vline(8, 0, 12, darken(base, 0.2));
    t.vline(1, 0, 12, lighten(base, 0.15)).vline(9, 0, 12, lighten(base, 0.15));
  }
  // rodapé
  t.rect(0, 12, TILE, 3, P.baseboard).hline(0, 15, TILE, P.baseboardDark);
  t.hline(0, 12, TILE, lighten(P.baseboard, 0.2));
  return t;
}

/** Sombra suave projetada pela parede no piso logo abaixo. */
export function wallShadow(): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, TILE, 3, 'rgba(16,10,30,0.42)');
  t.rect(0, 3, TILE, 2, 'rgba(16,10,30,0.22)');
  t.rect(0, 5, TILE, 2, 'rgba(16,10,30,0.1)');
  return t;
}

/** Sombra lateral (parede vertical à esquerda). */
export function wallShadowSide(): Img {
  const t = new Img(TILE, TILE);
  t.rect(0, 0, 2, TILE, 'rgba(16,10,30,0.3)');
  t.rect(2, 0, 2, TILE, 'rgba(16,10,30,0.14)');
  return t;
}

export const VOID_COLOR = P.void;
