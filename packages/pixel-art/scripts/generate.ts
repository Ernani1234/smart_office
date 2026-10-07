// Gera os assets do escritório: tileset, móveis (PNG) e o mapa Tiled (.tmj)
// em apps/web/public/assets/office. Com --preview, também uma imagem do mapa
// inteiro com personagens nos lugares (packages/pixel-art/preview/map.png).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { buildOffice, renderPreview } from '../src/build';
import { buildSheet, CHAR_H, CHAR_W, drawFrame, lookFor } from '../src/characters';
import { FURNITURE, furnitureImage } from '../src/furniture';
import { SPOTS } from '../src/map';
import { Img } from '../src/raster';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.resolve(here, '..', '..', '..');
const outDir = path.join(root, 'apps', 'web', 'public', 'assets', 'office');
const previewDir = path.resolve(here, '..', 'preview');

function savePng(img: Img, file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  writeFileSync(file, PNG.sync.write(png));
}

const build = buildOffice();
savePng(build.tileset, path.join(outDir, 'tiles.png'));
for (const key of Object.keys(FURNITURE)) savePng(furnitureImage(key), path.join(outDir, 'furniture', `${key}.png`));
writeFileSync(path.join(outDir, 'office.tmj'), `${JSON.stringify(build.tmj, null, 1)}\n`, 'utf8');
console.log(
  `tileset: ${build.tileCount} tiles · móveis: ${Object.keys(FURNITURE).length} · mapa: office.tmj → ${path.relative(root, outDir)}`,
);

if (process.argv.includes('--preview')) {
  const teamColors: Record<string, string> = {
    produto: '#34d399',
    engenharia: '#38bdf8',
    qa: '#c084fc',
    growth: '#fbbf24',
    conselho: '#8b7cf6',
    ceo: '#8b7cf6',
    financeiro: '#94a3b8',
    corredor: '#94a3b8',
    reuniao: '#38bdf8',
    copa: '#f472b6',
    servidores: '#38bdf8',
  };
  const extras: { img: Img; x: number; y: number; depth: number }[] = [];
  let seed = 99;
  for (const s of SPOTS) {
    if (s.name === 'board:throne' || s.name.includes('stand') || s.name.includes('visit') || s.name === 'entrance') continue;
    if (Math.random() < 0.15) continue;
    const look = lookFor((seed += 7919), {
      teamColor: teamColors[s.room] ?? '#94a3b8',
      level: s.name === 'ceo' ? 'executive' : s.name.startsWith('lead') ? 'lead' : 'worker',
      roleId: 'dev',
    });
    const frame = s.sit ? (s.facing === 'up' ? 'sit_back_1' : 'sit_front') : s.facing === 'up' ? 'up_idle' : 'down_idle';
    const img = drawFrame(look, frame);
    const x = s.tx * 16 + 8 + (s.dx ?? 0) - CHAR_W / 2;
    const feet = (s.ty + 1) * 16 - 2;
    const y = feet - CHAR_H + 2 + (s.sit ? (s.facing === 'up' ? -6 : -2) : 0);
    extras.push({ img, x, y, depth: feet });
  }
  const map = renderPreview(build, extras);
  savePng(map.scale(2), path.join(previewDir, 'map.png'));
  const sheet = buildSheet(lookFor(42, { teamColor: '#38bdf8', level: 'worker', roleId: 'dev' })).img;
  savePng(sheet.scale(6), path.join(previewDir, 'sheet.png'));
  console.log(`prévia: ${path.relative(root, previewDir)}/map.png`);
}
