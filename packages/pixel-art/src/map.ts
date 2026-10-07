import { FURNITURE } from './furniture';
import type { Material } from './tiles';

// Planta do escritório (64×35 tiles de 16 px), visto de cima em 3/4.
// Linha de cima: Conselho · CEO · Financeiro & Cofre · Reunião · Servidores · Copa
// Corredor com recepção e entrada à esquerda.
// Linha de baixo: Produto · Engenharia · QA/Segurança · Growth
// Paredes horizontais têm 3 linhas (topo + 2 de face); verticais, 1 coluna.

export const MAP_W = 64;
export const MAP_H = 35;

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface RoomDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  material: Material;
  team?: string;
}

export interface Placement {
  key: string;
  tx: number;
  /** Linha do tile onde fica a base do objeto. */
  ty: number;
  dx?: number;
  dy?: number;
  name?: string;
}

export interface SpotDef {
  name: string;
  tx: number;
  ty: number;
  dx?: number;
  dy?: number;
  facing: Facing;
  sit: boolean;
  room: string;
}

export const ROOMS: RoomDef[] = [
  { id: 'conselho', label: 'Sala do Conselho', x: 1, y: 3, w: 10, h: 8, material: 'board' },
  { id: 'ceo', label: 'Sala da CEO', x: 12, y: 3, w: 10, h: 8, material: 'marble' },
  { id: 'financeiro', label: 'Financeiro & Cofre', x: 23, y: 3, w: 11, h: 8, material: 'woodDark' },
  { id: 'reuniao', label: 'Sala de Reunião', x: 35, y: 3, w: 11, h: 8, material: 'wood' },
  { id: 'servidores', label: 'Servidores', x: 47, y: 3, w: 6, h: 8, material: 'metal' },
  { id: 'copa', label: 'Copa', x: 54, y: 3, w: 9, h: 8, material: 'copa' },
  { id: 'corredor', label: 'Recepção', x: 1, y: 14, w: 62, h: 3, material: 'stone' },
  { id: 'produto', label: 'Produto', x: 1, y: 20, w: 14, h: 14, material: 'produto', team: 'produto' },
  { id: 'engenharia', label: 'Engenharia', x: 16, y: 20, w: 16, h: 14, material: 'engenharia', team: 'engenharia' },
  { id: 'qa', label: 'QA / Segurança', x: 33, y: 20, w: 14, h: 14, material: 'qa', team: 'qa' },
  { id: 'growth', label: 'Growth', x: 48, y: 20, w: 15, h: 14, material: 'growth', team: 'growth' },
];

/** Portas: [x0, largura, linhaInicial, altura] — cortam a parede de 3 linhas. */
export const DOORS: [number, number, number, number][] = [
  [5, 2, 11, 3],
  [16, 2, 11, 3],
  [28, 2, 11, 3],
  [40, 2, 11, 3],
  [49, 2, 11, 3],
  [57, 2, 11, 3],
  [7, 2, 17, 3],
  [23, 2, 17, 3],
  [39, 2, 17, 3],
  [55, 2, 17, 3],
  [0, 1, 14, 3], // entrada
];

const placements: Placement[] = [];
const spots: SpotDef[] = [];

const put = (key: string, tx: number, ty: number, extra: Partial<Placement> = {}) => {
  if (!FURNITURE[key]) throw new Error(`móvel desconhecido no mapa: ${key}`);
  placements.push({ key, tx, ty, ...extra });
};
const spot = (name: string, tx: number, ty: number, facing: Facing, sit: boolean, room: string, extra: Partial<SpotDef> = {}) =>
  spots.push({ name, tx, ty, facing, sit, room, ...extra });
/** Objetos de parede: base alinhada acima do rodapé da face inferior. */
const wall = (key: string, tx: number, faceRow: number, dx = 0, dy = -4) => put(key, tx, faceRow, { dx, dy });

// ---------------------------------------------------------------- Conselho
wall('window_night', 1, 2);
wall('tv', 5, 2, -8, -6);
wall('window_night', 8, 2);
put('board_table', 3, 8);
put('chair_front_red', 3, 5);
put('throne', 5, 5, { dx: 8 });
put('chair_front_red', 8, 5);
put('chair_back_red', 4, 9);
put('chair_back_red', 7, 9);
put('plant_big_0', 1, 3);
put('plant_big_1', 10, 3);
put('lamp', 1, 10);
spot('board:throne', 5, 5, 'down', true, 'conselho', { dx: 8 });
spot('board:1', 4, 9, 'up', true, 'conselho');
spot('board:2', 7, 9, 'up', true, 'conselho');
spot('board:visit', 9, 9, 'left', false, 'conselho');

