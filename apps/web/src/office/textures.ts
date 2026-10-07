import Phaser from 'phaser';
import { buildSheet, CHAR_H, CHAR_W, drawText, FRAMES, Img, lookFor, mix, type FrameName } from '@office/pixel-art';
import type { AgentView } from '@office/contracts';

// Texturas geradas em tempo de execução: folhas de personagem por agente,
// quadros das telas dos monitores, LEDs dos servidores, luzes e partículas.

export function imgToCanvas(img: Img): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.w;
  canvas.height = img.h;
  const ctx = canvas.getContext('2d')!;
  const data = new ImageData(new Uint8ClampedArray(img.data), img.w, img.h);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Adiciona uma textura com quadros horizontais de mesmo tamanho. */
function addFramed(scene: Phaser.Scene, key: string, frames: Img[]): void {
  if (scene.textures.exists(key)) return;
  const w = frames[0].w;
  const h = frames[0].h;
  const strip = new Img(w * frames.length, h);
  frames.forEach((f, i) => strip.blit(f, i * w, 0));
  const tex = scene.textures.addCanvas(key, imgToCanvas(strip))!;
  frames.forEach((_, i) => tex.add(i, 0, i * w, 0, w, h));
}

// ---------------------------------------------------------------- personagens

export const ANIMS = {
  walk_down: ['down_walk1', 'down_idle', 'down_walk2', 'down_idle'],
  walk_up: ['up_walk1', 'up_idle', 'up_walk2', 'up_idle'],
  walk_side: ['side_walk1', 'side_idle', 'side_walk2', 'side_idle'],
  type: ['sit_back_1', 'sit_back_2'],
  talk: ['sit_front', 'sit_front_talk'],
  celebrate: ['celebrate_1', 'celebrate_2'],
} satisfies Record<string, FrameName[]>;

export function agentTexture(scene: Phaser.Scene, agent: Pick<AgentView, 'id' | 'seed' | 'level' | 'roleId'>, teamColor: string): string {
  const key = `agent:${agent.id}:${agent.seed}:${teamColor}:${agent.level}`;
  if (scene.textures.exists(key)) return key;
  const look = lookFor(agent.seed, { teamColor, level: agent.level, roleId: agent.roleId });
  const { img } = buildSheet(look);
  const tex = scene.textures.addCanvas(key, imgToCanvas(img))!;
  FRAMES.forEach((name, i) => tex.add(name, 0, i * CHAR_W, 0, CHAR_W, CHAR_H));
  const rates: Record<string, number> = { walk_down: 8, walk_up: 8, walk_side: 8, type: 7, talk: 5, celebrate: 4 };
  for (const [anim, frames] of Object.entries(ANIMS)) {
    scene.anims.create({
      key: `${key}:${anim}`,
      frames: frames.map((frame) => ({ key, frame })),
      frameRate: rates[anim],
      repeat: -1,
    });
  }
  return key;
}

