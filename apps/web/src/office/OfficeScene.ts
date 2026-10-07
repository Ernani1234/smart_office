import Phaser from 'phaser';
import * as EasyStar from 'easystarjs';
import { drawText, FURNITURE, type Facing } from '@office/pixel-art';
import { formatUsd, type AgentView, type CompanyState, type OfficeEvent } from '@office/contracts';
import { fx, type FxMessage } from '../store/fx';
import { officeNow, useOffice, viewOf, type PanelId } from '../store/store';
import { AgentActor, type SpotRef } from './actor';
import { DomOverlay } from './overlay';
import { createSharedTextures, writeTexture, type ScreenKind } from './textures';

// O escritório é uma PROJEÇÃO do log de eventos: esta cena só anima o que a
// projeção diz (quem está onde, fazendo o quê) e os efeitos que os eventos
// disparam (moedas, confete, visitas ao chefe, CI piscando nos servidores).

const TILE = 16;
const DARK_DEPTH = 1_000_000;
const COPA_SEATS = [
  'copa:sofa:1',
  'copa:sofa:2',
  'copa:sofa:3',
  'copa:stool:1',
  'copa:stool:2',
  ...Array.from({ length: 7 }, (_, i) => `copa:stand:${i + 1}`),
];
const MEETING_NORTH = ['meeting:1', 'meeting:2', 'meeting:3'];
const MEETING_SOUTH = ['meeting:4', 'meeting:5', 'meeting:6'];
const OVERFLOW = ['corredor:1', 'corredor:2'];

/** Clique em móveis abre o painel correspondente. */
const CLICKABLE: Record<string, PanelId> = {
  vault: 'finance',
  board_table: 'approvals',
  throne: 'approvals',
  meeting_table: 'board',
  whiteboard_review: 'board',
  whiteboard_plan: 'board',
  server_rack_0: 'repo',
  server_rack_1: 'repo',
  bookshelf_0: 'wiki',
  bookshelf_1: 'wiki',
  reception: 'missions',
  trophy_cabinet: 'missions',
};

interface ScreenSlot {
  sprite: Phaser.GameObjects.Sprite;
  light: Phaser.GameObjects.Image;
  seat: string | null;
  kind: ScreenKind;
  override: { kind: ScreenKind; until: number } | null;
}

interface Light {
  img: Phaser.GameObjects.Image;
  base: number;
  flicker: boolean;
}

export class OfficeScene extends Phaser.Scene {
  private spots = new Map<string, SpotRef>();
  private walk: number[][] = [];
  private finder = new EasyStar.js();
  private actors = new Map<string, AgentActor>();
  private seats = new Map<string, string>();
  private screens: ScreenSlot[] = [];
  private leds: Phaser.GameObjects.Sprite[] = [];
  private ledOverride: { mode: 'ok' | 'fail'; until: number } | null = null;
  private windows: Phaser.GameObjects.Image[] = [];
  private glows: Light[] = [];
  private darkness!: Phaser.GameObjects.Rectangle;
  private alarm!: Phaser.GameObjects.Rectangle;
  private boardGlow!: Phaser.GameObjects.Image;
  private serverGlow!: Phaser.GameObjects.Image;
  private ring!: Phaser.GameObjects.Ellipse;
  private overlay!: DomOverlay;
  private emitters!: {
    coins: Phaser.GameObjects.Particles.ParticleEmitter;
    sparks: Phaser.GameObjects.Particles.ParticleEmitter;
    confetti: Phaser.GameObjects.Particles.ParticleEmitter;
    steam: Phaser.GameObjects.Particles.ParticleEmitter;
  };
  private vaultSpot = { x: 0, y: 0 };
  private coffeeSpot = { x: 0, y: 0 };
  private lastView: CompanyState | null = null;
  private lastCounter = '';
  private lastTvMeeting = '';
  private lastTvBoard = '';
  private mapW = 0;
  private mapH = 0;
  private userZoomed = false;
  private drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private speed = 1;
  private nightFactor = -1;
  private unsubs: (() => void)[] = [];
  private ready = false;

  constructor() {
    super('office');
  }

  preload(): void {
    this.load.tilemapTiledJSON('office', '/assets/office/office.tmj');
    this.load.image('tiles', '/assets/office/tiles.png');
    for (const key of Object.keys(FURNITURE)) this.load.image(`furn:${key}`, `/assets/office/furniture/${key}.png`);
  }

