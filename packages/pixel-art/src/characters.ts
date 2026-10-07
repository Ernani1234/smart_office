import { darken, Img, lighten, mix } from './raster';
import { INK, PALETTE } from './palette';

// Personagens 16×24 desenhados por código: corpo procedural + cabelo em grade,
// com paleta trocada por agente (pele, cabelo, roupa do time). Cada agente vira
// uma folha de quadros gerada na hora no navegador.

export const CHAR_W = 16;
export const CHAR_H = 24;

export type HairStyle = 'short' | 'bob' | 'long' | 'spiky' | 'bun' | 'curly' | 'buzz' | 'ponytail' | 'sidepart';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  shoes: string;
  accent: string;
  glasses: boolean;
  headset: boolean;
  tie: boolean;
  blush: boolean;
  jacket: boolean;
}

export const FRAMES = [
  'down_idle',
  'down_walk1',
  'down_walk2',
  'up_idle',
  'up_walk1',
  'up_walk2',
  'side_idle',
  'side_walk1',
  'side_walk2',
  'sit_back_1',
  'sit_back_2',
  'sit_front',
  'sit_front_talk',
  'celebrate_1',
  'celebrate_2',
  'sleep',
] as const;
export type FrameName = (typeof FRAMES)[number];

type View = 'down' | 'up' | 'side';

interface Pose {
  view: View;
  /** -1 perna esquerda à frente, 1 direita, 0 parado */
  step: -1 | 0 | 1;
  sit: 'none' | 'back' | 'front';
  arms: 'down' | 'up' | 'type1' | 'type2';
  eyes: 'open' | 'closed';
  mouth: boolean;
}

