import Phaser from 'phaser';
import type { AgentView } from '@office/contracts';
import type { Facing } from '@office/pixel-art';
import { agentTexture } from './textures';

// Um agente no mapa. A projeção diz para onde ele deveria ir (mesa, reunião,
// copa); o ator anda até lá por caminho do easystar, senta, digita, comemora.

export interface SpotRef {
  name: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: Facing;
  sit: boolean;
  room: string;
}

export type PathFinder = (fromTx: number, fromTy: number, toTx: number, toTy: number) => { x: number; y: number }[] | null;

const WALK_SPEED = 54; // px/s
const SIT_LIFT_BACK = 6;
const SIT_LIFT_FRONT = 2;

export class AgentActor {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Ellipse;
  view: AgentView;
  texKey: string;
  x: number;
  y: number;
  dest: SpotRef;
  waypoints: { x: number; y: number }[] = [];
  visit: { spot: SpotRef; until: number } | null = null;
  facing: Facing;
  frozen = false;
  speedFactor = 1;
  private anim: string | null = null;
  private poseKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    view: AgentView,
    teamColor: string,
    spawn: SpotRef,
  ) {
    this.view = view;
    this.texKey = agentTexture(scene, view, teamColor);
    this.x = spawn.x;
    this.y = spawn.y;
    this.dest = spawn;
    this.facing = spawn.facing;
    this.shadow = scene.add.ellipse(this.x, this.y, 12, 4, 0x0e0a1c, 0.35).setDepth(this.y - 1);
    this.sprite = scene.add.sprite(this.x, this.y, this.texKey, 'down_idle').setOrigin(0.5, 1);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
    this.sprite.setData('agentId', view.id);
    this.applyPose(true);
  }

  get tile(): { x: number; y: number } {
    return { x: Math.floor(this.x / 16), y: Math.floor((this.y - 1) / 16) };
  }

  get walking(): boolean {
    return this.waypoints.length > 0;
  }

  get seated(): boolean {
    return !this.walking && this.dest.sit && Math.abs(this.x - this.dest.x) < 1 && Math.abs(this.y - this.dest.y) < 1;
  }

  /** Posição da cabeça na tela do mundo (para balões e nomes). */
  head(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y - 25 };
  }

  setTeamColor(teamColor: string): void {
    const key = agentTexture(this.scene, this.view, teamColor);
    if (key !== this.texKey) {
      this.texKey = key;
      this.sprite.setTexture(key, 'down_idle');
      this.anim = null;
      this.poseKey = '';
    }
  }

  goTo(spot: SpotRef, find: PathFinder, snap = false): void {
    const same = spot.name === this.dest.name && (this.walking || (Math.abs(this.x - spot.x) < 1 && Math.abs(this.y - spot.y) < 1));
    this.dest = spot;
    if (snap) {
      this.waypoints = [];
      this.x = spot.x;
      this.y = spot.y;
      this.facing = spot.facing;
      this.applyPose(true);
      return;
    }
    if (same) return;
    const from = this.tile;
    const path = find(from.x, from.y, spot.tx, spot.ty);
    if (!path) {
      this.goTo(spot, find, true);
      return;
    }
    // caminho em centros de tile; o último ponto é a posição exata do spot
    this.waypoints = path.slice(1).map((p) => ({ x: p.x * 16 + 8, y: p.y * 16 + 14 }));
    this.waypoints.push({ x: spot.x, y: spot.y });
  }

  update(dt: number, opts: { speaking: boolean }): void {
    if (this.frozen) {
      this.sprite.anims.pause();
      return;
    }
    if (this.sprite.anims.isPaused) this.sprite.anims.resume();
    if (this.walking) {
      let budget = (WALK_SPEED * this.speedFactor * dt) / 1000;
      while (budget > 0 && this.waypoints.length) {
        const wp = this.waypoints[0];
        const dx = wp.x - this.x;
        const dy = wp.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          this.x = wp.x;
          this.y = wp.y;
          budget -= dist;
          this.waypoints.shift();
        } else {
          this.x += (dx / dist) * budget;
          this.y += (dy / dist) * budget;
          budget = 0;
        }
        if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
        else if (Math.abs(dy) > 0.01) this.facing = dy > 0 ? 'down' : 'up';
      }
      if (!this.waypoints.length) this.facing = this.dest.facing;
    }
    this.applyPose(false, opts.speaking);
  }

  private rate = 1;

  private play(anim: string | null, frame?: string, rate = 1): void {
    this.rate = rate;
    if (anim) {
      const key = `${this.texKey}:${anim}`;
      if (this.anim !== key) {
        this.sprite.play(key);
        this.anim = key;
      }
    } else {
      if (this.anim) this.sprite.stop();
      this.anim = null;
      if (frame) this.sprite.setFrame(frame);
    }
  }

  applyPose(force = false, speaking = false): void {
    const a = this.view.activity;
    let lift = 0;
    let poseKey: string;
    if (this.walking) {
      poseKey = `walk:${this.facing}`;
      if (force || poseKey !== this.poseKey) {
        this.play(this.facing === 'left' || this.facing === 'right' ? 'walk_side' : this.facing === 'up' ? 'walk_up' : 'walk_down');
      }
      this.sprite.setFlipX(this.facing === 'left');
    } else if (a === 'celebrating') {
      poseKey = 'celebrate';
      if (force || poseKey !== this.poseKey) this.play('celebrate');
      this.sprite.setFlipX(false);
    } else if (this.dest.sit) {
      if (this.dest.facing === 'up') {
        lift = SIT_LIFT_BACK;
        const busy = ['working', 'typing', 'testing', 'planning', 'researching', 'reviewing'].includes(a);
        poseKey = busy ? `type:${a}` : 'sitback';
        if (force || poseKey !== this.poseKey)
          this.play(busy ? 'type' : null, 'sit_back_1', a === 'testing' ? 0.5 : a === 'typing' ? 1.4 : 1);
      } else {
        lift = SIT_LIFT_FRONT;
        const sleepy = this.view.location === 'copa' && a === 'idle' && !speaking;
        poseKey = speaking ? 'talk' : sleepy ? 'sleep' : 'sitfront';
        if (force || poseKey !== this.poseKey) this.play(speaking ? 'talk' : null, sleepy ? 'sleep' : 'sit_front');
      }
      this.sprite.setFlipX(false);
    } else {
      poseKey = `stand:${this.facing}`;
      if (force || poseKey !== this.poseKey) {
        this.play(null, this.facing === 'up' ? 'up_idle' : this.facing === 'down' ? 'down_idle' : 'side_idle');
      }
      this.sprite.setFlipX(this.facing === 'left');
    }
    this.poseKey = poseKey;
    if (this.anim) this.sprite.anims.timeScale = Math.min(3, Math.max(1, this.speedFactor)) * this.rate;
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y - lift));
    this.sprite.setDepth(this.y + 0.5);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y - 1)).setDepth(this.y - 0.5);
    this.shadow.setVisible(!(this.dest.sit && !this.walking));
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