// ---------------------------------------------------------------- CEO
wall('window_night', 14, 2);
wall('window_night', 17, 2);
put('bookshelf_0', 12, 3);
put('trophy_cabinet', 19, 3);
put('plant_big_0', 21, 3);
put('chair_ceo', 16, 5, { dx: 8 });
put('ceo_desk', 15, 6);
put('rug_blue', 14, 9, { dx: 8 });
put('globe', 12, 7);
put('lamp', 21, 9);
spot('ceo', 16, 5, 'down', true, 'ceo', { dx: 8 });
spot('ceo:visit', 16, 8, 'up', false, 'ceo');
spot('ceo:visit2', 18, 8, 'up', false, 'ceo');

// ---------------------------------------------------------------- Financeiro & Cofre
wall('window_night', 24, 2);
wall('window_night', 31, 2);
put('vault', 27, 4);
put('filing', 32, 4);
put('filing', 33, 4);
put('plant_big_1', 23, 4);
put('desk_2', 24, 7);
put('chair_back', 24, 8, { dx: 8 });
put('printer', 33, 8);
put('plant_small', 23, 10);
spot('staff:financeiro', 24, 8, 'up', true, 'financeiro', { dx: 8 });
spot('vault', 28, 6, 'up', false, 'financeiro');

// ---------------------------------------------------------------- Reunião
wall('whiteboard_review', 36, 2);
wall('window_night', 39, 2);
wall('tv', 42, 2, 0, -6);
put('meeting_table', 38, 8);
for (const x of [38, 40, 42]) {
  put('chair_front', x, 5);
  put('chair_back', x, 9);
}
put('plant_big_0', 35, 3);
put('plant_big_1', 45, 3);
put('water_cooler', 45, 9);
[38, 40, 42].forEach((x, i) => spot(`meeting:${i + 1}`, x, 5, 'down', true, 'reuniao'));
[38, 40, 42].forEach((x, i) => spot(`meeting:${i + 4}`, x, 9, 'up', true, 'reuniao'));

// ---------------------------------------------------------------- Servidores
wall('ac_unit', 48, 2, 0, -8);
for (const x of [48, 49, 50, 51]) {
  put(x % 2 ? 'server_rack_1' : 'server_rack_0', x, 5);
  put(x % 2 ? 'server_rack_0' : 'server_rack_1', x, 8);
}
spot('servers', 50, 7, 'up', false, 'servidores');

// ---------------------------------------------------------------- Copa
put('kitchen_counter', 54, 3);
put('fridge', 58, 3);
wall('window_night', 59, 2);
put('arcade', 61, 3);
put('vending', 62, 3);
put('rug_green', 55, 9, { dx: 0 });
put('sofa', 55, 7);
put('round_table', 60, 7);
put('stool', 59, 8);
put('stool', 62, 8);
put('plant_big_0', 54, 10);
put('plant_small', 62, 10);
[55, 56, 57].forEach((x, i) => spot(`copa:sofa:${i + 1}`, x, 7, 'down', true, 'copa'));
spot('copa:stool:1', 59, 8, 'down', true, 'copa');
spot('copa:stool:2', 62, 8, 'down', true, 'copa');
[
  [55, 5, 'up'],
  [57, 5, 'up'],
  [59, 5, 'up'],
  [61, 5, 'up'],
  [60, 9, 'left'],
  [58, 10, 'up'],
  [56, 10, 'right'],
].forEach(([x, y, f], i) => spot(`copa:stand:${i + 1}`, x as number, y as number, f as Facing, false, 'copa'));

// ---------------------------------------------------------------- Corredor e recepção
put('doormat', 0, 15, { dy: 0 });
put('chair_front', 4, 14, { dx: 8 });
put('reception', 3, 15);
wall('sign_conselho', 2, 13, 0, -10);
wall('logo', 8, 13, 4, -8);
wall('sign_ceo', 18, 13, 4, -10);
wall('sign_financeiro', 30, 13, 4, -10);
wall('sign_reuniao', 42, 13, 4, -10);
wall('sign_servidores', 51, 13, 4, -10);
wall('sign_copa', 59, 13, 6, -10);
wall('painting_0', 21, 13, 0, -6);
wall('clock', 34, 13, 1, -10);
wall('painting_1', 45, 13, 4, -6);
put('bench', 31, 14);
put('bench', 43, 14, { dx: 8 });
put('plant_big_0', 14, 14);
put('lamp', 26, 14);
put('lamp', 36, 14);
put('plant_big_1', 47, 14);
put('plant_big_0', 62, 14);
spot('staff:secretaria', 4, 14, 'down', true, 'corredor', { dx: 8 });
spot('entrance', 0, 15, 'right', false, 'corredor');
spot('corredor:1', 20, 15, 'down', false, 'corredor');
spot('corredor:2', 36, 15, 'down', false, 'corredor');