const POSES: Record<FrameName, Pose> = {
  down_idle: { view: 'down', step: 0, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  down_walk1: { view: 'down', step: -1, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  down_walk2: { view: 'down', step: 1, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  up_idle: { view: 'up', step: 0, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  up_walk1: { view: 'up', step: -1, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  up_walk2: { view: 'up', step: 1, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  side_idle: { view: 'side', step: 0, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  side_walk1: { view: 'side', step: -1, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  side_walk2: { view: 'side', step: 1, sit: 'none', arms: 'down', eyes: 'open', mouth: false },
  sit_back_1: { view: 'up', step: 0, sit: 'back', arms: 'type1', eyes: 'open', mouth: false },
  sit_back_2: { view: 'up', step: 0, sit: 'back', arms: 'type2', eyes: 'open', mouth: false },
  sit_front: { view: 'down', step: 0, sit: 'front', arms: 'down', eyes: 'open', mouth: false },
  sit_front_talk: { view: 'down', step: 0, sit: 'front', arms: 'down', eyes: 'open', mouth: true },
  celebrate_1: { view: 'down', step: 0, sit: 'none', arms: 'up', eyes: 'open', mouth: true },
  celebrate_2: { view: 'down', step: 1, sit: 'none', arms: 'up', eyes: 'closed', mouth: true },
  sleep: { view: 'down', step: 0, sit: 'front', arms: 'down', eyes: 'closed', mouth: false },
};

// ---------------------------------------------------------------- cabelos
// Grades de 12 colunas alinhadas em x = 2 e y = 0 (cabeça ocupa x 4..11, y 3..10).
// h = cabelo, H = sombra, l = brilho.

type HairSet = Record<View, string[]>;

const HAIR: Record<HairStyle, HairSet> = {
  short: {
    down: ['............', '....hhhh....', '..hhhhhhhh..', '.hhlhhhhhhh.', '.hhhhhhhhhh.', '.hhhHhhhHhh.', '.hH......Hh.', '.H........H.'],
    up: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.HhhhhhhhhH.',
      '..HHhhhhHH..',
    ],
    side: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhhlhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhHh...',
      '.hhhhh......',
      '.hhhH.......',
      '.HhH........',
      '..H.........',
    ],
  },
  sidepart: {
    down: ['............', '...hhhhhh...', '..hhhhhhhhh.', '.hlhhhhhhhhh', '.hhhhhhhhhhh', '.hhhhhhHHhhh', '.hH.......Hh', '.H.........H'],
    up: [
      '............',
      '...hhhhhh...',
      '..hhhhhhhhh.',
      '.hhlhhhhhhhh',
      '.hhhhhhhhhhh',
      '.hhhhhhhhhhh',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.HhhhhhhhhH.',
      '..HHhhhhHH..',
    ],
    side: [
      '............',
      '...hhhhhh...',
      '..hhhhhhhhh.',
      '.hhhlhhhhhhh',
      '.hhhhhhhhhh.',
      '.hhhhhhH....',
      '.hhhhh......',
      '.hhhH.......',
      '.HhH........',
      '..H.........',
    ],
  },
  bob: {
    down: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      'hhhHhhhhHhhh',
      'hhH......Hhh',
      'hh........hh',
      'hh........hh',
      'Hh........hH',
      '.H........H.',
    ],
    up: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'HhhhhhhhhhhH',
      '.HHhhhhhhHH.',
    ],
    side: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhhlhhhhhh.',
      '.hhhhhhhhhh.',
      'hhhhhhhHh...',
      'hhhhhh......',
      'hhhhh.......',
      'hhhhH.......',
      'HhhH........',
      '.HH.........',
    ],
  },
  long: {
    down: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      'hhhhHhhHhhhh',
      'hhH......Hhh',
      'hh........hh',
      'hh........hh',
      'hh........hh',
      'hh........hh',
      'hH........Hh',
      'hH........Hh',
      'H..........H',
    ],
    up: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'HhhhhhhhhhhH',
      'HhhhhhhhhhhH',
      '.HHhhhhhhHH.',
      '...HHHHHH...',
    ],
    side: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhhlhhhhhh.',
      '.hhhhhhhhhh.',
      'hhhhhhhHh...',
      'hhhhhh......',
      'hhhhh.......',
      'hhhhh.......',
      'hhhhH.......',
      'hhhhH.......',
      'HhhH........',
      'HhH.........',
      '.H..........',
    ],
  },
  spiky: {
    down: ['..h..h..h...', '..hh.hh.hh..', '.hhhhhhhhhh.', '.hhlhhhhhhh.', '.hhhhhhhhhh.', '.hHhHhhHhHh.', '.H........H.'],
    up: [
      '..h..h..h...',
      '..hh.hh.hh..',
      '.hhhhhhhhhh.',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.HhhhhhhhhH.',
      '..HHHhhHHH..',
    ],
    side: [
      '...h..h.....',
      '..hh.hh.h...',
      '.hhhhhhhhh..',
      '.hhhlhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhHhH..',
      '.hhhhh......',
      '.hhhH.......',
      '.HhH........',
      '..H.........',
    ],
  },
  bun: {
    down: ['....hhhh....', '....hlhh....', '..hhhhhhhh..', '.hhlhhhhhhh.', '.hhhhhhhhhh.', '.hhhHhhHhhh.', '.hH......Hh.', '.H........H.'],
    up: [
      '....hhhh....',
      '....hlhh....',
      '..hhHHHHhh..',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.HhhhhhhhhH.',
      '..HHhhhhHH..',
    ],
    side: [
      '..hhh.......',
      '..hlhh......',
      '..hhhhhhhh..',
      '.hhhlhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhHh...',
      '.hhhhh......',
      '.hhhH.......',
      '.HhH........',
      '..H.........',
    ],
  },
  curly: {
    down: [
      '...hh.hh....',
      '..hhhhhhhhh.',
      '.hhlhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhHhHhHhhhh',
      'hhH......Hhh',
      'hH........Hh',
      '.H........H.',
    ],
    up: [
      '...hh.hh....',
      '..hhhhhhhhh.',
      '.hhlhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'hhhhhhhhhhhh',
      'HhhhhhhhhhhH',
      '.HHhhhhhhHH.',
    ],
    side: [
      '...hh.hh....',
      '..hhhhhhhh..',
      '.hhhlhhhhhh.',
      'hhhhhhhhhhh.',
      'hhhhhhhhhhh.',
      'hhhhhhhHh...',
      'hhhhhh......',
      'hhhhH.......',
      'HhhH........',
      '.HH.........',
    ],
  },
  buzz: {
    down: ['............', '............', '...HHHHHH...', '..HhhhhhhH..', '..H......H..'],
    up: ['............', '............', '...HHHHHH...', '..HhhhhhhH..', '..HhhhhhhH..', '..HhhhhhhH..', '..HhhhhhhH..', '...HHHHHH...'],
    side: ['............', '............', '...HHHHHH...', '..HhhhhhH...', '..HhhH......', '..HhH.......', '..HH........'],
  },
  ponytail: {
    down: ['............', '....hhhh....', '..hhhhhhhh..', '.hhlhhhhhhh.', '.hhhhhhhhhh.', '.hhhHhhHhhh.', '.hH......Hh.', '.H........H.'],
    up: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhlhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.HhhhHHhhhH.',
      '..HHhhhhHH..',
      '.....hh.....',
      '.....hH.....',
      '.....Hh.....',
      '......H.....',
    ],
    side: [
      '............',
      '....hhhh....',
      '..hhhhhhhh..',
      '.hhhlhhhhhh.',
      'hhhhhhhhhhh.',
      'hhhhhhhHh...',
      'hHhhhh......',
      'hH.hH.......',
      'H..H........',
      'H...........',
    ],
  },
};

