import { drawText, textWidth } from './font';
import { darken, Img, lighten, mix } from './raster';
import { INK, PALETTE as P } from './palette';

// Móveis do escritório, desenhados por código em 3/4: tampo claro, frente
// escura, contorno de tinta e sombra de contato. Cada peça traz metadados de
// colisão, profundidade e sobreposições animadas (telas, LEDs, contador).

export type DepthMode = 'auto' | 'floor' | 'wall';

export interface Overlay {
  kind: 'screen' | 'leds' | 'counter' | 'tv' | 'arcade' | 'vending' | 'coffee' | 'window';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FurnitureMeta {
  w: number;
  h: number;
  /** Colunas × linhas de tiles bloqueados a partir do canto inferior esquerdo. */
  footprint: [number, number];
  depth: DepthMode;
  /** Ajuste fino de profundidade (negativo = atrás de quem está no mesmo tile). */
  depthOffset?: number;
  overlays?: Overlay[];
  light?: { x: number; y: number; radius: number; color: string };
}

export interface FurniturePiece {
  meta: FurnitureMeta;
  draw: () => Img;
}

// ---------------------------------------------------------------- utilidades

/** Contorno + sombra de contato nas 2 últimas linhas. O corpo deve terminar em h-4. */
function finish(img: Img, shadow = true): Img {
  img.outline(INK);
  if (!shadow) return img;
  let minX = img.w;
  let maxX = -1;
  for (let x = 0; x < img.w; x++) {
    for (let y = 0; y < img.h - 2; y++) {
      if (img.get(x, y)[3] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        break;
      }
    }
  }
  if (maxX < 0) return img;
  for (let x = minX + 1; x <= maxX - 1; x++) {
    img.px(x, img.h - 2, 'rgba(16,10,30,0.34)');
    if (x > minX + 1 && x < maxX - 1) img.px(x, img.h - 1, 'rgba(16,10,30,0.16)');
  }
  return img;
}

function codeLines(img: Img, x: number, y: number, w: number, h: number, seed: number): void {
  const colors = [P.cyan, P.green, P.amber, P.pink, P.violet];
  let s = seed;
  for (let row = 0; row < h; row += 2) {
    s = (s * 1103515245 + 12345) >>> 0;
    const indent = (s >>> 8) % 4;
    const len = 3 + ((s >>> 12) % Math.max(2, w - indent - 3));
    img.hline(x + indent, y + row, Math.min(len, w - indent), colors[(s >>> 16) % colors.length]);
  }
}

function leaves(img: Img, cx: number, cy: number, r: number, seed: number): void {
  const greens = [P.plantA, P.plantB, P.plantC];
  let s = seed;
  for (let i = 0; i < 9; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const dx = ((s >>> 8) % (r * 2 + 1)) - r;
    const dy = ((s >>> 16) % (r * 2 + 1)) - r;
    img.ellipse(cx + dx, cy + dy, 2 + ((s >>> 4) % 2), 2, greens[i % greens.length]);
  }
  img.px(cx - 1, cy - r, P.plantC).px(cx + 1, cy - r + 1, P.plantC);
}

// ---------------------------------------------------------------- mesas

function desk(variant: number, lead = false): Img {
  const w = lead ? 48 : 32;
  const g = new Img(w, 34);
  // pernas e painel frontal
  g.rect(2, 27, 2, 4, P.deskDark).rect(w - 4, 27, 2, 4, P.deskDark);
  g.rect(1, 21, w - 2, 7, P.deskFront);
  g.hline(1, 21, w - 2, darken(P.deskFront, 0.25));
  g.hline(3, 24, w - 6, darken(P.deskFront, 0.12));
  g.rect(Math.floor(w / 2) - 1, 25, 2, 1, P.deskTopLight);
  if (lead) g.rect(1, 27, w - 2, 1, mix(P.deskFront, P.violet, 0.3));
  // tampo
  g.rect(1, 14, w - 2, 7, P.deskTop);
  g.hline(1, 14, w - 2, P.deskTopLight);
  g.speckle(2, 15, w - 4, 5, [darken(P.deskTop, 0.06)], 0.1, variant + 3);
  // monitores
  const monitors = lead ? [4, 26] : [7];
  monitors.forEach((mx, i) => {
    g.rect(mx + 7, 11, 4, 4, P.bezel);
    g.rect(mx + 4, 14, 10, 2, P.bezel);
    g.rect(mx, 1, 18, 11, P.bezel);
    g.rect(mx + 1, 2, 16, 8, P.screen);
    codeLines(g, mx + 2, 3, 14, 6, variant * 7 + i * 13 + 1);
    g.hline(mx + 1, 10, 16, '#2b3040');
    g.px(mx + 16, 10, P.green);
  });
  // teclado e mouse
  const kx = lead ? 18 : 10;
  g.rect(kx, 17, 12, 2, '#dfe2ea').hline(kx, 19, 12, '#a6abbb');
  for (let i = 1; i < 12; i += 2) g.px(kx + i, 17, '#c3c8d4');
  g.rect(kx + 14, 18, 2, 2, '#dfe2ea');
  // decoração por variante
  switch (variant % 4) {
    case 0: // caneca
      g.rect(3, 15, 3, 4, P.paper).hline(4, 15, 1, '#6b3f22').px(6, 16, P.paper).px(6, 17, P.paper);
      break;
    case 1: // vasinho
      g.rect(3, 17, 4, 3, P.pot);
      leaves(g, 5, 15, 1, variant);
      break;
    case 2: // papéis
      g.rect(2, 16, 6, 4, P.paper).hline(3, 17, 4, '#b9c2d6').hline(3, 18, 3, '#b9c2d6');
      break;
    default: // patinho de borracha (debug!)
      g.rect(3, 16, 4, 3, P.amber).px(6, 16, '#f97316').px(4, 16, INK);
  }
  if (lead) {
    // luminária de mesa
    g.vline(44, 6, 9, P.steelDark).rect(41, 4, 5, 3, P.amber).hline(41, 7, 5, lighten(P.amber, 0.4));
  }
  return finish(g);
}

function ceoDesk(): Img {
  const g = new Img(64, 34);
  const top = '#6b4430';
  const topLight = '#82553c';
  const front = '#4b2e20';
  g.rect(2, 26, 3, 5, '#2e1c14').rect(59, 26, 3, 5, '#2e1c14');
  g.rect(1, 19, 62, 9, front);
  g.hline(1, 19, 62, P.gold);
  for (const px of [5, 25, 45]) {
    g.rect(px, 21, 14, 5, darken(front, 0.18));
    g.rect(px + 1, 22, 12, 3, lighten(front, 0.06));
  }
  drawText(g, 'CEO', 26, 21, P.gold);
  g.rect(1, 11, 62, 8, top);
  g.hline(1, 11, 62, topLight);
  g.speckle(2, 12, 60, 6, [darken(top, 0.1), lighten(top, 0.05)], 0.15, 77);
  // notebook (tampa vista por trás)
  g.rect(25, 1, 14, 11, '#9aa3b5').rect(26, 2, 12, 9, '#b8c0d0');
  g.px(31, 6, P.cyan).px(32, 6, P.cyan);
  // papéis, caneta, porta-retrato
  g.rect(6, 13, 8, 5, P.paper).hline(7, 14, 6, '#b9c2d6').hline(7, 16, 4, '#b9c2d6');
  g.rect(45, 9, 5, 5, P.gold).rect(46, 10, 3, 3, '#7fb3d5');
  g.rect(53, 13, 3, 4, '#2b2b36').vline(54, 10, 3, P.gold);
  return finish(g);
}

function meetingTable(w = 80): Img {
  const g = new Img(w, 40);
  const top = P.whiteTop;
  g.rect(3, 31, 3, 5, P.steelDark).rect(w - 6, 31, 3, 5, P.steelDark);
  g.rect(1, 27, w - 2, 4, P.whiteFront);
  g.hline(1, 27, w - 2, P.whiteDark);
  g.rect(1, 3, w - 2, 24, top);
  g.hline(1, 3, w - 2, '#ffffff');
  g.rect(3, 5, w - 6, 20, mix(top, '#d7dbe4', 0.4));
  // notebooks, papéis e cafés
  for (let i = 0; i < 4; i++) {
    const x = 8 + i * Math.floor((w - 20) / 3);
    g.rect(x, 6, 9, 6, '#3a4054').rect(x + 1, 7, 7, 4, P.screen);
    codeLines(g, x + 2, 8, 5, 2, i * 11);
    g.rect(x + 1, 18, 7, 5, P.paper).hline(x + 2, 19, 5, '#b9c2d6');
    g.rect(x + 9, 19, 2, 3, '#f4f1ea').px(x + 9, 19, '#6b3f22');
  }
  // plantinha no centro
  g.rect(Math.floor(w / 2) - 2, 13, 4, 3, P.pot);
  leaves(g, Math.floor(w / 2), 11, 2, 5);
  return finish(g);
}

function boardTable(): Img {
  const w = 96;
  const g = new Img(w, 40);
  const top = '#3d2418';
  g.rect(4, 31, 4, 5, '#24140d').rect(w - 8, 31, 4, 5, '#24140d');
  g.rect(1, 27, w - 2, 4, '#2c1a11');
  g.hline(1, 27, w - 2, P.gold);
  g.rect(1, 3, w - 2, 24, top);
  g.hline(1, 3, w - 2, '#5a3626');
  g.rect(4, 6, w - 8, 18, '#4a2c1e');
  g.hline(4, 6, w - 8, P.goldDark).hline(4, 23, w - 8, P.goldDark);
  g.vline(4, 6, 18, P.goldDark).vline(w - 5, 6, 18, P.goldDark);
  // pastas de aprovação
  for (let i = 0; i < 5; i++) {
    const x = 10 + i * 17;
    g.rect(x, 9, 9, 7, i % 2 ? '#f6f1e4' : '#e9dfc6')
      .hline(x + 1, 11, 6, '#b8a98a')
      .hline(x + 1, 13, 4, '#b8a98a');
    g.px(x + 7, 14, P.red);
  }
  // martelo
  g.rect(44, 18, 8, 2, '#8b5a3c').rect(50, 16, 3, 6, '#6b3f22');
  return finish(g);
}

// ---------------------------------------------------------------- cadeiras

function chairBack(color: string = P.chair): Img {
  const g = new Img(16, 22);
  const dark = darken(color, 0.25);
  g.hline(3, 18, 10, '#20232e').px(3, 17, '#20232e').px(12, 17, '#20232e');
  g.rect(7, 13, 2, 4, '#20232e');
  g.rect(2, 11, 12, 3, dark);
  g.rounded(3, 1, 10, 11, color);
  g.hline(4, 1, 8, lighten(color, 0.25));
  g.vline(3, 3, 7, dark).vline(12, 3, 7, dark);
  return finish(g, false);
}

function chairFront(opts: { color?: string; gold?: boolean } = {}): Img {
  const color = opts.color ?? '#4a3428';
  const g = new Img(16, 24);
  const trim = opts.gold ? P.gold : darken(color, 0.3);
  g.hline(3, 20, 10, '#20232e').px(3, 19, '#20232e').px(12, 19, '#20232e');
  g.rect(7, 16, 2, 3, '#20232e');
  g.rounded(2, 0, 12, 13, opts.gold ? P.goldDark : darken(color, 0.15));
  g.rounded(3, 1, 10, 11, color);
  g.hline(4, 1, 8, lighten(color, 0.2));
  g.rect(1, 9, 2, 6, trim).rect(13, 9, 2, 6, trim);
  g.rect(2, 12, 12, 2, lighten(color, 0.12)).rect(2, 14, 12, 2, darken(color, 0.2));
  if (opts.gold) {
    g.px(7, 0, P.gold).px(8, 0, P.gold).px(5, 1, P.gold).px(10, 1, P.gold);
    g.rect(7, 4, 2, 2, P.amber);
  }
  return finish(g, false);
}

// ---------------------------------------------------------------- armazenamento e decoração

function vault(): Img {
  const g = new Img(48, 50);
  const steel = '#7d8597';
  g.rect(0, 0, 48, 46, '#4b5263');
  g.rect(1, 1, 46, 44, '#5b6274');
  // display do lucro
  g.rect(5, 3, 38, 9, '#0b1110');
  g.rect(6, 4, 36, 7, '#0f1d18');
  // porta redonda
  g.ellipse(24, 28, 15, 15, '#3d4352');
  g.ellipse(24, 28, 14, 14, steel);
  g.ellipse(24, 28, 11, 11, '#9aa2b4');
  g.ellipse(24, 28, 10, 10, steel);
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    g.px(24 + Math.round(Math.cos(ang) * 12.5), 28 + Math.round(Math.sin(ang) * 12.5), '#c8cfdc');
  }
  // volante dourado
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    for (let r = 2; r <= 7; r++) g.px(24 + Math.round(Math.cos(ang) * r), 28 + Math.round(Math.sin(ang) * r), P.gold);
  }
  g.ellipse(24, 28, 2, 2, P.goldDark);
  g.px(24, 28, P.amber);
  // teclado numérico
  g.rect(41, 22, 4, 8, '#2a2f3c');
  for (let i = 0; i < 3; i++) g.px(42, 23 + i * 2, P.green).px(43, 23 + i * 2, P.amber);
  g.hline(1, 1, 46, '#8a93a8');
  return finish(g);
}