// ---------------------------------------------------------------- times
interface TeamDecor {
  room: string;
  extras: (x0: number, w: number) => void;
}

const TEAMS: TeamDecor[] = [
  {
    room: 'produto',
    extras: (x0, w) => {
      wall('whiteboard_plan', x0 + w - 4, 19);
      put('bookshelf_1', x0, 33);
      put('plant_small', x0 + w - 1, 33);
    },
  },
  {
    room: 'engenharia',
    extras: (x0, w) => {
      wall('whiteboard_review', x0 + w - 4, 19);
      put('water_cooler', x0, 33);
      put('printer', x0 + w - 1, 33);
      put('rug_blue', x0 + Math.floor(w / 2) - 1, 29, { dx: -8 });
    },
  },
  {
    room: 'qa',
    extras: (x0, w) => {
      wall('painting_1', x0 + w - 4, 19, 4, -6);
      put('filing', x0, 33);
      put('filing', x0 + w - 1, 33);
    },
  },
  {
    room: 'growth',
    extras: (x0, w) => {
      wall('painting_0', x0 + w - 4, 19, 4, -6);
      put('sofa_green', x0 + Math.floor(w / 2) - 1, 33);
      put('lamp', x0 + w - 1, 33);
    },
  },
];

for (const t of TEAMS) {
  const room = ROOMS.find((r) => r.id === t.room)!;
  const x0 = room.x;
  const w = room.w;
  const mid = x0 + Math.floor(w / 2) - 1;
  wall(`kanban_${t.room}`, x0 + 1, 19);
  wall(`sign_${t.room}`, x0 + 4, 19, 6, -12);
  put('plant_big_0', x0, 20);
  put('plant_big_1', x0 + w - 1, 20);
  // líder: mesa larga ao norte
  put('desk_lead', mid, 22);
  put('chair_back', mid + 1, 23);
  spot(`lead:${t.room}`, mid + 1, 23, 'up', true, t.room);
  spot(`lead_visit:${t.room}`, mid + 3, 23, 'left', false, t.room);
  // trabalhadores: 2 fileiras × 2
  const cols = [x0 + 2, x0 + w - 4];
  const rows = [26, 30];
  let n = 0;
  rows.forEach((row) => {
    cols.forEach((col, ci) => {
      n += 1;
      put(`desk_${(n + ci + t.room.length) % 4}`, col, row);
      put('chair_back', col, row + 1, { dx: 8 });
      spot(`desk:${t.room}:${n}`, col, row + 1, 'up', true, t.room, { dx: 8 });
    });
  });
  // pontos de circulação
  spot(`${t.room}:stand:1`, x0 + Math.floor(w / 2), 28, 'up', false, t.room);
  spot(`${t.room}:stand:2`, x0 + Math.floor(w / 2), 32, 'down', false, t.room);
  t.extras(x0, w);
}

export const PLACEMENTS: Placement[] = placements;
export const SPOTS: SpotDef[] = spots;

// ---------------------------------------------------------------- grade

export type CellKind = 'floor' | 'wall';

export interface Cell {
  kind: CellKind;
  material: Material | null;
  room: string | null;
}

export function buildGrid(): Cell[][] {
  const grid: Cell[][] = Array.from({ length: MAP_H }, () =>
    Array.from({ length: MAP_W }, () => ({ kind: 'wall' as CellKind, material: null, room: null })),
  );
  for (const r of ROOMS) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = { kind: 'floor', material: r.material, room: r.id };
    }
  }
  for (const [x0, w, y0, h] of DOORS) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) grid[y][x] = { kind: 'floor', material: x0 === 0 ? 'mat' : 'stone', room: 'porta' };
    }
  }
  return grid;
}

/** Grade de caminhada (0 = livre, 1 = bloqueado) para o easystar. */
export function walkGrid(grid: Cell[][] = buildGrid()): number[][] {
  const walk = grid.map((row) => row.map((c) => (c.kind === 'floor' ? 0 : 1)));
  for (const p of PLACEMENTS) {
    const meta = FURNITURE[p.key].meta;
    const [fw, fh] = meta.footprint;
    for (let j = 0; j < fh; j++) {
      for (let i = 0; i < fw; i++) {
        const x = p.tx + i;
        const y = p.ty - j;
        if (walk[y]?.[x] !== undefined) walk[y][x] = 1;
      }
    }
  }
  for (const s of SPOTS) if (walk[s.ty]?.[s.tx] !== undefined) walk[s.ty][s.tx] = 0;
  return walk;
}