// ---------------------------------------------------------------- aparência por semente

const SKINS = ['#f7d7bd', '#efc19f', '#d9a27a', '#b9805a', '#8e5a3c', '#6a3f29'];
const HAIRS = ['#2a1c14', '#4b2e1e', '#7a4a2a', '#c99a4a', '#b8452f', '#1c1b26', '#a7a9b4', '#6b4fa3', '#2f77c4', '#d06a9c', '#e9d9a6'];
const PANTS = ['#2b3247', '#3a2f2a', '#24365a', '#454552', '#2f3d33', '#523a2c'];
const STYLES: HairStyle[] = ['short', 'sidepart', 'bob', 'long', 'spiky', 'bun', 'curly', 'buzz', 'ponytail'];

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Aparência determinística a partir da semente do agente e da cor do time. */
export function lookFor(seed: number, opts: { teamColor: string; level: string; roleId: string }): Look {
  const r = rnd(seed);
  const pick = <T>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const skin = pick(SKINS);
  let hair = pick(HAIRS);
  if (r() < 0.7) hair = pick(HAIRS.slice(0, 6)); // cores naturais mais comuns
  const hairStyle = pick(STYLES);
  const exec = opts.level === 'executive';
  const lead = opts.level === 'lead';
  const shirt = exec ? '#3d3270' : lead ? mix(opts.teamColor, '#1d2340', 0.35) : opts.teamColor;
  return {
    skin,
    hair,
    hairStyle,
    shirt,
    pants: exec ? '#24213a' : pick(PANTS),
    shoes: pick(['#1d1a22', '#3b2a22', '#2a2f3d']),
    accent: exec ? '#f2c14e' : lead ? opts.teamColor : '#f4f1ea',
    glasses: r() < 0.3 || opts.roleId === 'financeiro',
    headset: ['dev', 'testador', 'devops', 'secretaria'].includes(opts.roleId) && r() < 0.6,
    tie: exec || opts.roleId === 'financeiro',
    blush: r() < 0.5,
    jacket: exec || lead,
  };
}

// ---------------------------------------------------------------- desenho

interface Colors {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  shirt: string;
  shirtShade: string;
  shirtLight: string;
  pants: string;
  pantsShade: string;
  shoes: string;
  accent: string;
}

function colorsOf(l: Look): Colors {
  return {
    skin: l.skin,
    skinShade: darken(l.skin, 0.22),
    hair: l.hair,
    hairShade: darken(l.hair, 0.3),
    hairLight: lighten(l.hair, 0.28),
    shirt: l.shirt,
    shirtShade: darken(l.shirt, 0.28),
    shirtLight: lighten(l.shirt, 0.2),
    pants: l.pants,
    pantsShade: darken(l.pants, 0.3),
    shoes: l.shoes,
    accent: l.accent,
  };
}

function drawHair(img: Img, l: Look, c: Colors, view: View, dy: number): void {
  const rows = HAIR[l.hairStyle][view];
  img.grid(rows, { h: c.hair, H: c.hairShade, l: c.hairLight }, 2, 0 + dy);
}