  create(): void {
    createSharedTextures(this);
    const map = this.make.tilemap({ key: 'office' });
    const tileset = map.addTilesetImage('office', 'tiles')!;
    map.createLayer('floor', tileset)!.setDepth(-1000);
    map.createLayer('shadows', tileset)!.setDepth(-999);
    const walls = map.createLayer('walls', tileset)!.setDepth(-998);
    this.mapW = map.widthInPixels;
    this.mapH = map.heightInPixels;

    // grade de caminhada: paredes + pegada dos móveis
    this.walk = Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => (walls.getTileAt(x, y) ? 1 : 0)));

    this.buildFurniture(map);
    this.buildSpots(map);
    for (const s of this.spots.values()) if (this.walk[s.ty]?.[s.tx] !== undefined) this.walk[s.ty][s.tx] = 0;
    this.finder.setGrid(this.walk);
    this.finder.setAcceptableTiles([0]);
    this.finder.enableDiagonals();
    this.finder.disableCornerCutting();
    this.finder.enableSync();

    // luz, alarme e efeitos
    this.darkness = this.add.rectangle(0, 0, this.mapW, this.mapH, 0x070b24, 0).setOrigin(0).setDepth(DARK_DEPTH);
    this.alarm = this.add
      .rectangle(0, 0, this.mapW, this.mapH, 0xff2244, 0)
      .setOrigin(0)
      .setDepth(DARK_DEPTH + 5);
    const board = this.spots.get('board:visit');
    this.boardGlow = this.addLight(board ? board.x - 64 : 80, board ? board.y - 40 : 100, 70, 0xf2c14e, 0).img;
    const servers = this.spots.get('servers');
    this.serverGlow = this.addLight(servers?.x ?? 800, (servers?.y ?? 110) - 20, 60, 0x38bdf8, 0).img;
    this.ring = this.add.ellipse(0, 0, 18, 7).setStrokeStyle(1.5, 0x5eead4, 0.95).setVisible(false);
    this.tweens.add({ targets: this.ring, scaleX: 1.25, scaleY: 1.25, alpha: 0.55, duration: 700, yoyo: true, repeat: -1 });

    this.emitters = {
      coins: this.add.particles(0, 0, 'coin', {
        speed: { min: 60, max: 140 },
        angle: { min: 225, max: 315 },
        gravityY: 320,
        lifespan: 1100,
        scale: { start: 1, end: 0.8 },
        emitting: false,
      }),
      sparks: this.add.particles(0, 0, 'spark', {
        speed: { min: 30, max: 90 },
        lifespan: 700,
        scale: { start: 1, end: 0 },
        tint: [0xffffff, 0x5eead4, 0xa78bfa, 0xf2c14e],
        emitting: false,
      }),
      confetti: this.add.particles(0, 0, 'confetti', {
        x: { min: 0, max: this.mapW },
        y: -10,
        speedY: { min: 40, max: 110 },
        speedX: { min: -30, max: 30 },
        rotate: { min: 0, max: 360 },
        lifespan: 6000,
        quantity: 4,
        frequency: 30,
        tint: [0xff4fa3, 0x5eead4, 0xfbbf24, 0xa78bfa, 0x4ade80, 0xffffff],
        emitting: false,
      }),
      steam: this.add.particles(0, 0, 'steam', {
        speedY: { min: -14, max: -8 },
        speedX: { min: -3, max: 3 },
        lifespan: 1600,
        alpha: { start: 0.7, end: 0 },
        frequency: 700,
        emitting: true,
      }),
    };
    this.emitters.coins.setDepth(DARK_DEPTH + 10);
    this.emitters.sparks.setDepth(DARK_DEPTH + 10);
    this.emitters.confetti.setDepth(DARK_DEPTH + 11);
    this.emitters.steam.setPosition(this.coffeeSpot.x, this.coffeeSpot.y).setDepth(DARK_DEPTH - 1);

    this.overlay = new DomOverlay(this.game.registry.get('overlay') as HTMLElement);
    this.setupCamera();
    this.setupInput();

    const store = useOffice.getState();
    this.syncView(viewOf(store), true);
    this.unsubs.push(
      useOffice.subscribe((s, prev) => {
        const v = viewOf(s);
        if (v !== this.lastView) this.syncView(v, false);
        if (s.following !== prev.following || s.selectedAgentId !== prev.selectedAgentId) this.updateFollow();
        if (s.replay.speed !== prev.replay.speed || s.replay.active !== prev.replay.active) {
          this.speed = s.replay.active ? Math.min(6, Math.max(1, s.replay.speed / 2)) : 1;
          for (const a of this.actors.values()) a.speedFactor = this.speed;
        }
      }),
      fx.on((m) => this.onFx(m)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    this.ready = true;
  }

  // ---------------------------------------------------------------- construção

  private buildFurniture(map: Phaser.Tilemaps.Tilemap): void {
    const layer = map.getObjectLayer('furniture');
    for (const obj of layer?.objects ?? []) {
      const key = obj.type;
      const piece = FURNITURE[key];
      if (!piece) continue;
      const meta = piece.meta;
      const x = obj.x ?? 0;
      const bottom = obj.y ?? 0;
      const top = bottom - meta.h;
      const depth = meta.depth === 'floor' ? -900 : meta.depth === 'wall' ? -950 : bottom + (meta.depthOffset ?? 0);
      const img = this.add.image(x, bottom, `furn:${key}`).setOrigin(0, 1).setDepth(depth);
      if (key === 'window_night') this.windows.push(img);
      const panel = CLICKABLE[key];
      if (panel) {
        img.setInteractive({ useHandCursor: true });
        img.setData('panel', panel);
      }
      // pegada no chão
      const [fw, fh] = meta.footprint;
      const tx0 = Math.floor(x / TILE);
      const ty0 = Math.floor((bottom - 1) / TILE);
      for (let j = 0; j < fh; j++)
        for (let i = 0; i < fw; i++) if (this.walk[ty0 - j]?.[tx0 + i] !== undefined) this.walk[ty0 - j][tx0 + i] = 1;

      for (const ov of meta.overlays ?? []) {
        const ox = x + ov.x;
        const oy = top + ov.y;
        if (ov.kind === 'screen') {
          const sprite = this.add
            .sprite(ox, oy, 'screen:off', 0)
            .setOrigin(0)
            .setDepth(depth + 0.1);
          sprite.play('screen:off');
          const light = this.addLight(ox + 8, oy + 6, 20, 0x5eead4, 0).img;
          this.screens.push({ sprite, light, seat: null, kind: 'off', override: null });
          sprite.setData('deskTiles', { tx0, ty: ty0, fw });
        } else if (ov.kind === 'leds') {
          const s = this.add
            .sprite(ox, oy, 'leds:idle', 0)
            .setOrigin(0)
            .setDepth(depth + 0.1);
          s.play({ key: 'leds:idle', startFrame: Math.floor(Math.random() * 6) });
          this.leds.push(s);
        } else if (ov.kind === 'counter') {
          writeTexture(this, 'vault:counter', ov.w, ov.h, () => undefined);
          this.add
            .image(ox, oy, 'vault:counter')
            .setOrigin(0)
            .setDepth(depth + 0.1);
          this.vaultSpot = { x: x + meta.w / 2, y: top + 10 };
        } else if (ov.kind === 'tv') {
          const key2 = x < 200 ? 'tv:board' : 'tv:meeting';
          writeTexture(this, key2, ov.w, ov.h, () => undefined);
          this.add
            .image(ox, oy, key2)
            .setOrigin(0)
            .setDepth(depth + 0.1);
        } else if (ov.kind === 'arcade') {
          this.add
            .sprite(ox, oy, 'arcade', 0)
            .setOrigin(0)
            .setDepth(depth + 0.1)
            .play('arcade');
        } else if (ov.kind === 'coffee') {
          this.coffeeSpot = { x: ox + 2, y: oy - 1 };
        }
      }
      if (meta.light) {
        const color = Phaser.Display.Color.HexStringToColor(meta.light.color).color;
        this.addLight(x + meta.light.x, top + meta.light.y, meta.light.radius, color, 0.55, key === 'lamp' || key === 'vending');
      }
    }
  }

  private buildSpots(map: Phaser.Tilemaps.Tilemap): void {
    const layer = map.getObjectLayer('spots');
    for (const obj of layer?.objects ?? []) {
      const props = Object.fromEntries(
        (obj.properties as { name: string; value: unknown }[] | undefined)?.map((p) => [p.name, p.value]) ?? [],
      );
      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      this.spots.set(obj.name, {
        name: obj.name,
        x,
        y,
        tx: Number(props.tileX ?? Math.floor(x / TILE)),
        ty: Number(props.tileY ?? Math.floor(y / TILE)),
        facing: (props.facing as Facing) ?? 'down',
        sit: Boolean(props.sit),
        room: String(props.room ?? ''),
      });
    }
    // liga cada tela de mesa à cadeira logo abaixo
    for (const sc of this.screens) {
      const d = sc.sprite.getData('deskTiles') as { tx0: number; ty: number; fw: number };
      const seat = [...this.spots.values()].find((s) => s.sit && s.ty === d.ty + 1 && s.tx >= d.tx0 && s.tx < d.tx0 + d.fw);
      sc.seat = seat?.name ?? null;
    }
  }

  private addLight(x: number, y: number, radius: number, color: number, base: number, flicker = false): Light {
    const img = this.add
      .image(x, y, 'light')
      .setScale((radius * 2) / 128)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setDepth(DARK_DEPTH + 1);
    const light = { img, base, flicker };
    if (base > 0) this.glows.push(light);
    return light;
  }

  // ---------------------------------------------------------------- câmera e entrada

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#0c0b16');
    cam.setBounds(-160, -120, this.mapW + 320, this.mapH + 240);
    this.fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (!this.userZoomed) this.fit();
    });
  }

  fit(): void {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    const zoom = Math.max(0.5, Math.min(w / (this.mapW + 24), h / (this.mapH + 24)));
    cam.setZoom(zoom);
    cam.centerOn(this.mapW / 2, this.mapH / 2);
    this.userZoomed = false;
  }

  zoomBy(factor: number, px?: number, py?: number): void {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(px ?? this.scale.width / 2, py ?? this.scale.height / 2);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.5, 6));
    const after = cam.getWorldPoint(px ?? this.scale.width / 2, py ?? this.scale.height / 2);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.userZoomed = true;
  }

  private setupInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      const agent = objs.find((o) => o.getData('agentId'));
      if (agent) {
        useOffice.getState().selectAgent(agent.getData('agentId') as string);
        return;
      }
      const furniture = objs.find((o) => o.getData('panel'));
      if (furniture) {
        useOffice.getState().openPanel(furniture.getData('panel') as PanelId);
        return;
      }
      const cam = this.cameras.main;
      this.drag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, moved: false };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      const cam = this.cameras.main;
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        this.drag.moved = true;
        if (useOffice.getState().following) useOffice.getState().setFollowing(false);
      }
      cam.scrollX = this.drag.sx - dx / cam.zoom;
      cam.scrollY = this.drag.sy - dy / cam.zoom;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.drag && !this.drag.moved) useOffice.getState().selectAgent(null);
      this.drag = null;
    });
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomBy(dy > 0 ? 0.88 : 1.14, p.x, p.y);
    });
    this.input.on(Phaser.Input.Events.GAMEOBJECT_OVER, (_p: Phaser.Input.Pointer, o: Phaser.GameObjects.GameObject) => {
      const id = o.getData('agentId');
      if (id) this.overlay.hoveredId = id as string;
    });
    this.input.on(Phaser.Input.Events.GAMEOBJECT_OUT, (_p: Phaser.Input.Pointer, o: Phaser.GameObjects.GameObject) => {
      if (o.getData('agentId') === this.overlay.hoveredId) this.overlay.hoveredId = null;
    });
  }

  private updateFollow(): void {
    const s = useOffice.getState();
    const cam = this.cameras.main;
    const actor = s.selectedAgentId ? this.actors.get(s.selectedAgentId) : undefined;
    if (s.following && actor) {
      cam.startFollow(actor.sprite, true, 0.1, 0.1);
      if (cam.zoom < 2.5) cam.setZoom(2.5);
      this.userZoomed = true;
    } else cam.stopFollow();
  }

  focusAgent(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    const cam = this.cameras.main;
    if (cam.zoom < 1.8) cam.zoomTo(2, 450, 'Sine.easeInOut');
    cam.pan(actor.x, actor.y - 12, 450, 'Sine.easeInOut');
    this.userZoomed = true;
  }

  // ---------------------------------------------------------------- projeção → cena

  private findPath = (fx0: number, fy0: number, tx: number, ty: number): { x: number; y: number }[] | null => {
    if (this.walk[fy0]?.[fx0] === undefined || this.walk[ty]?.[tx] === undefined) return null;
    let result: { x: number; y: number }[] | null = null;
    const startBlocked = this.walk[fy0][fx0] === 1;
    if (startBlocked) this.walk[fy0][fx0] = 0;
    this.finder.setGrid(this.walk);
    this.finder.findPath(fx0, fy0, tx, ty, (path) => {
      result = path;
    });
    this.finder.calculate();
    if (startBlocked) this.walk[fy0][fx0] = 1;
    return result;
  };

  private teamColor(team: string): string {
    return useOffice.getState().config?.roles.teams[team]?.color ?? '#94a3b8';
  }

  private homeSpot(a: AgentView): SpotRef {
    const own = this.spots.get(a.desk);
    if (own) return own;
    const taken = new Set([...this.actors.values()].map((x) => x.dest.name));
    for (const s of this.spots.values()) if (s.name.startsWith(`desk:${a.team}:`) && !taken.has(s.name)) return s;
    return this.spots.get(`${a.team}:stand:1`) ?? this.spots.get('corredor:1')!;
  }

  private seat(agentId: string, prefs: string[], group: string): SpotRef | null {
    for (const [name, owner] of this.seats) {
      if (owner === agentId) {
        if (name.startsWith(group)) return this.spots.get(name) ?? null;
        this.seats.delete(name);
      }
    }
    for (const name of prefs) {
      if (!this.seats.has(name) && this.spots.has(name)) {
        this.seats.set(name, agentId);
        return this.spots.get(name)!;
      }
    }
    return null;
  }

  private releaseSeat(agentId: string): void {
    for (const [name, owner] of this.seats) if (owner === agentId) this.seats.delete(name);
  }

  /** Ponto de pé logo atrás da cadeira (para comemorar sem a cadeira na frente). */
  private standOf(spot: SpotRef): SpotRef {
    const free = this.walk[spot.ty + 1]?.[spot.tx] === 0;
    if (!spot.sit || spot.facing !== 'up' || !free) return spot;
    return { ...spot, name: `${spot.name}:stand`, y: spot.y + TILE, ty: spot.ty + 1, facing: 'down', sit: false };
  }

  private targetFor(a: AgentView, actor?: AgentActor): SpotRef {
    if (actor?.visit && actor.visit.until > performance.now()) return actor.visit.spot;
    if (a.activity === 'celebrating') return this.standOf(this.homeSpot(a));
    switch (a.location) {
      case 'meeting':
        return (
          this.seat(a.id, a.level === 'lead' ? [...MEETING_NORTH, ...MEETING_SOUTH] : [...MEETING_SOUTH, ...MEETING_NORTH], 'meeting') ??
          this.homeSpot(a)
        );
      case 'copa':
        return this.seat(a.id, [...COPA_SEATS, ...OVERFLOW], 'copa') ?? this.spots.get('corredor:2') ?? this.homeSpot(a);
      case 'board':
        this.releaseSeat(a.id);
        return this.spots.get('board:visit') ?? this.homeSpot(a);
      case 'entrance':
        this.releaseSeat(a.id);
        return this.spots.get('entrance') ?? this.homeSpot(a);
      default:
        this.releaseSeat(a.id);
        return this.homeSpot(a);
    }
  }

  private syncView(view: CompanyState, snap: boolean): void {
    this.lastView = view;
    const backlogDone = useOffice.getState().backlogDone;
    for (const id of view.agentOrder) {
      const a = view.agents[id];
      if (!a) continue;
      let actor = this.actors.get(id);
      if (!actor) {
        const home = this.homeSpot(a);
        const spawnAtDoor = !snap && backlogDone && this.ready;
        actor = new AgentActor(this, a, this.teamColor(a.team), spawnAtDoor ? (this.spots.get('entrance') ?? home) : home);
        actor.speedFactor = this.speed;
        this.actors.set(id, actor);
      }
      actor.view = a;
      actor.setTeamColor(this.teamColor(a.team));
      actor.frozen = view.paused;
      if (snap) actor.visit = null;
      actor.goTo(this.targetFor(a, actor), this.findPath, snap);
    }
    for (const [id, actor] of this.actors) {
      if (!view.agents[id]) {
        actor.destroy();
        this.actors.delete(id);
        this.releaseSeat(id);
      }
    }
    this.updateProps(view);
  }

  /** Objetos que refletem o estado: contador do cofre, TVs, servidores, alarme. */
  private updateProps(view: CompanyState): void {
    const mission = view.activeMissionId ? view.missions[view.activeMissionId] : null;
    const fin = view.activeMissionId ? view.finance[view.activeMissionId] : null;
    const net = fin ? fin.revenueUsd - fin.spentUsd : 0;
    const counter = `${net < 0 ? '-' : ''}$${Math.abs(net) >= 1000 ? Math.round(Math.abs(net)) : Math.abs(net).toFixed(2)}`;
    if (counter !== this.lastCounter) {
      this.lastCounter = counter;
      writeTexture(this, 'vault:counter', 36, 7, (img) => {
        img.rect(0, 0, 36, 7, '#0b1410');
        const w = counter.length * 4 - 1;
        drawText(img, counter, Math.max(1, 35 - w), 1, net < 0 ? '#ff5470' : '#4ade80');
        if (!mission) drawText(img, '----', 2, 1, '#14532d');
      });
    }

    const review = view.taskOrder.map((id) => view.tasks[id]).find((t) => t && t.status === 'review' && !t.verdict?.approved);
    const ciTask = view.ci.taskId ? view.tasks[view.ci.taskId] : null;
    const tvMeeting = review
      ? `REV ${review.round}|${ciTask?.ci?.ok === false ? 'CI X' : 'CI OK'}`
      : view.ci.running
        ? 'CI...|RODANDO'
        : 'SALA|LIVRE';
    if (tvMeeting !== this.lastTvMeeting) {
      this.lastTvMeeting = tvMeeting;
      const [l1, l2] = tvMeeting.split('|');
      writeTexture(this, 'tv:meeting', 30, 17, (img) => {
        img.rect(0, 0, 30, 17, '#0c1424');
        drawText(img, l1, 2, 2, '#e8e5ff');
        drawText(img, l2, 2, 9, l2.includes('X') ? '#ff5470' : '#4ade80');
      });
    }
    const pending = Object.values(view.approvals).filter((a) => a.status === 'pending').length;
    const tvBoard = pending
      ? `PEDIDOS|${pending}`
      : mission
        ? `META|${Math.round((net / Math.max(1, mission.goalUsd)) * 100)}%`
        : 'OLA|CONSELHO';
    if (tvBoard !== this.lastTvBoard) {
      this.lastTvBoard = tvBoard;
      const [l1, l2] = tvBoard.split('|');
      writeTexture(this, 'tv:board', 30, 17, (img) => {
        img.rect(0, 0, 30, 17, pending ? '#2a1a05' : '#0c1424');
        drawText(img, l1, 2, 2, pending ? '#f2c14e' : '#e8e5ff');
        drawText(img, l2, 2, 9, pending ? '#fbbf24' : '#5eead4');
      });
    }
    this.boardGlow.setAlpha(pending ? 0.45 : 0);
  }

  // ---------------------------------------------------------------- efeitos

  private onFx(m: FxMessage): void {
    if (!this.ready) return;
    if (m.type === 'snap') {
      this.syncView(viewOf(useOffice.getState()), true);
      return;
    }
    if (m.type === 'focus') {
      this.focusAgent(m.agentId);
      return;
    }
    this.handleEvent(m.event, m.speed);
  }

  private visit(agentId: string | null, spotName: string, ms: number): void {
    if (!agentId) return;
    const actor = this.actors.get(agentId);
    const spot = this.spots.get(spotName);
    if (!actor || !spot || actor.frozen) return;
    actor.visit = { spot, until: performance.now() + ms / Math.max(1, this.speed) + this.travelMs(actor, spot) };
    actor.goTo(spot, this.findPath);
  }

  private travelMs(actor: AgentActor, spot: SpotRef): number {
    return (Math.hypot(actor.x - spot.x, actor.y - spot.y) / (54 * Math.max(1, this.speed))) * 1000;
  }

  private headOf(agentId: string | null): { x: number; y: number } | null {
    const a = agentId ? this.actors.get(agentId) : undefined;
    return a ? a.head() : null;
  }

  private screenOf(agentId: string | null): ScreenSlot[] {
    const actor = agentId ? this.actors.get(agentId) : undefined;
    if (!actor) return [];
    return this.screens.filter((s) => s.seat === actor.dest.name);
  }

  private handleEvent(e: OfficeEvent, speed: number): void {
    const now = performance.now();
    const view = this.lastView;
    const assigneeOf = (taskId: string | null) => (taskId && view?.tasks[taskId]?.assignee) || null;
    switch (e.type) {
      case 'report.submitted':
        this.visit(e.agentId, 'ceo:visit', 3200);
        break;
      case 'task.escalated': {
        const who = assigneeOf(e.taskId);
        const team = who ? view?.agents[who]?.team : null;
        if ((e.data.to === 'model' || e.data.to === 'lead') && team) this.visit(who, `lead_visit:${team}`, 2800);
        const head = this.headOf(who);
        if (head && e.data.to === 'model') this.emitters.sparks.explode(18, head.x, head.y);
        break;
      }
      case 'approval.requested':
        this.visit(e.agentId, 'board:visit', 3600);
        break;
      case 'finance.goal_reached':
        this.visit(e.agentId, 'vault', 4000);
        this.emitters.coins.explode(30, this.vaultSpot.x, this.vaultSpot.y + 18);
        break;
      case 'revenue.recorded':
        this.emitters.coins.explode(10, this.vaultSpot.x, this.vaultSpot.y + 18);
        this.overlay.floatText(this.vaultSpot.x, this.vaultSpot.y - 4, `+${formatUsd(e.data.netUsd)}`, '#4ade80');
        break;
      case 'cost.recorded': {
        if (e.data.amountUsd < 0.01 || speed > 20) break;
        const head = this.headOf(e.agentId);
        if (head) this.overlay.floatText(head.x, head.y - 6, `-${formatUsd(e.data.amountUsd)}`, '#ff8fa3');
        break;
      }
      case 'ci.started': {
        const servers = this.spots.get('servers');
        if (servers) this.emitters.sparks.explode(8, servers.x, servers.y - 20);
        break;
      }
      case 'ci.completed': {
        this.ledOverride = { mode: e.data.ok ? 'ok' : 'fail', until: now + 2600 / Math.max(1, this.speed) };
        for (const s of this.screenOf(e.agentId))
          s.override = { kind: e.data.ok ? 'ok' : 'fail', until: now + 2400 / Math.max(1, this.speed) };
        const head = this.headOf(e.agentId);
        if (head) this.overlay.floatText(head.x, head.y - 8, e.data.ok ? 'CI ✓' : 'CI ✗', e.data.ok ? '#4ade80' : '#ff5470');
        break;
      }
      case 'pr.merged': {
        const head = this.headOf(e.agentId);
        if (head) {
          this.overlay.floatText(head.x, head.y - 8, '🔀 merge', '#a78bfa');
          this.emitters.sparks.explode(10, head.x, head.y);
        }
        break;
      }
      case 'review.completed': {
        const head = this.headOf(e.data.reviewerId);
        if (head && e.data.verdict.approved) this.overlay.floatText(head.x, head.y - 8, '✔ aprovado', '#4ade80');
        break;
      }
      case 'agent.promoted': {
        const head = this.headOf(e.agentId);
        if (head) {
          this.emitters.sparks.explode(24, head.x, head.y);
          this.overlay.floatText(head.x, head.y - 8, `⬆ ${e.data.toModel}`, '#2dd4bf');
        }
        break;
      }
      case 'wiki.written': {
        const head = this.headOf(e.agentId);
        if (head) this.overlay.floatText(head.x, head.y - 8, '📚 wiki', '#93c5fd');
        break;
      }
      case 'mission.launched':
        for (let i = 0; i < 5; i++) {
          this.time.delayedCall(i * 260, () =>
            this.emitters.sparks.explode(26, 120 + Math.random() * (this.mapW - 240), 30 + Math.random() * 30),
          );
        }
        break;
      case 'mission.completed':
        if (e.data.reason === 'goal_reached') {
          this.emitters.confetti.start();
          this.time.delayedCall(3500, () => this.emitters.confetti.stop());
          this.emitters.coins.explode(40, this.vaultSpot.x, this.vaultSpot.y + 18);
        }
        break;
      case 'agent.thought':
      case 'tool.called':
        break;
    }
  }

  // ---------------------------------------------------------------- quadro a quadro

  private updateDaylight(): void {
    const s = useOffice.getState();
    const view = this.lastView;
    let night: number;
    if (s.dayMode === 'day') night = 0;
    else if (s.dayMode === 'night') night = 1;
    else {
      const d = new Date(officeNow());
      const h = d.getHours() + d.getMinutes() / 60;
      night = h >= 7.5 && h <= 17 ? 0 : h > 17 && h < 19 ? (h - 17) / 2 : h > 6 && h < 7.5 ? 1 - (h - 6) / 1.5 : 1;
    }
    night = Math.round(night * 20) / 20;
    if (night !== this.nightFactor) {
      this.nightFactor = night;
      this.darkness.setFillStyle(0x070b24, night * 0.58);
      for (const w of this.windows) w.setTexture(night > 0.5 ? 'furn:window_night' : 'furn:window_day');
    }
    const t = this.time.now;
    for (const l of this.glows) {
      const flick = l.flicker ? 0.92 + Math.sin(t / 130 + l.img.x) * 0.05 : 1;
      l.img.setAlpha(l.base * night * flick);
    }
    const paused = view?.paused ?? false;
    this.alarm.setFillStyle(0xff2244, paused ? 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t / 220)) : 0);
    const ciBusy = view?.ci.running ?? false;
    this.serverGlow.setAlpha(ciBusy ? 0.35 + 0.25 * Math.sin(t / 120) : 0);
  }

  private updateScreens(now: number): void {
    const view = this.lastView;
    for (const sc of this.screens) {
      let kind: ScreenKind = 'off';
      if (sc.override && sc.override.until > now) kind = sc.override.kind;
      else {
        sc.override = null;
        const actor = [...this.actors.values()].find((a) => a.dest.name === sc.seat && a.seated);
        const a = actor ? view?.agents[actor.view.id] : undefined;
        if (a) {
          kind =
            a.activity === 'testing'
              ? 'test'
              : a.activity === 'researching'
                ? 'web'
                : a.activity === 'thinking' || a.activity === 'planning'
                  ? 'think'
                  : a.activity === 'working' || a.activity === 'typing' || a.activity === 'reviewing'
                    ? 'code'
                    : 'idle';
        }
      }
      if (kind !== sc.kind) {
        sc.kind = kind;
        sc.sprite.play(`screen:${kind}`);
      }
      const color =
        kind === 'fail' ? 0xff5470 : kind === 'test' ? 0xfbbf24 : kind === 'ok' ? 0x4ade80 : kind === 'think' ? 0xa78bfa : 0x5eead4;
      sc.light.setTint(color).setAlpha(kind === 'off' ? 0 : (kind === 'idle' ? 0.15 : 0.45) * Math.max(0.15, this.nightFactor));
    }
    const mode = this.ledOverride && this.ledOverride.until > now ? this.ledOverride.mode : view?.ci.running ? 'busy' : 'idle';
    if (!(this.ledOverride && this.ledOverride.until > now)) this.ledOverride = null;
    for (const l of this.leds) {
      const key = `leds:${mode}`;
      if (l.anims.currentAnim?.key !== key) l.play({ key, startFrame: Math.floor(Math.random() * 6) });
    }
  }

  override update(_time: number, delta: number): void {
    const view = this.lastView;
    if (!view) return;
    const now = performance.now();
    // visitas que acabaram: volta para onde a projeção manda
    for (const actor of this.actors.values()) {
      if (actor.visit && actor.visit.until <= now) {
        actor.visit = null;
        actor.goTo(this.targetFor(actor.view, actor), this.findPath);
      }
    }
    const officeTime = officeNow();
    for (const actor of this.actors.values()) {
      const b = actor.view.bubble;
      const speaking = !!b && b.kind === 'speech' && officeTime - Date.parse(b.ts) < 3500;
      actor.update(delta, { speaking });
    }
    const selected = useOffice.getState().selectedAgentId;
    const sel = selected ? this.actors.get(selected) : undefined;
    if (sel)
      this.ring
        .setVisible(true)
        .setPosition(sel.sprite.x, sel.y - 1)
        .setDepth(sel.y - 0.6);
    else this.ring.setVisible(false);

    this.updateDaylight();
    this.updateScreens(now);
    this.overlay.sync(this.cameras.main, this.actors, view, officeTime, selected);
  }

  private teardown(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.overlay?.destroy();
    for (const a of this.actors.values()) a.destroy();
    this.actors.clear();
    this.ready = false;
  }
}