function filing(): Img {
  const g = new Img(16, 34);
  g.rect(1, 4, 14, 27, '#7f889c');
  g.hline(1, 4, 14, '#a9b1c3');
  for (let i = 0; i < 3; i++) {
    const y = 7 + i * 8;
    g.rect(2, y, 12, 7, '#8f98ac');
    g.hline(2, y + 6, 12, '#5c6479');
    g.rect(6, y + 2, 4, 1, '#d4d9e3');
  }
  return finish(g);
}

function bookshelf(seed: number): Img {
  const g = new Img(32, 36);
  const wood = '#7a4b2f';
  g.rect(0, 0, 32, 33, wood);
  g.hline(0, 0, 32, '#9a6440');
  const books = ['#e05555', '#38bdf8', '#fbbf24', '#34d399', '#a78bfa', '#f472b6', '#f4f1ea', '#64748b'];
  let s = seed;
  for (let shelf = 0; shelf < 3; shelf++) {
    const y0 = 2 + shelf * 10;
    g.rect(2, y0, 28, 8, '#3b2416');
    let x = 3;
    while (x < 28) {
      s = (s * 1103515245 + 12345) >>> 0;
      const bw = 1 + ((s >>> 8) % 3);
      const bh = 5 + ((s >>> 12) % 3);
      const c = books[(s >>> 16) % books.length];
      if ((s >>> 20) % 7 === 0) {
        x += 2;
        continue;
      }
      g.rect(x, y0 + 8 - bh, bw, bh, c);
      g.vline(x, y0 + 8 - bh, bh, lighten(c, 0.2));
      x += bw;
    }
    g.hline(1, y0 + 8, 30, '#9a6440');
  }
  return finish(g);
}