function drawHead(img: Img, l: Look, c: Colors, p: Pose, dy: number): void {
  // cabeça 8×8 (x 4..11, y 3..10) com cantos arredondados
  img.rounded(4, 3 + dy, 8, 8, c.skin);
  if (p.view === 'down') {
    img.hline(5, 10 + dy, 6, c.skinShade); // queixo
    if (p.eyes === 'open') {
      img.vline(6, 7 + dy, 2, INK).vline(9, 7 + dy, 2, INK);
      img.px(6, 7 + dy, '#3a3352').px(9, 7 + dy, '#3a3352');
    } else {
      img.hline(5, 8 + dy, 2, INK).hline(9, 8 + dy, 2, INK);
    }
    if (l.blush) img.px(5, 9 + dy, 'rgba(232,110,120,0.55)').px(10, 9 + dy, 'rgba(232,110,120,0.55)');
    if (p.mouth) img.hline(7, 9 + dy, 2, '#7a2e3a');
    if (l.glasses && p.eyes === 'open') {
      // armação fina na linha dos olhos: lente clara em cima, olho escuro embaixo
      img
        .px(5, 7 + dy, '#3b3550')
        .px(7, 7 + dy, '#3b3550')
        .px(8, 7 + dy, '#3b3550')
        .px(10, 7 + dy, '#3b3550');
      img.px(6, 7 + dy, '#cfeaff').px(9, 7 + dy, '#cfeaff');
    }
  } else if (p.view === 'side') {
    img.px(12, 8 + dy, c.skin); // nariz
    img.vline(10, 7 + dy, 2, INK);
    img.vline(6, 7 + dy, 2, c.skinShade); // orelha
    if (l.glasses)
      img
        .rect(9, 6 + dy, 3, 3, 'rgba(30,26,46,0.9)')
        .px(10, 7 + dy, '#bfe6ff')
        .px(10, 8 + dy, INK);
  }
  drawHair(img, l, c, p.view, dy);
  if (l.headset) {
    const band = '#3a3a48';
    if (p.view === 'side') {
      img.rect(5, 6 + dy, 2, 3, band).px(5, 7 + dy, '#6b6b7d');
      img.px(7, 9 + dy, band).px(8, 9 + dy, '#e05555');
    } else {
      // arco por cima do cabelo + conchas nas laterais
      img
        .hline(5, 1 + dy, 6, band)
        .px(4, 2 + dy, band)
        .px(11, 2 + dy, band);
      img.rect(2, 6 + dy, 2, 3, band).rect(12, 6 + dy, 2, 3, band);
      img.px(2, 7 + dy, '#6b6b7d').px(13, 7 + dy, '#6b6b7d');
      if (p.view === 'down') img.px(11, 9 + dy, '#e05555');
    }
  }
}

function drawTorso(img: Img, l: Look, c: Colors, p: Pose, dy: number): void {
  // pescoço
  img.hline(7, 11 + dy, 2, c.skinShade);
  if (p.view === 'side') {
    img.rect(6, 12 + dy, 5, 6, c.shirt);
    img.vline(6, 13 + dy, 5, c.shirtShade);
    // braço na frente do tronco, balançando com o passo
    const ay = p.step === 0 ? 0 : p.step === -1 ? -1 : 1;
    img.rect(8, 13 + dy + ay, 2, 4, c.shirtShade);
    img.rect(8, 17 + dy + ay, 2, 1, c.skin);
    return;
  }
  // ombros arredondados + tronco
  img.hline(5, 12 + dy, 6, c.shirt);
  img.rect(4, 13 + dy, 8, 5, c.shirt);
  img.hline(5, 12 + dy, 6, c.shirtLight);
  if (l.jacket) {
    img.rect(4, 13 + dy, 2, 5, c.shirtShade);
    img.rect(10, 13 + dy, 2, 5, c.shirtShade);
  }
  if (p.view === 'down') {
    img.hline(7, 12 + dy, 2, c.accent); // gola
    if (l.tie) img.vline(7, 13 + dy, 4, '#c0392b').vline(8, 13 + dy, 3, '#a93226');
    else img.px(10, 14 + dy, c.accent); // crachá
  }
  // braços
  if (p.arms === 'up') {
    img.rect(2, 8 + dy, 2, 5, c.shirtShade).rect(12, 8 + dy, 2, 5, c.shirtShade);
    img.rect(2, 7 + dy, 2, 1, c.skin).rect(12, 7 + dy, 2, 1, c.skin);
    return;
  }
  if (p.arms === 'type1' || p.arms === 'type2') {
    const k = p.arms === 'type1' ? 0 : 1;
    img.rect(3, 13 + dy, 1, 3 - k, c.shirtShade).rect(12, 13 + dy, 1, 2 + k, c.shirtShade);
    img.px(3, 16 + dy - k, c.skin).px(12, 15 + dy + k, c.skin);
    return;
  }
  const swing = p.view === 'down' || p.view === 'up' ? p.step : 0;
  img.rect(3, 13 + dy + (swing === -1 ? -1 : 0), 1, 4, c.shirtShade);
  img.rect(12, 13 + dy + (swing === 1 ? -1 : 0), 1, 4, c.shirtShade);
  img.px(3, 17 + dy + (swing === -1 ? -1 : 0), c.skin);
  img.px(12, 17 + dy + (swing === 1 ? -1 : 0), c.skin);
}

