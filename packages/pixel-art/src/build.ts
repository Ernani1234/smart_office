import { FURNITURE, furnitureImage } from './furniture';
import { buildGrid, MAP_H, MAP_W, PLACEMENTS, ROOMS, SPOTS, type Cell } from './map';
import { Img } from './raster';
import { floorTile, TILE, wallCap, wallFace, wallShadow, wallShadowSide, type FaceVariant, type Material } from './tiles';

// Monta o tileset, as camadas e o mapa Tiled (.tmj) a partir da planta.
// Puro (sem Node): o script de geração só grava os PNGs e o JSON.

export interface OfficeBuild {
  tileset: Img;
  columns: number;
  tileCount: number;
  collides: number[];
  layers: { floor: number[]; walls: number[]; shadows: number[] };
  furnitureKeys: string[];
  tmj: Record<string, unknown>;
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return h;
}

function faceVariantFor(y: number): FaceVariant {
  if (y <= 2) return 'exterior';
  if (y >= 17) return 'panel';
  return 'plain';
}

export function buildOffice(): OfficeBuild {
  const grid = buildGrid();
  const tiles: Img[] = [];
  const index = new Map<string, number>();
  const collides: number[] = [];
  const tileId = (key: string, make: () => Img, solid = false): number => {
    let id = index.get(key);
    if (id === undefined) {
      id = tiles.length;
      tiles.push(make());
      index.set(key, id);
      if (solid) collides.push(id);
    }
    return id;
  };

  const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || grid[y][x].kind === 'wall';
  const isFloor = (x: number, y: number) => !isWall(x, y);
  const faceRole = (x: number, y: number): 'upper' | 'lower' | null => {
    if (!isWall(x, y)) return null;
    if (isFloor(x, y + 1)) return 'lower';
    if (isWall(x, y + 1) && isFloor(x, y + 2) && y + 1 < MAP_H) return 'upper';
    return null;
  };

  const floor: number[] = [];
  const walls: number[] = [];
  const shadows: number[] = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const cell: Cell = grid[y][x];
      if (cell.kind === 'floor') {
        const m = cell.material as Material;
        let v = hash2(x, y) % 4;
        if (m === 'board' && faceRole(x, y - 1) === 'lower') v = 99;
        floor.push(tileId(`floor:${m}:${v}`, () => floorTile(m, v)) + 1);
        walls.push(0);
        if (faceRole(x, y - 1) === 'lower') shadows.push(tileId('shadow:top', wallShadow) + 1);
        else if (isWall(x - 1, y) && !faceRole(x - 1, y)) shadows.push(tileId('shadow:side', wallShadowSide) + 1);
        else shadows.push(0);
        continue;
      }
      floor.push(0);
      shadows.push(0);
      const role = faceRole(x, y);
      if (role) {
        const variant = faceVariantFor(y);
        walls.push(tileId(`face:${role}:${variant}`, () => wallFace(role, variant), true) + 1);
      } else {
        const mask = (isWall(x, y - 1) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) | (isWall(x, y + 1) ? 4 : 0) | (isWall(x - 1, y) ? 8 : 0);
        walls.push(tileId(`cap:${mask}`, () => wallCap(mask), true) + 1);
      }
    }
  }

  const columns = 16;
  const rows = Math.ceil(tiles.length / columns);
  const tileset = new Img(columns * TILE, rows * TILE);
  tiles.forEach((t, i) => tileset.blit(t, (i % columns) * TILE, Math.floor(i / columns) * TILE));

  // móveis: todos os do catálogo (alguns só aparecem em tempo de execução, ex.: janela de dia)
  const furnitureKeys = Object.keys(FURNITURE).sort();
  const furnitureFirstGid = tiles.length + 1;
  const gidOf = new Map(furnitureKeys.map((k, i) => [k, furnitureFirstGid + i]));
  let nextId = 1;
  const prop = (name: string, value: string | number | boolean) => ({
    name,
    type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : 'string',
    value,
  });

  const furnitureObjects = PLACEMENTS.map((p) => {
    const meta = FURNITURE[p.key].meta;
    return {
      id: nextId++,
      gid: gidOf.get(p.key),
      name: p.name ?? '',
      type: p.key,
      x: p.tx * TILE + (p.dx ?? 0),
      y: (p.ty + 1) * TILE + (p.dy ?? 0),
      width: meta.w,
      height: meta.h,
      rotation: 0,
      visible: true,
    };
  });

  const spotObjects = SPOTS.map((s) => ({
    id: nextId++,
    name: s.name,
    type: 'spot',
    point: true,
    x: s.tx * TILE + TILE / 2 + (s.dx ?? 0),
    y: (s.ty + 1) * TILE - 2 + (s.dy ?? 0),
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    properties: [prop('facing', s.facing), prop('sit', s.sit), prop('room', s.room), prop('tileX', s.tx), prop('tileY', s.ty)],
  }));

  const roomObjects = ROOMS.map((r) => ({
    id: nextId++,
    name: r.id,
    type: 'room',
    x: r.x * TILE,
    y: r.y * TILE,
    width: r.w * TILE,
    height: r.h * TILE,
    rotation: 0,
    visible: true,
    properties: [prop('label', r.label), prop('team', r.team ?? '')],
  }));

  const maxW = Math.max(...furnitureKeys.map((k) => FURNITURE[k].meta.w));
  const maxH = Math.max(...furnitureKeys.map((k) => FURNITURE[k].meta.h));
  const tileLayer = (id: number, name: string, data: number[]) => ({
    id,
    name,
    type: 'tilelayer',
    width: MAP_W,
    height: MAP_H,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data,
  });
  const objectLayer = (id: number, name: string, objects: unknown[]) => ({
    id,
    name,
    type: 'objectgroup',
    draworder: 'topdown',
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    objects,
  });

  const tmj = {
    compressionlevel: -1,
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: MAP_W,
    height: MAP_H,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 7,
    nextobjectid: nextId,
    properties: [
      prop('generator', '@office/pixel-art'),
      prop('editavel', 'Abra no Tiled: mova móveis e spots; o escritório relê na próxima carga.'),
    ],
    layers: [
      tileLayer(1, 'floor', floor),
      tileLayer(2, 'shadows', shadows),
      tileLayer(3, 'walls', walls),
      objectLayer(4, 'furniture', furnitureObjects),
      objectLayer(5, 'spots', spotObjects),
      objectLayer(6, 'rooms', roomObjects),
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'office',
        image: 'tiles.png',
        imagewidth: tileset.w,
        imageheight: tileset.h,
        tilewidth: TILE,
        tileheight: TILE,
        columns,
        tilecount: tiles.length,
        margin: 0,
        spacing: 0,
        tiles: collides.map((id) => ({ id, properties: [prop('collides', true)] })),
      },
      {
        firstgid: furnitureFirstGid,
        name: 'furniture',
        columns: 0,
        grid: { orientation: 'orthogonal', width: 1, height: 1 },
        margin: 0,
        spacing: 0,
        tilecount: furnitureKeys.length,
        tilewidth: maxW,
        tileheight: maxH,
        tiles: furnitureKeys.map((k, i) => ({
          id: i,
          image: `furniture/${k}.png`,
          imagewidth: FURNITURE[k].meta.w,
          imageheight: FURNITURE[k].meta.h,
          type: k,
        })),
      },
    ],
  };

  return { tileset, columns, tileCount: tiles.length, collides, layers: { floor, walls, shadows }, furnitureKeys, tmj };
}