function plantBig(seed: number): Img {
  const g = new Img(16, 36);
  g.rect(4, 24, 8, 8, P.pot).hline(3, 24, 10, lighten(P.pot, 0.2)).hline(4, 31, 8, P.potDark);
  g.vline(7, 14, 10, P.plantD).vline(9, 16, 8, P.plantD);
  leaves(g, 8, 9, 5, seed);
  leaves(g, 6, 15, 3, seed + 1);
  leaves(g, 10, 17, 3, seed + 2);
  return finish(g);
}

function plantSmall(seed: number): Img {
  const g = new Img(16, 18);
  g.rect(5, 9, 6, 5, P.pot).hline(4, 9, 8, lighten(P.pot, 0.2));
  leaves(g, 8, 6, 2, seed);
  return finish(g);
}

function sofa(color: string = P.sofa): Img {
  const g = new Img(48, 26);
  const dark = darken(color, 0.25);
  const light = lighten(color, 0.18);
  g.rect(3, 20, 2, 2, '#2a1d14').rect(43, 20, 2, 2, '#2a1d14');
  g.rect(1, 15, 46, 5, dark);
  g.rect(4, 2, 40, 10, color);
  for (const x of [4, 17, 30]) {
    g.rect(x, 3, 13, 8, color)
      .hline(x + 1, 3, 11, light)
      .vline(x + 12, 3, 8, dark);
  }
  g.rect(4, 11, 40, 5, light).hline(4, 11, 40, lighten(color, 0.32));
  g.vline(17, 11, 5, color).vline(31, 11, 5, color);
  g.rect(0, 6, 5, 13, color).hline(0, 6, 5, light);
  g.rect(43, 6, 5, 13, color).hline(43, 6, 5, light);
  // almofada colorida
  g.rect(37, 6, 5, 5, P.amber).hline(37, 6, 5, lighten(P.amber, 0.3));
  return finish(g);
}