function drawLegs(img: Img, c: Colors, p: Pose, dy: number): void {
  if (p.sit === 'back') return; // a cadeira cobre
  if (p.sit === 'front') {
    img.rect(5, 18 + dy, 6, 2, c.pants);
    img.hline(5, 19 + dy, 6, c.pantsShade);
    img.rect(5, 20 + dy, 2, 1, c.shoes).rect(9, 20 + dy, 2, 1, c.shoes);
    return;
  }
  if (p.view === 'side') {
    img.rect(6, 18 + dy, 5, 1, c.pants);
    if (p.step === 0) {
      img.rect(7, 19 + dy, 3, 3, c.pants).vline(8, 19 + dy, 3, c.pantsShade);
      img.rect(7, 22 + dy, 4, 1, c.shoes);
    } else {
      const front = p.step === 1 ? 9 : 5;
      const back = p.step === 1 ? 5 : 9;
      img.rect(front, 19 + dy, 2, 3, c.pants).rect(front, 22 + dy, 3, 1, c.shoes);
      img.rect(back, 19 + dy, 2, 2, c.pantsShade).rect(back, 21 + dy, 2, 1, c.shoes);
    }
    return;
  }
  // frente / costas
  img.rect(5, 18 + dy, 6, 1, c.pants);
  const lift = (side: -1 | 1) => (p.step !== 0 && p.step !== side ? 1 : 0);
  // perna esquerda (x 5..7) e direita (x 8..10)
  const ll = lift(-1);
  const rl = lift(1);
  img.rect(5, 19 + dy, 3, 3 - ll, c.pants).rect(5, 22 + dy - ll, 3, 1, c.shoes);
  img.rect(8, 19 + dy, 3, 3 - rl, c.pants).rect(8, 22 + dy - rl, 3, 1, c.shoes);
  img.vline(7, 19 + dy, 3 - ll, c.pantsShade);
  img.vline(8, 19 + dy, 3 - rl, darken(c.pants, 0.15));
}

export function drawFrame(look: Look, frame: FrameName): Img {
  const img = new Img(CHAR_W, CHAR_H);
  const p = POSES[frame];
  const c = colorsOf(look);
  // sentado de frente: corpo desce 1px; comemorando: pulinho
  const dy = p.sit === 'front' ? 1 : frame === 'celebrate_2' ? -1 : 0;
  drawLegs(img, c, p, dy);
  drawTorso(img, look, c, p, dy);
  drawHead(img, look, c, p, dy);
  img.outline(INK);
  return img;
}

/** Folha com todos os quadros lado a lado (16 px cada). */
export function buildSheet(look: Look): { img: Img; frames: Record<FrameName, { x: number; y: number; w: number; h: number }> } {
  const img = new Img(CHAR_W * FRAMES.length, CHAR_H);
  const frames = {} as Record<FrameName, { x: number; y: number; w: number; h: number }>;
  FRAMES.forEach((name, i) => {
    img.blit(drawFrame(look, name), i * CHAR_W, 0);
    frames[name] = { x: i * CHAR_W, y: 0, w: CHAR_W, h: CHAR_H };
  });
  return { img, frames };
}

/** Retrato (cabeça e ombros) para o painel lateral. */
export function portrait(look: Look): Img {
  const full = drawFrame(look, 'down_idle');
  return full.sub(0, 0, CHAR_W, 17);
}

export { PALETTE };
