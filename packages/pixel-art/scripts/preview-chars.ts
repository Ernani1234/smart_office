import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { buildSheet, lookFor, CHAR_H, FRAMES, CHAR_W } from '../src/characters';
import { Img } from '../src/raster';

const out = path.resolve(import.meta.dirname, '..', 'preview');
mkdirSync(out, { recursive: true });
const teams = ['#34d399', '#38bdf8', '#c084fc', '#fbbf24', '#8b7cf6', '#94a3b8'];
const levels = ['worker', 'worker', 'lead', 'executive', 'worker', 'staff', 'worker', 'worker', 'worker'];
const roles = ['dev', 'testador', 'lead-x', 'ceo', 'copy', 'financeiro', 'pesquisa', 'dev', 'secretaria'];
const rows = 9;
const sheet = new Img(CHAR_W * FRAMES.length + 8, (CHAR_H + 4) * rows + 4);
sheet.rect(0, 0, sheet.w, sheet.h, '#3a3150');
for (let i = 0; i < rows; i++) {
  const look = lookFor(1234567 + i * 7919, { teamColor: teams[i % teams.length], level: levels[i], roleId: roles[i] });
  const { img } = buildSheet(look);
  sheet.blit(img, 4, 4 + i * (CHAR_H + 4));
}
const big = sheet.scale(5);
const png = new PNG({ width: big.w, height: big.h });
png.data = Buffer.from(big.data);
writeFileSync(path.join(out, 'characters.png'), PNG.sync.write(png));
console.log('ok', big.w, big.h);