function kitchenCounter(): Img {
  const g = new Img(64, 34);
  // armários
  g.rect(0, 16, 64, 15, '#d8cdb8');
  for (let i = 0; i < 4; i++) {
    g.rect(1 + i * 16, 17, 14, 13, '#e6dcc8');
    g.rect(12 + i * 16, 22, 1, 3, '#8a7a62');
  }
  // bancada
  g.rect(0, 12, 64, 4, '#5f6677').hline(0, 12, 64, '#8a93a8');
  // cafeteira
  g.rect(3, 0, 11, 12, '#2a2a33').rect(4, 1, 9, 3, '#3d3d4a');
  g.rect(6, 6, 5, 4, '#15151b').px(11, 2, P.red).px(5, 2, P.green);
  g.rect(7, 9, 3, 3, P.paper);
  // pia
  g.rect(20, 12, 14, 3, '#9aa3b5').rect(21, 13, 12, 1, '#6c7488');
  g.vline(26, 6, 6, '#b4bccd').hline(26, 6, 4, '#b4bccd');
  // micro-ondas
  g.rect(39, 3, 15, 9, '#e9e7e2').rect(40, 4, 9, 7, '#2a2f3c').rect(50, 5, 3, 1, P.green);
  // fruteira
  g.ellipse(59, 10, 3, 1, '#c98d5a');
  g.px(58, 9, P.red).px(60, 9, P.amber).px(59, 8, P.green);
  return finish(g);
}

function fridge(): Img {
  const g = new Img(16, 36);
  g.rect(1, 0, 14, 32, '#e8edf3');
  g.hline(1, 0, 14, '#ffffff');
  g.hline(1, 11, 14, '#b9c1cc');
  g.vline(12, 3, 6, '#9aa3b5').vline(12, 14, 12, '#9aa3b5');
  g.rect(3, 15, 2, 2, P.red).rect(6, 18, 2, 2, P.amber).rect(4, 21, 3, 3, P.paper);
  return finish(g);
}

function vending(): Img {
  const g = new Img(16, 36);
  g.rect(0, 0, 16, 32, '#2b2140');
  g.hline(0, 0, 16, '#4a3a6b');
  g.rect(2, 3, 9, 21, '#16202f');
  const snacks = [P.red, P.amber, P.green, P.pink, P.cyan, P.violet];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 3; i++) g.rect(3 + i * 3, 5 + row * 5, 2, 3, snacks[(row + i) % snacks.length]);
    g.hline(2, 8 + row * 5, 9, '#3a4a66');
  }
  g.rect(12, 5, 3, 8, '#3d3456');
  g.px(13, 6, P.green).px(13, 8, P.amber).px(13, 10, P.red);
  g.rect(3, 26, 9, 3, '#120d1d');
  return finish(g);
}

function arcade(): Img {
  const g = new Img(16, 36);
  g.rect(1, 0, 14, 32, '#4c2a7a');
  g.rect(1, 0, 14, 5, '#ff4fa3');
  drawText(g, 'GO', 5, 0, '#1b1726');
  g.rect(2, 6, 12, 10, '#120f1f');
  g.rect(3, 7, 10, 8, '#1f3b5a');
  g.rect(1, 17, 14, 3, '#6b3fa0');
  g.px(5, 17, P.red).px(10, 18, P.amber).px(12, 18, P.cyan);
  g.vline(5, 15, 2, '#2a2a33');
  g.vline(3, 21, 10, '#3d2264');
  return finish(g);
}

function waterCooler(): Img {
  const g = new Img(16, 30);
  g.rect(4, 1, 8, 10, 'rgba(126,200,255,0.85)');
  g.hline(4, 1, 8, '#d7f0ff').vline(5, 2, 8, '#c4e8ff');
  g.rect(3, 11, 10, 15, '#e8edf3');
  g.hline(3, 11, 10, '#ffffff');
  g.px(6, 15, P.cyan).px(9, 15, P.red);
  g.rect(5, 19, 6, 2, '#9aa3b5');
  return finish(g);
}

function roundTable(): Img {
  const g = new Img(32, 24);
  g.rect(14, 12, 4, 7, '#5c6479').hline(10, 19, 12, '#3d4352');
  g.ellipse(16, 8, 14, 6, P.deskFront);
  g.ellipse(16, 7, 14, 6, P.deskTop);
  g.hline(6, 2, 20, P.deskTopLight);
  g.rect(9, 5, 3, 3, P.paper).px(9, 5, '#6b3f22');
  g.rect(20, 6, 4, 2, P.amber);
  return finish(g);
}

function stool(): Img {
  const g = new Img(16, 16);
  g.vline(5, 7, 5, '#3d4352').vline(10, 7, 5, '#3d4352');
  g.ellipse(8, 5, 5, 2, '#2f6f5a');
  g.hline(4, 4, 8, '#3f8a70');
  return finish(g);
}