/** Renderização estática do mapa inteiro (pré-visualização e testes). */
export function renderPreview(build: OfficeBuild, extras: { img: Img; x: number; y: number; depth: number }[] = []): Img {
  const out = new Img(MAP_W * TILE, MAP_H * TILE);
  out.rect(0, 0, out.w, out.h, '#0d0b14');
  const tileAt = (gid: number) => {
    const id = gid - 1;
    return build.tileset.sub((id % build.columns) * TILE, Math.floor(id / build.columns) * TILE, TILE, TILE);
  };
  for (const layer of [build.layers.floor, build.layers.shadows, build.layers.walls]) {
    layer.forEach((gid, i) => {
      if (gid > 0) out.blit(tileAt(gid), (i % MAP_W) * TILE, Math.floor(i / MAP_W) * TILE);
    });
  }
  const objects = PLACEMENTS.map((p) => {
    const meta = FURNITURE[p.key].meta;
    const x = p.tx * TILE + (p.dx ?? 0);
    const bottom = (p.ty + 1) * TILE + (p.dy ?? 0);
    const depth = meta.depth === 'floor' ? -1e6 : meta.depth === 'wall' ? -5e5 : bottom + (meta.depthOffset ?? 0);
    return { img: furnitureImage(p.key), x, y: bottom - meta.h, depth };
  });
  for (const o of [...objects, ...extras].sort((a, b) => a.depth - b.depth)) out.blit(o.img, o.x, o.y);
  return out;
}
