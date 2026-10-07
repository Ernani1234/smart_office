// Raster mínimo em RGBA para desenhar pixel art por código. Roda igual no
// navegador (personagens gerados na hora) e no Node (tileset e móveis em PNG).

export type RGBA = [number, number, number, number];

const cache = new Map<string, RGBA>();

export function rgba(color: string): RGBA {
  const hit = cache.get(color);
  if (hit) return hit;
  let out: RGBA;
  if (color === 'transparent') out = [0, 0, 0, 0];
  else if (color.startsWith('rgba')) {
    const [r, g, b, a] = color
      .slice(color.indexOf('(') + 1, -1)
      .split(',')
      .map((x) => Number(x.trim()));
    out = [r, g, b, Math.round((a ?? 1) * 255)];
  } else {
    const hex = color.replace('#', '');
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const n = Number.parseInt(full.slice(0, 6), 16);
    const a = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) : 255;
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  cache.set(color, out);
  return out;
}

export function hex(c: RGBA): string {
  return `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mistura duas cores (t = 0 → a, t = 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgba(a);
  const y = rgba(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, 255]);
}

export const darken = (c: string, t: number) => mix(c, '#140f1e', t);
export const lighten = (c: string, t: number) => mix(c, '#fff6e6', t);

export class Img {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** Pinta um pixel com alpha (composição "source-over"). */
  px(x: number, y: number, color: string | RGBA): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    const c = typeof color === 'string' ? rgba(color) : color;
    if (c[3] === 0) return this;
    const i = (y * this.w + x) * 4;
    if (c[3] === 255) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return this;
    }
    const a = c[3] / 255;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa === 0) return this;
    for (let k = 0; k < 3; k++) this.data[i + k] = (c[k] * a + this.data[i + k] * da * (1 - a)) / oa;
    this.data[i + 3] = oa * 255;
    return this;
  }

  clear(x: number, y: number): this {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    const i = (y * this.w + x) * 4;
    this.data[i + 3] = 0;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, color: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color);
    return this;
  }

  hline(x: number, y: number, w: number, color: string): this {
    return this.rect(x, y, w, 1, color);
  }

  vline(x: number, y: number, h: number, color: string): this {
    return this.rect(x, y, 1, h, color);
  }

  /** Retângulo com contorno. */
  box(x: number, y: number, w: number, h: number, fill: string, outline: string): this {
    this.rect(x, y, w, h, outline);
    return this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** Retângulo com cantos arredondados de 1px (sem os 4 cantos). */
  rounded(x: number, y: number, w: number, h: number, color: string): this {
    this.rect(x + 1, y, w - 2, h, color);
    this.rect(x, y + 1, 1, h - 2, color);
    this.rect(x + w - 1, y + 1, 1, h - 2, color);
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: string): this {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx + 0.25) + (y * y) / (ry * ry + 0.25) <= 1) this.px(cx + x, cy + y, color);
      }
    }
    return this;
  }

  blit(src: Img, dx: number, dy: number, opts: { flipX?: boolean } = {}): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = opts.flipX ? src.w - 1 - x : x;
        const c = src.get(sx, y);
        if (c[3] > 0) this.px(dx + x, dy + y, c);
      }
    }
    return this;
  }

  /** Desenha a partir de uma grade de caracteres (cada caractere = uma cor da legenda). */
  grid(rows: string[], legend: Record<string, string>, dx = 0, dy = 0): this {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = legend[row[x]];
        if (color) this.px(dx + x, dy + y, color);
      }
    });
    return this;
  }

  /** Contorno externo: pinta `color` em pixels transparentes vizinhos de pixels opacos. */
  outline(color: string, opts: { diagonal?: boolean } = {}): this {
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && this.data[(y * this.w + x) * 4 + 3] > 0;
    const marks: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (opaque(x, y)) continue;
        const n = opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1);
        const d = opts.diagonal && (opaque(x - 1, y - 1) || opaque(x + 1, y - 1) || opaque(x - 1, y + 1) || opaque(x + 1, y + 1));
        if (n || d) marks.push([x, y]);
      }
    }
    for (const [x, y] of marks) this.px(x, y, color);
    return this;
  }

  /** Ruído determinístico para texturas (madeira, carpete, pedra). */
  speckle(x: number, y: number, w: number, h: number, colors: string[], density: number, seed: number): this {
    let s = seed >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (rnd() < density) this.px(x + i, y + j, colors[Math.floor(rnd() * colors.length)]);
      }
    }
    return this;
  }

  clone(): Img {
    const c = new Img(this.w, this.h);
    c.data.set(this.data);
    return c;
  }

  sub(x: number, y: number, w: number, h: number): Img {
    const out = new Img(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.px(i, j, this.get(x + i, y + j));
    return out;
  }

  /** Amplia por fator inteiro (pré-visualização). */
  scale(k: number): Img {
    const out = new Img(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const c = this.get(Math.floor(x / k), Math.floor(y / k));
        const i = (y * out.w + x) * 4;
        out.data[i] = c[0];
        out.data[i + 1] = c[1];
        out.data[i + 2] = c[2];
        out.data[i + 3] = c[3];
      }
    return out;
  }
}