function serverRack(seed: number): Img {
  const g = new Img(16, 36);
  g.rect(1, 0, 14, 32, '#171a24');
  g.hline(1, 0, 14, '#2e3445');
  for (let u = 0; u < 7; u++) {
    const y = 2 + u * 4;
    g.rect(2, y, 12, 3, u % 2 ? '#262b3a' : '#2d3344');
    g.hline(3, y + 1, 5, '#11141c');
    const s = (seed * 31 + u * 7) % 5;
    g.px(10, y + 1, s % 2 ? P.green : '#1f6b3a').px(12, y + 1, s % 3 ? P.amber : '#6b4f13');
  }
  g.vline(1, 0, 32, '#2a3040');
  return finish(g);
}

function whiteboard(text: string): Img {
  const g = new Img(32, 22);
  g.rect(0, 0, 32, 18, '#8a93a8');
  g.rect(1, 1, 30, 16, '#fbfbf8');
  drawText(g, text, 3, 3, P.red);
  g.hline(3, 11, 14, '#38bdf8').hline(3, 13, 10, '#38bdf8');
  g.px(20, 11, P.green).px(21, 12, P.green).px(22, 11, P.green).px(23, 10, P.green).px(24, 9, P.green);
  g.rect(4, 18, 24, 2, '#6c7488').px(8, 17, P.red).px(11, 17, P.cyan);
  return finish(g, false);
}

function kanban(teamColor: string): Img {
  const g = new Img(32, 22);
  g.rect(0, 0, 32, 20, '#3a3046');
  g.rect(1, 1, 30, 18, '#c69a6b');
  g.vline(11, 2, 16, '#8a6845').vline(21, 2, 16, '#8a6845');
  const notes = [teamColor, '#fde68a', '#fbcfe8', teamColor, '#bfdbfe', '#fde68a', teamColor];
  const spots: [number, number][] = [
    [3, 3],
    [5, 9],
    [3, 14],
    [14, 4],
    [15, 10],
    [24, 3],
    [24, 9],
  ];
  spots.forEach(([x, y], i) => g.rect(x, y, 5, 4, notes[i]).hline(x, y, 5, lighten(notes[i], 0.3)));
  return finish(g, false);
}

function tv(): Img {
  const g = new Img(32, 22);
  g.rect(0, 0, 32, 19, '#111318');
  g.rect(1, 1, 30, 17, '#0c1424');
  g.rect(14, 19, 4, 2, '#2a2f3c');
  return finish(g, false);
}

export function windowTile(day: boolean): Img {
  const g = new Img(32, 16);
  g.rect(0, 0, 32, 16, '#cfc5b3');
  g.rect(1, 1, 30, 13, '#8b7f6b');
  const sky = day ? [P.skyDayLight, P.skyDay] : [P.skyDeep, P.sky];
  for (let y = 2; y < 13; y++) g.hline(2, y, 28, mix(sky[0], sky[1], (y - 2) / 10));
  if (day) {
    g.ellipse(9, 5, 3, 1, '#ffffff').ellipse(22, 4, 4, 1, '#f1fbff');
  } else {
    for (const [x, y] of [
      [5, 3],
      [12, 5],
      [20, 3],
      [26, 6],
      [17, 4],
    ] as const)
      g.px(x, y, '#fff7d6');
    g.px(25, 3, '#fef3c7').px(26, 3, '#fef3c7').px(25, 4, '#fde68a');
  }
  // silhueta da cidade com janelas acesas
  const city = day ? '#7d8fa8' : '#1c2238';
  const heights = [6, 4, 8, 5, 7, 3, 6, 9, 4, 6, 5, 7, 4, 8];
  heights.forEach((h, i) => g.rect(2 + i * 2, 13 - h, 2, h, city));
  if (!day) {
    for (const [x, y] of [
      [4, 9],
      [8, 7],
      [14, 10],
      [16, 6],
      [22, 8],
      [26, 9],
      [11, 11],
    ] as const)
      g.px(x, y, '#fbbf24');
  }
  g.vline(15, 1, 13, '#8b7f6b').vline(16, 1, 13, '#a99d88');
  g.hline(0, 14, 32, '#e9e1d2').hline(0, 15, 32, '#b3a78f');
  return g;
}

function painting(seed: number): Img {
  const g = new Img(24, 18);
  g.rect(0, 0, 24, 16, P.goldDark);
  g.rect(1, 1, 22, 14, P.gold);
  g.rect(2, 2, 20, 12, seed % 2 ? '#1e2a4a' : '#f4ead6');
  if (seed % 2) {
    g.ellipse(8, 8, 4, 4, '#f472b6').rect(13, 4, 6, 6, '#38bdf8').hline(3, 12, 18, '#fbbf24');
  } else {
    g.ellipse(12, 9, 6, 3, '#34d399').rect(5, 3, 4, 4, '#e05555').hline(3, 12, 18, '#1e2a4a');
  }
  return finish(g, false);
}

function clock(): Img {
  const g = new Img(14, 14);
  g.ellipse(7, 6, 5, 5, '#2a2f3c');
  g.ellipse(7, 6, 4, 4, '#fbfbf8');
  g.vline(7, 3, 4, INK).hline(7, 6, 3, P.red);
  return g;
}