/** Retrato para os painéis React (data URL do quadro de frente, recortado). */
const portraitCache = new Map<string, string>();
export function portraitUrl(agent: Pick<AgentView, 'id' | 'seed' | 'level' | 'roleId'>, teamColor: string): string {
  const key = `${agent.id}:${agent.seed}:${teamColor}:${agent.level}`;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const look = lookFor(agent.seed, { teamColor, level: agent.level, roleId: agent.roleId });
  const { img } = buildSheet(look);
  const head = img.sub(0, 0, CHAR_W, 17);
  const url = imgToCanvas(head).toDataURL();
  portraitCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------- telas e LEDs

const CODE = ['#5eead4', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#93c5fd'];

export type ScreenKind = 'code' | 'test' | 'fail' | 'ok' | 'idle' | 'think' | 'web' | 'off';

function screenFrame(kind: ScreenKind, i: number): Img {
  const g = new Img(16, 8);
  g.rect(0, 0, 16, 8, kind === 'fail' && i % 2 === 0 ? '#3a0d16' : kind === 'off' ? '#0a0d14' : '#0f1b2d');
  if (kind === 'off') {
    if (i < 4) g.px(15, 7, '#1f6b3a');
    return g;
  }
  let s = 1234 + i * 977;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  switch (kind) {
    case 'code':
      for (let row = 0; row < 4; row++) {
        const y = (row * 2 + (8 - (i % 8))) % 8;
        const indent = Math.floor(rnd() * 4);
        g.hline(1 + indent, y, 3 + Math.floor(rnd() * 9), CODE[Math.floor(rnd() * CODE.length)]);
      }
      if (i % 2) g.px(14, 7, '#ffffff');
      break;
    case 'test': {
      const done = (i % 8) + 1;
      g.rect(1, 1, 14, 2, '#1f2937').rect(1, 1, Math.round((14 * done) / 8), 2, '#fbbf24');
      for (let k = 0; k < done && k < 6; k++) g.px(2 + k * 2, 5, '#4ade80');
      break;
    }
    case 'fail':
      g.rect(6, 1, 4, 1, '#ff5470').px(7, 2, '#ff5470').px(8, 2, '#ff5470');
      g.hline(2, 5, 12, '#ff5470').hline(4, 6, 8, '#fca5a5');
      break;
    case 'ok':
      g.px(5, 4, '#4ade80')
        .px(6, 5, '#4ade80')
        .px(7, 6, '#4ade80')
        .px(8, 5, '#4ade80')
        .px(9, 4, '#4ade80')
        .px(10, 3, '#4ade80')
        .px(11, 2, '#4ade80');
      break;
    case 'think':
      for (let k = 0; k < 3; k++) g.px(5 + k * 3, 4, k === i % 3 ? '#e9e5ff' : '#4b4a80');
      break;
    case 'web':
      g.rect(1, 1, 14, 1, '#334155')
        .rect(2, 3, 8 + (i % 3), 1, '#93c5fd')
        .rect(2, 5, 6 + ((i + 1) % 4), 1, '#64748b');
      break;
    case 'idle':
      for (let k = 0; k < 3; k++) g.px(Math.floor(rnd() * 16), Math.floor(rnd() * 8), mix('#0f1b2d', '#a78bfa', 0.4 + rnd() * 0.6));
      break;
  }
  return g;
}

function ledsFrame(i: number, mode: 'idle' | 'busy' | 'fail' | 'ok'): Img {
  const g = new Img(3, 26);
  let s = 77 + i * 131;
  for (let u = 0; u < 7; u++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const y = u * 4;
    const on = (s >>> 16) % (mode === 'busy' ? 2 : 4) !== 0;
    const color = mode === 'fail' ? '#ff5470' : mode === 'ok' ? '#4ade80' : on ? '#4ade80' : '#14532d';
    g.px(0, y, color);
    g.px(2, y, mode === 'busy' && (s >>> 20) % 2 ? '#fbbf24' : '#6b4f13');
  }
  return g;
}

function arcadeFrame(i: number): Img {
  const g = new Img(10, 8);
  g.rect(0, 0, 10, 8, '#1f3b5a');
  const bx = Math.abs(((i * 1.3) % 16) - 8);
  g.px(Math.round(bx) + 1, 1 + (i % 6), '#ffffff');
  g.vline(0, 2 + (i % 3), 3, '#ff4fa3').vline(9, 4 - (i % 3), 3, '#5eead4');
  return g;
}

function radialLight(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

function pixelsTexture(scene: Phaser.Scene, key: string, rows: string[], legend: Record<string, string>): void {
  if (scene.textures.exists(key)) return;
  const g = new Img(rows[0].length, rows.length).grid(rows, legend);
  scene.textures.addCanvas(key, imgToCanvas(g));
}

export function createSharedTextures(scene: Phaser.Scene): void {
  const kinds: ScreenKind[] = ['code', 'test', 'fail', 'ok', 'idle', 'think', 'web', 'off'];
  for (const k of kinds) {
    addFramed(
      scene,
      `screen:${k}`,
      Array.from({ length: 8 }, (_, i) => screenFrame(k, i)),
    );
    scene.anims.create({
      key: `screen:${k}`,
      frames: Array.from({ length: 8 }, (_, i) => ({ key: `screen:${k}`, frame: i })),
      frameRate: k === 'code' ? 9 : k === 'fail' ? 4 : k === 'idle' ? 2 : 5,
      repeat: -1,
    });
  }
  for (const mode of ['idle', 'busy', 'fail', 'ok'] as const) {
    addFramed(
      scene,
      `leds:${mode}`,
      Array.from({ length: 6 }, (_, i) => ledsFrame(i, mode)),
    );
    scene.anims.create({
      key: `leds:${mode}`,
      frames: Array.from({ length: 6 }, (_, i) => ({ key: `leds:${mode}`, frame: i })),
      frameRate: mode === 'busy' ? 14 : mode === 'idle' ? 3 : 6,
      repeat: -1,
    });
  }
  addFramed(
    scene,
    'arcade',
    Array.from({ length: 12 }, (_, i) => arcadeFrame(i)),
  );
  scene.anims.create({
    key: 'arcade',
    frames: Array.from({ length: 12 }, (_, i) => ({ key: 'arcade', frame: i })),
    frameRate: 8,
    repeat: -1,
  });
  if (!scene.textures.exists('light')) scene.textures.addCanvas('light', radialLight());

  pixelsTexture(scene, 'coin', ['.yy.', 'yYYy', 'yYYy', '.yy.'], { y: '#c48f2c', Y: '#f2c14e' });
  pixelsTexture(scene, 'spark', ['.w.', 'www', '.w.'], { w: '#ffffff' });
  pixelsTexture(scene, 'confetti', ['cc', 'cc'], { c: '#ffffff' });
  pixelsTexture(scene, 'steam', ['.s', 's.', '.s'], { s: 'rgba(255,255,255,0.7)' });
  pixelsTexture(scene, 'dot', ['w'], { w: '#ffffff' });
}

/** Desenha texto da fonte 3×5 numa textura de canvas (contador do cofre, TVs). */
export function writeTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (img: Img) => void): void {
  const img = new Img(w, h);
  draw(img);
  const canvas = imgToCanvas(img);
  if (scene.textures.exists(key)) {
    const tex = scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0);
    tex.refresh();
  } else {
    const tex = scene.textures.createCanvas(key, w, h)!;
    tex.getContext().drawImage(canvas, 0, 0);
    tex.refresh();
  }
}

export { drawText };
