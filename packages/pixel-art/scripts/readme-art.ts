import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawFrame, drawText, Img, lookFor, textWidth, type FrameName } from '../src';

// Arte animada do README (SVG puro, animado por CSS/SMIL, sem scripts nem
// fontes externas — o GitHub renderiza como imagem). Usa a mesma fonte 3×5 e
// os mesmos personagens do escritório. Saída: docs/media/banner.svg e fluxo.svg.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'docs', 'media');
const SANS = "'Segoe UI', Inter, Helvetica, Arial, sans-serif";

// ---------------------------------------------------------------- pixel → SVG

/** Converte um sprite em retângulos (corridas horizontais da mesma cor). */
function rects(img: Img): string {
  const out: string[] = [];
  for (let y = 0; y < img.h; y++) {
    let x = 0;
    while (x < img.w) {
      const [r, g, b, a] = img.get(x, y);
      if (a < 40) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < img.w) {
        const n = img.get(x + run, y);
        if (n[0] !== r || n[1] !== g || n[2] !== b || n[3] < 40) break;
        run++;
      }
      const fill = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      out.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`);
      x += run;
    }
  }
  return out.join('');
}

/** Texto na fonte 3×5 do escritório, `s` px por pixel. */
function pixelText(text: string, x: number, y: number, s: number, fill: string): string {
  const img = new Img(textWidth(text), 5);
  drawText(img, text, 0, 0, fill);
  return `<g transform="translate(${x} ${y}) scale(${s})">${rects(img)}</g>`;
}

function sprite(seed: number, team: string, level: string, roleId: string, frame: FrameName): string {
  return rects(drawFrame(lookFor(seed, { teamColor: team, level, roleId }), frame));
}

// ---------------------------------------------------------------- banner

function banner(): string {
  const W = 1200;
  const H = 320;
  const floorY = 248;
  const people = [
    { seed: 11, team: '#5eead4', level: 'worker', role: 'dev', dur: 17, delay: 0, dir: 1, y: floorY - 52 },
    { seed: 42, team: '#f472b6', level: 'worker', role: 'copy', dur: 21, delay: -8, dir: -1, y: floorY - 40 },
    { seed: 7, team: '#fbbf24', level: 'lead', role: 'lead-growth', dur: 25, delay: -15, dir: 1, y: floorY - 46 },
  ];
  const walkers = people
    .map((p, i) => {
      const a = sprite(p.seed, p.team, p.level, p.role, 'side_walk1');
      const b = sprite(p.seed, p.team, p.level, p.role, 'side_walk2');
      const flip = p.dir < 0 ? 'translate(16 0) scale(-1 1)' : '';
      return `<g class="walk${p.dir < 0 ? ' back' : ''}" style="animation-duration:${p.dur}s;animation-delay:${p.delay}s">
        <g transform="translate(0 ${p.y}) scale(3)"><g transform="${flip}">
          <g class="fa">${a}</g><g class="fb">${b}</g>
        </g></g></g>`.replace(/\n\s*/g, '');
    })
    .join('');

  const party = [
    { seed: 3, team: '#a78bfa', level: 'executive', role: 'ceo', x: 1010 },
    { seed: 19, team: '#4ade80', level: 'staff', role: 'financeiro', x: 1080 },
  ]
    .map(
      (p) =>
        `<g transform="translate(${p.x} ${floorY - 70}) scale(3)"><g class="fa">${sprite(p.seed, p.team, p.level, p.role, 'celebrate_1')}</g><g class="fb">${sprite(p.seed, p.team, p.level, p.role, 'celebrate_2')}</g></g>`,
    )
    .join('');

  const windows: string[] = [];
  for (let i = 0; i < 16; i++) {
    const x = 8 + (i % 4) * 4;
    const y = 9 + Math.floor(i / 4) * 4;
    const lit = i % 5 === 2 ? '#5eead4' : '#f2c14e';
    windows.push(
      `<rect x="${x}" y="${y}" width="3" height="3" class="win" style="--lit:${lit};animation-delay:${((i * 7919) % 3200) / 1000}s"/>`,
    );
  }
  const building = `<g transform="translate(70 34) scale(6.5)">
    <rect x="15" y="1" width="2" height="4" fill="#3d3866"/><rect x="15" y="0" width="2" height="1" fill="#ff5470" class="blink"/>
    <rect x="5" y="5" width="22" height="2" fill="#2d2950"/><rect x="6" y="7" width="20" height="21" fill="#20242f"/>
    <rect x="6" y="7" width="1" height="21" fill="#2a2f3d"/>${windows.join('')}
    <rect x="14" y="25" width="4" height="3" fill="#c98d5a"/></g>`.replace(/\n\s*/g, '');

  const coins = [
    [968, 0],
    [1052, 1.6],
    [968, 3.2],
  ]
    .map(([x, delay]) => `<g class="coin" style="animation-delay:${delay}s">${pixelText('+$17.55', x, 120, 3, '#f2c14e')}</g>`)
    .join('');

  const chips = [
    ['CEO', 'gpt-6-astra', '#a78bfa'],
    ['Líderes', 'gpt-6.1-sol', '#2dd4bf'],
    ['Time', 'gpt-6-luna', '#94a3b8'],
  ];
  let cx = 330;
  const chipSvg = chips
    .map(([label, model, color]) => {
      const w = 22 + model.length * 7.6;
      const s = `<text x="${cx}" y="214" class="lbl">${label}</text>
        <g transform="translate(${cx + label.length * 8 + 8} 198)"><rect width="${w}" height="22" rx="6" fill="${color}" fill-opacity=".1" stroke="${color}" stroke-opacity=".45"/>
        <circle cx="10" cy="11" r="3" fill="${color}"/><text x="18" y="15.5" class="mono" fill="${color}">${model}</text></g>`;
      cx += label.length * 8 + 8 + w + 22;
      return s;
    })
    .join('')
    .replace(/\n\s*/g, '');

  const tiles: string[] = [];
  for (let x = 0; x < W; x += 24) tiles.push(`<rect x="${x}" y="${floorY}" width="12" height="${H - floorY}" fill="#1b1832"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" role="img" aria-label="Pixel Corp — empresa de agentes de IA com escritório em pixel art">
<title>Pixel Corp — empresa de agentes de IA com escritório em pixel art</title>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#110f1f"/><stop offset="1" stop-color="#0c0b16"/></linearGradient>
  <radialGradient id="g1" cx=".25" cy="0" r=".6"><stop offset="0" stop-color="#8b7cf6" stop-opacity=".28"/><stop offset="1" stop-color="#8b7cf6" stop-opacity="0"/></radialGradient>
  <radialGradient id="g2" cx=".9" cy="1" r=".55"><stop offset="0" stop-color="#5eead4" stop-opacity=".16"/><stop offset="1" stop-color="#5eead4" stop-opacity="0"/></radialGradient>
  <clipPath id="clip"><rect width="${W}" height="${H}" rx="20"/></clipPath>
</defs>
<style>
  .win{fill:#0f1b2d;animation:lit 3.2s steps(1,end) infinite}
  @keyframes lit{0%,45%{fill:#0f1b2d}46%,100%{fill:var(--lit)}}
  .blink{animation:blink 1.2s steps(1,end) infinite}
  @keyframes blink{50%{opacity:.15}}
  .fa{animation:fa .5s steps(1,end) infinite}.fb{animation:fb .5s steps(1,end) infinite}
  @keyframes fa{50%{opacity:0}}@keyframes fb{0%{opacity:0}50%{opacity:1}}
  .walk{animation:walk 18s linear infinite}.walk.back{animation-name:back}
  @keyframes walk{from{transform:translateX(-80px)}to{transform:translateX(${W + 40}px)}}
  @keyframes back{from{transform:translateX(${W + 40}px)}to{transform:translateX(-80px)}}
  .coin{opacity:0;animation:coin 4.8s ease-out infinite}
  @keyframes coin{0%{opacity:0;transform:translateY(24px)}12%{opacity:1}60%{opacity:1}100%{opacity:0;transform:translateY(-40px)}}
  .cursor{animation:blink 1s steps(1,end) infinite}
  .sub{font:500 21px ${SANS};fill:#bcb8dc}
  .lbl{font:500 14px ${SANS};fill:#8e89b8}
  .mono{font:600 12.5px Consolas,'JetBrains Mono',Menlo,monospace}
  .tag{font:600 12px ${SANS};letter-spacing:.18em;fill:#8e89b8}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}.coin{opacity:1}}
</style>
<g clip-path="url(#clip)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
  <rect y="${floorY}" width="${W}" height="${H - floorY}" fill="#161429"/>${tiles.join('')}<rect y="${floorY}" width="${W}" height="2" fill="#2d2950"/>
  ${building}
  <text x="330" y="66" class="tag">EMPRESA DE AGENTES DE IA · VOCÊ É O CONSELHO</text>
  ${pixelText('PIXEL', 334, 86, 13, '#07060d')}${pixelText('PIXEL', 330, 82, 13, '#e8e5ff')}
  ${pixelText('CORP', 334 + 6 * 52, 86, 13, '#07060d')}${pixelText('CORP', 330 + 6 * 52, 82, 13, '#5eead4')}
  <rect x="${330 + 10 * 52}" y="134" width="39" height="13" fill="#5eead4" class="cursor"/>
  <text x="330" y="180" class="sub">CEO, líderes e time de IA num escritório em pixel art.</text>
  ${chipSvg}
  ${coins}${party}${walkers}
</g>
</svg>
`;
}

// ---------------------------------------------------------------- fluxo

interface Node {
  id: string;
  x: number;
  y: number;
  title: string;
  sub: string;
  color: string;
}

function flow(): string {
  const W = 1200;
  const H = 350;
  const top = 92;
  const bottom = 292;
  const xs = [90, 240, 390, 540, 690, 840, 990, 1120];
  const nodes: Node[] = [
    { id: 'conselho', x: xs[0], y: top, title: 'Você', sub: 'o Conselho', color: '#f2c14e' },
    { id: 'missao', x: xs[1], y: top, title: 'Missão', sub: 'meta · teto · prazo', color: '#5eead4' },
    { id: 'ceo', x: xs[2], y: top, title: 'CEO', sub: 'gpt-6-astra', color: '#a78bfa' },
    { id: 'lideres', x: xs[3], y: top, title: 'Líderes', sub: 'gpt-6.1-sol', color: '#2dd4bf' },
    { id: 'time', x: xs[4], y: top, title: 'Time', sub: 'gpt-6-luna', color: '#94a3b8' },
    { id: 'ci', x: xs[5], y: top, title: 'CI', sub: '4 portões', color: '#fbbf24' },
    { id: 'revisao', x: xs[6], y: top, title: 'Revisão', sub: '≤ 3 rodadas', color: '#f472b6' },
    { id: 'merge', x: xs[7], y: top, title: 'Merge', sub: 'na main', color: '#4ade80' },
    { id: 'aprova', x: xs[7], y: bottom, title: 'Conselho', sub: 'aprova publicar', color: '#f2c14e' },
    { id: 'lanca', x: 920, y: bottom, title: 'No ar', sub: 'produto lançado', color: '#5eead4' },
    { id: 'vendas', x: 720, y: bottom, title: 'Vendas', sub: 'MoR, lido por código', color: '#4ade80' },
    { id: 'fin', x: 520, y: bottom, title: 'Financeiro', sub: 'lucro líquido', color: '#4ade80' },
    { id: 'meta', x: 320, y: bottom, title: 'Meta batida', sub: 'ou teto · ou prazo', color: '#f2c14e' },
  ];
  // Depois da meta, o relatório volta ao Conselho e o ciclo recomeça.
  const pts = [...nodes.map((n) => [n.x, n.y] as const), [xs[0], bottom] as const, [xs[0], top + 31] as const];
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const at: number[] = [0];
  seg.forEach((s, i) => at.push(at[i] + s / total));
  const D = 14;
  const d = `M${pts.map((p) => p.join(' ')).join(' L')}`;
  const report = `<text x="${xs[0] + 14}" y="${bottom - 50}" class="note2">relatório e</text><text x="${xs[0] + 14}" y="${bottom - 34}" class="note2">post-mortem</text>`;

  const cards = nodes
    .map((n, i) => {
      const f = at[i];
      const k = [0, Math.max(0, f - 0.015), f, Math.min(1, f + 0.07), 1];
      const keyTimes = k.map((v) => v.toFixed(4)).join(';');
      const w = 128;
      const h = 62;
      return `<g transform="translate(${n.x - w / 2} ${n.y - h / 2})">
        <rect width="${w}" height="${h}" rx="12" fill="#1b1832" stroke="${n.color}" stroke-opacity=".35"/>
        <rect width="${w}" height="${h}" rx="12" fill="${n.color}" fill-opacity=".16" stroke="${n.color}" stroke-width="2" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="${keyTimes}" dur="${D}s" repeatCount="indefinite"/></rect>
        <rect x="12" y="14" width="8" height="8" fill="${n.color}"/>
        <text x="28" y="23" class="t">${n.title}</text>
        <text x="12" y="46" class="s">${n.sub}</text></g>`;
    })
    .join('')
    .replace(/\n\s*/g, '');

  // Escada de modelos: CI vermelho volta ao Time e promove para o Sol.
  const ci = nodes[5];
  const time = nodes[4];
  const ladder = `<path d="M${ci.x} ${ci.y - 31} C ${ci.x} ${ci.y - 82}, ${time.x} ${time.y - 82}, ${time.x} ${time.y - 31}" class="ladder"/>
    <text x="${(ci.x + time.x) / 2}" y="${ci.y - 74}" text-anchor="middle" class="warn">CI vermelho 2× → promove para o Sol</text>`;
  const review = `<path d="M${nodes[6].x} ${nodes[6].y + 31} C ${nodes[6].x} ${nodes[6].y + 70}, ${time.x + 40} ${time.y + 70}, ${time.x + 30} ${time.y + 31}" class="loop"/>
    <text x="${(nodes[6].x + time.x) / 2 + 20}" y="${nodes[6].y + 70}" text-anchor="middle" class="note">mudanças pedidas → nova rodada</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Fluxo da missão: Conselho, CEO, líderes, time, CI, revisão, merge, aprovação, lançamento, vendas e meta">
<title>Fluxo de uma missão na Pixel Corp</title>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#110f1f"/><stop offset="1" stop-color="#0c0b16"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>
<style>
  .t{font:700 15px ${SANS};fill:#e8e5ff}
  .s{font:500 12px ${SANS};fill:#8e89b8}
  .h{font:600 12px ${SANS};letter-spacing:.18em;fill:#8e89b8}
  .warn{font:600 12px ${SANS};fill:#ff8fa3}
  .note{font:500 12px ${SANS};fill:#f9a8d4}
  .note2{font:500 12px ${SANS};fill:#8e89b8}
  .wire{fill:none;stroke:#3d3866;stroke-width:3}
  .flow{fill:none;stroke:#5eead4;stroke-width:3;stroke-dasharray:6 14;animation:flow 1.2s linear infinite;opacity:.8}
  .ladder{fill:none;stroke:#ff5470;stroke-width:2.5;stroke-dasharray:5 7;animation:flow 1s linear infinite}
  .loop{fill:none;stroke:#f472b6;stroke-width:2;stroke-dasharray:4 7;animation:flow 1.4s linear infinite;opacity:.8}
  @keyframes flow{to{stroke-dashoffset:-40}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
<text x="40" y="38" class="h">UMA MISSÃO, DE PONTA A PONTA</text>
<path d="${d}" class="wire"/><path d="${d}" class="flow"/>
${ladder.replace(/\n\s*/g, '')}${review.replace(/\n\s*/g, '')}
${report}${cards}
<g>
  <circle r="9" fill="#5eead4" filter="url(#glow)"/><circle r="5" fill="#e8fffb"/>
  <animateMotion dur="${D}s" repeatCount="indefinite" path="${d}"/>
</g>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'banner.svg'), banner());
writeFileSync(path.join(OUT, 'fluxo.svg'), flow());
console.log('docs/media/banner.svg e docs/media/fluxo.svg gerados');