function rug(w: number, h: number, colors: [string, string, string]): Img {
  const g = new Img(w, h);
  g.rect(0, 0, w, h, colors[0]);
  g.rect(2, 2, w - 4, h - 4, colors[1]);
  g.rect(4, 4, w - 8, h - 8, colors[2]);
  for (let x = 6; x < w - 6; x += 4) g.px(x, 3, colors[0]).px(x, h - 4, colors[0]);
  g.ellipse(Math.floor(w / 2), Math.floor(h / 2), Math.floor(w / 6), Math.floor(h / 6), colors[1]);
  return g;
}

function reception(): Img {
  const g = new Img(48, 30);
  g.rect(16, 0, 12, 7, '#2a2f3c').rect(21, 7, 2, 3, '#2a2f3c');
  g.rect(1, 9, 46, 5, '#f1ede4').hline(1, 9, 46, '#ffffff');
  g.rect(1, 14, 46, 12, '#3a3150');
  g.rect(1, 18, 46, 3, P.cyan);
  drawText(g, 'PIXEL CORP', 4, 15, '#e9e4ff');
  return finish(g);
}

function bench(): Img {
  const g = new Img(32, 16);
  g.rect(3, 9, 2, 3, '#3d4352').rect(27, 9, 2, 3, '#3d4352');
  g.rect(1, 5, 30, 4, P.deskTop).hline(1, 5, 30, P.deskTopLight).hline(1, 8, 30, P.deskFront);
  return finish(g);
}

function lamp(): Img {
  const g = new Img(16, 36);
  g.ellipse(8, 31, 4, 1, '#2a2f3c');
  g.vline(8, 9, 22, '#3d4352');
  g.rect(3, 1, 10, 8, '#f6e7c1');
  g.hline(3, 1, 10, '#fff7df').hline(3, 8, 10, '#d8c49a');
  return finish(g);
}

function globe(): Img {
  const g = new Img(16, 26);
  g.rect(6, 19, 4, 3, '#6b3f22').hline(4, 22, 8, '#4b2e20');
  g.vline(8, 15, 4, P.gold);
  g.ellipse(8, 9, 6, 6, '#2f77c4');
  g.ellipse(6, 7, 2, 2, '#34d399').ellipse(10, 11, 2, 1, '#34d399').px(9, 5, '#34d399');
  g.px(5, 5, '#c7ecff');
  return finish(g);
}

function trophyCabinet(): Img {
  const g = new Img(32, 30);
  g.rect(1, 12, 30, 15, '#5a3a2a').hline(1, 12, 30, '#7a5038');
  g.rect(3, 15, 12, 10, '#4a2f22').rect(17, 15, 12, 10, '#4a2f22');
  for (const x of [5, 14, 23]) {
    g.rect(x, 4, 5, 4, P.gold)
      .hline(x, 4, 5, '#fde68a')
      .rect(x + 2, 8, 1, 2, P.goldDark)
      .hline(x + 1, 10, 3, P.goldDark);
  }
  return finish(g);
}

function printer(): Img {
  const g = new Img(16, 20);
  g.rect(1, 6, 14, 10, '#c9ced8').hline(1, 6, 14, '#e7eaf0');
  g.rect(3, 2, 10, 5, P.paper);
  g.rect(3, 12, 10, 2, '#5c6479').px(12, 8, P.green);
  return finish(g);
}

function sign(text: string, bg: string, fg: string): Img {
  const w = textWidth(text) + 8;
  const g = new Img(w, 11);
  g.rect(0, 0, w, 11, darken(bg, 0.35));
  g.rect(1, 1, w - 2, 9, bg);
  g.hline(1, 1, w - 2, lighten(bg, 0.25));
  drawText(g, text, 4, 3, fg);
  return g;
}

function logo(): Img {
  const small = new Img(textWidth('PIXEL CORP'), 5);
  drawText(small, 'PIXEL CORP', 0, 0, '#ffffff');
  const big = small.scale(2);
  const g = new Img(big.w + 12, 18);
  g.rect(0, 0, g.w, 18, '#1d1830');
  g.rect(1, 1, g.w - 2, 16, '#2a2342');
  for (let y = 0; y < big.h; y++) {
    for (let x = 0; x < big.w; x++) {
      if (big.get(x, y)[3] > 0) g.px(6 + x, 4 + y, mix(P.cyan, P.violet, x / big.w));
    }
  }
  return g;
}

function acUnit(): Img {
  const g = new Img(32, 14);
  g.rect(0, 0, 32, 12, '#e8edf3').hline(0, 0, 32, '#ffffff');
  for (let y = 7; y < 11; y++) g.hline(2, y, 28, y % 2 ? '#b9c1cc' : '#d3d9e2');
  g.px(28, 3, P.green);
  return finish(g, false);
}

function doormat(): Img {
  const g = new Img(32, 16);
  g.rect(0, 2, 32, 12, '#4c3a2c');
  g.rect(2, 4, 28, 8, '#6b5241');
  drawText(g, 'OLA', 10, 6, '#e9dcc4');
  return g;
}

// ---------------------------------------------------------------- catálogo

const TEAM_COLORS: Record<string, string> = {
  produto: '#34d399',
  engenharia: '#38bdf8',
  qa: '#c084fc',
  growth: '#fbbf24',
};

const screen = (x: number, y: number): Overlay => ({ kind: 'screen', x, y, w: 16, h: 8 });

export const FURNITURE: Record<string, FurniturePiece> = {
  desk_0: { meta: { w: 32, h: 34, footprint: [2, 1], depth: 'auto', overlays: [screen(8, 2)] }, draw: () => desk(0) },
  desk_1: { meta: { w: 32, h: 34, footprint: [2, 1], depth: 'auto', overlays: [screen(8, 2)] }, draw: () => desk(1) },
  desk_2: { meta: { w: 32, h: 34, footprint: [2, 1], depth: 'auto', overlays: [screen(8, 2)] }, draw: () => desk(2) },
  desk_3: { meta: { w: 32, h: 34, footprint: [2, 1], depth: 'auto', overlays: [screen(8, 2)] }, draw: () => desk(3) },
  desk_lead: {
    meta: {
      w: 48,
      h: 34,
      footprint: [3, 1],
      depth: 'auto',
      overlays: [screen(5, 2), screen(27, 2)],
      light: { x: 43, y: 8, radius: 26, color: '#fbbf24' },
    },
    draw: () => desk(1, true),
  },
  ceo_desk: { meta: { w: 64, h: 34, footprint: [4, 1], depth: 'auto' }, draw: ceoDesk },
  meeting_table: { meta: { w: 80, h: 40, footprint: [5, 2], depth: 'auto' }, draw: () => meetingTable(80) },
  board_table: { meta: { w: 96, h: 40, footprint: [6, 2], depth: 'auto' }, draw: boardTable },
  chair_back: { meta: { w: 16, h: 22, footprint: [0, 0], depth: 'auto', depthOffset: 3 }, draw: () => chairBack() },
  chair_back_red: { meta: { w: 16, h: 22, footprint: [0, 0], depth: 'auto', depthOffset: 3 }, draw: () => chairBack('#7a2a40') },
  chair_front: { meta: { w: 16, h: 24, footprint: [0, 0], depth: 'auto', depthOffset: -14 }, draw: () => chairFront() },
  chair_front_red: {
    meta: { w: 16, h: 24, footprint: [0, 0], depth: 'auto', depthOffset: -14 },
    draw: () => chairFront({ color: '#7a2a40' }),
  },
  chair_ceo: { meta: { w: 16, h: 24, footprint: [0, 0], depth: 'auto', depthOffset: -14 }, draw: () => chairFront({ color: '#3b2a4f' }) },
  throne: {
    meta: { w: 16, h: 24, footprint: [0, 0], depth: 'auto', depthOffset: -14 },
    draw: () => chairFront({ color: '#a3243f', gold: true }),
  },
  vault: {
    meta: {
      w: 48,
      h: 50,
      footprint: [3, 2],
      depth: 'auto',
      overlays: [{ kind: 'counter', x: 6, y: 4, w: 36, h: 7 }],
      light: { x: 24, y: 28, radius: 30, color: '#4ade80' },
    },
    draw: vault,
  },
  filing: { meta: { w: 16, h: 34, footprint: [1, 1], depth: 'auto' }, draw: filing },
  bookshelf_0: { meta: { w: 32, h: 36, footprint: [2, 1], depth: 'auto' }, draw: () => bookshelf(11) },
  bookshelf_1: { meta: { w: 32, h: 36, footprint: [2, 1], depth: 'auto' }, draw: () => bookshelf(29) },
  plant_big_0: { meta: { w: 16, h: 36, footprint: [1, 1], depth: 'auto' }, draw: () => plantBig(3) },
  plant_big_1: { meta: { w: 16, h: 36, footprint: [1, 1], depth: 'auto' }, draw: () => plantBig(17) },
  plant_small: { meta: { w: 16, h: 18, footprint: [1, 1], depth: 'auto' }, draw: () => plantSmall(5) },
  sofa: { meta: { w: 48, h: 26, footprint: [3, 1], depth: 'auto', depthOffset: -12 }, draw: () => sofa() },
  sofa_green: { meta: { w: 48, h: 26, footprint: [3, 1], depth: 'auto', depthOffset: -12 }, draw: () => sofa('#3f8a70') },
  kitchen_counter: {
    meta: { w: 64, h: 34, footprint: [4, 1], depth: 'auto', overlays: [{ kind: 'coffee', x: 6, y: 5, w: 5, h: 4 }] },
    draw: kitchenCounter,
  },
  fridge: { meta: { w: 16, h: 36, footprint: [1, 1], depth: 'auto' }, draw: fridge },
  vending: {
    meta: {
      w: 16,
      h: 36,
      footprint: [1, 1],
      depth: 'auto',
      overlays: [{ kind: 'vending', x: 2, y: 3, w: 9, h: 21 }],
      light: { x: 7, y: 14, radius: 20, color: '#a78bfa' },
    },
    draw: vending,
  },
  arcade: {
    meta: {
      w: 16,
      h: 36,
      footprint: [1, 1],
      depth: 'auto',
      overlays: [{ kind: 'arcade', x: 3, y: 7, w: 10, h: 8 }],
      light: { x: 8, y: 10, radius: 22, color: '#ff4fa3' },
    },
    draw: arcade,
  },
  water_cooler: { meta: { w: 16, h: 30, footprint: [1, 1], depth: 'auto' }, draw: waterCooler },
  round_table: { meta: { w: 32, h: 24, footprint: [2, 1], depth: 'auto' }, draw: roundTable },
  stool: { meta: { w: 16, h: 16, footprint: [0, 0], depth: 'auto', depthOffset: -10 }, draw: stool },
  server_rack_0: {
    meta: { w: 16, h: 36, footprint: [1, 1], depth: 'auto', overlays: [{ kind: 'leds', x: 10, y: 3, w: 3, h: 26 }] },
    draw: () => serverRack(1),
  },
  server_rack_1: {
    meta: { w: 16, h: 36, footprint: [1, 1], depth: 'auto', overlays: [{ kind: 'leds', x: 10, y: 3, w: 3, h: 26 }] },
    draw: () => serverRack(2),
  },
  whiteboard_review: { meta: { w: 32, h: 22, footprint: [0, 0], depth: 'wall' }, draw: () => whiteboard('REVIEW') },
  whiteboard_plan: { meta: { w: 32, h: 22, footprint: [0, 0], depth: 'wall' }, draw: () => whiteboard('PLANO') },
  tv: { meta: { w: 32, h: 22, footprint: [0, 0], depth: 'wall', overlays: [{ kind: 'tv', x: 1, y: 1, w: 30, h: 17 }] }, draw: tv },
  window_night: {
    meta: { w: 32, h: 16, footprint: [0, 0], depth: 'wall', overlays: [{ kind: 'window', x: 0, y: 0, w: 32, h: 16 }] },
    draw: () => windowTile(false),
  },
  window_day: { meta: { w: 32, h: 16, footprint: [0, 0], depth: 'wall' }, draw: () => windowTile(true) },
  painting_0: { meta: { w: 24, h: 18, footprint: [0, 0], depth: 'wall' }, draw: () => painting(0) },
  painting_1: { meta: { w: 24, h: 18, footprint: [0, 0], depth: 'wall' }, draw: () => painting(1) },
  clock: { meta: { w: 14, h: 14, footprint: [0, 0], depth: 'wall' }, draw: clock },
  rug_blue: { meta: { w: 48, h: 32, footprint: [0, 0], depth: 'floor' }, draw: () => rug(48, 32, ['#2c2a4a', '#3c3a66', '#4b4a80']) },
  rug_gold: { meta: { w: 64, h: 48, footprint: [0, 0], depth: 'floor' }, draw: () => rug(64, 48, ['#5c1d2f', P.goldDark, '#7f2c43']) },
  rug_green: { meta: { w: 48, h: 32, footprint: [0, 0], depth: 'floor' }, draw: () => rug(48, 32, ['#1f4d3d', '#2f6f5a', '#3d8a70']) },
  reception: {
    meta: { w: 48, h: 30, footprint: [3, 1], depth: 'auto', light: { x: 22, y: 4, radius: 20, color: '#5eead4' } },
    draw: reception,
  },
  bench: { meta: { w: 32, h: 16, footprint: [2, 1], depth: 'auto' }, draw: bench },
  lamp: { meta: { w: 16, h: 36, footprint: [1, 1], depth: 'auto', light: { x: 8, y: 5, radius: 44, color: '#fde68a' } }, draw: lamp },
  globe: { meta: { w: 16, h: 26, footprint: [1, 1], depth: 'auto' }, draw: globe },
  trophy_cabinet: { meta: { w: 32, h: 30, footprint: [2, 1], depth: 'auto' }, draw: trophyCabinet },
  printer: { meta: { w: 16, h: 20, footprint: [1, 1], depth: 'auto' }, draw: printer },
  ac_unit: { meta: { w: 32, h: 14, footprint: [0, 0], depth: 'wall' }, draw: acUnit },
  doormat: { meta: { w: 32, h: 16, footprint: [0, 0], depth: 'floor' }, draw: doormat },
  logo: { meta: { w: 0, h: 18, footprint: [0, 0], depth: 'wall' }, draw: logo },
};

// placas de sala e de time
const SIGNS: [string, string, string, string][] = [
  ['sign_conselho', 'CONSELHO', P.gold, '#2a1520'],
  ['sign_ceo', 'CEO', '#8b7cf6', '#ffffff'],
  ['sign_financeiro', 'FINANCEIRO', '#4ade80', '#0f2a1c'],
  ['sign_reuniao', 'REUNIAO', '#e9e4ff', '#2a2342'],
  ['sign_servidores', 'SERVIDORES', '#38bdf8', '#0b1f33'],
  ['sign_copa', 'COPA', '#f472b6', '#2a1022'],
  ['sign_produto', 'PRODUTO', TEAM_COLORS.produto, '#0f2a1c'],
  ['sign_engenharia', 'ENGENHARIA', TEAM_COLORS.engenharia, '#0b1f33'],
  ['sign_qa', 'QA SEGURANCA', TEAM_COLORS.qa, '#22113a'],
  ['sign_growth', 'GROWTH', TEAM_COLORS.growth, '#2a1a05'],
];
for (const [key, text, bg, fg] of SIGNS) {
  FURNITURE[key] = { meta: { w: textWidth(text) + 8, h: 11, footprint: [0, 0], depth: 'wall' }, draw: () => sign(text, bg, fg) };
}
for (const [team, color] of Object.entries(TEAM_COLORS)) {
  FURNITURE[`kanban_${team}`] = { meta: { w: 32, h: 22, footprint: [0, 0], depth: 'wall' }, draw: () => kanban(color) };
}
FURNITURE.logo.meta.w = logo().w;

export function furnitureImage(key: string): Img {
  const piece = FURNITURE[key];
  if (!piece) throw new Error(`móvel desconhecido: ${key}`);
  const img = piece.draw();
  if (img.w !== piece.meta.w || img.h !== piece.meta.h) {
    throw new Error(`${key}: tamanho ${img.w}×${img.h} ≠ meta ${piece.meta.w}×${piece.meta.h}`);
  }
  return img;
}
