import type Phaser from 'phaser';
import type { AgentView, CompanyState } from '@office/contracts';
import type { AgentActor } from './actor';

// Balões, nomes e selos desenhados em HTML por cima do canvas: ficam nítidos
// em qualquer zoom e aceitam emoji. As posições são reprojetadas a cada quadro.

const BUBBLE_MS = { speech: 6500, thought: 4200, alert: 7000, success: 5500, money: 5500 } as const;
const MAX_BUBBLES = 8;

interface Item {
  root: HTMLDivElement;
  name: HTMLDivElement;
  bubble: HTMLDivElement;
  badge: HTMLDivElement;
  bubbleKey: string;
}

interface Floater {
  el: HTMLDivElement;
  wx: number;
  wy: number;
  born: number;
}

const STYLE: Record<string, { bg: string; fg: string; border: string; tail: string }> = {
  speech: { bg: '#f6f1e4', fg: '#1b1726', border: '#1b1726', tail: '#f6f1e4' },
  thought: { bg: 'rgba(22,20,41,0.88)', fg: '#d9d5ff', border: 'rgba(139,124,246,0.6)', tail: 'rgba(22,20,41,0.88)' },
  alert: { bg: '#fff1d6', fg: '#4a1d0a', border: '#f97316', tail: '#fff1d6' },
  success: { bg: '#dcfce7', fg: '#0f3b22', border: '#22c55e', tail: '#dcfce7' },
  money: { bg: '#fef3c7', fg: '#4a3305', border: '#f2c14e', tail: '#fef3c7' },
};

export class DomOverlay {
  private readonly items = new Map<string, Item>();
  private floaters: Floater[] = [];
  hoveredId: string | null = null;

  constructor(private readonly root: HTMLElement) {}

  private item(id: string): Item {
    let it = this.items.get(id);
    if (it) return it;
    const root = document.createElement('div');
    root.className = 'bubble';
    const bubble = document.createElement('div');
    const name = document.createElement('div');
    const badge = document.createElement('div');
    Object.assign(bubble.style, {
      position: 'absolute',
      bottom: '6px',
      left: '0',
      transform: 'translateX(-50%)',
      maxWidth: '190px',
      width: 'max-content',
      padding: '4px 7px',
      borderRadius: '7px',
      fontSize: '11px',
      lineHeight: '1.25',
      fontFamily: 'Inter, sans-serif',
      display: 'none',
      boxShadow: '0 2px 0 rgba(0,0,0,0.35)',
    });
    bubble.className = 'bubble-tail';
    Object.assign(name.style, {
      position: 'absolute',
      top: '30px',
      left: '0',
      transform: 'translateX(-50%)',
      whiteSpace: 'nowrap',
      fontFamily: '"Pixelify Sans", sans-serif',
      fontSize: '11px',
      padding: '1px 6px',
      borderRadius: '5px',
      background: 'rgba(12,11,22,0.85)',
      color: '#e8e5ff',
      border: '1px solid rgba(139,124,246,0.5)',
      display: 'none',
    });
    Object.assign(badge.style, {
      position: 'absolute',
      bottom: '2px',
      left: '9px',
      fontSize: '12px',
      lineHeight: '1',
      filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.6))',
      display: 'none',
    });
    root.append(bubble, name, badge);
    this.root.append(root);
    it = { root, name, bubble, badge, bubbleKey: '' };
    this.items.set(id, it);
    return it;
  }

  remove(id: string): void {
    this.items.get(id)?.root.remove();
    this.items.delete(id);
  }

  /** Texto que sobe e some (ex.: “+US$ 17,55” no cofre). */
  floatText(wx: number, wy: number, text: string, color: string): void {
    const now = performance.now();
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      fontFamily: '"Pixelify Sans", sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      color,
      textShadow: '0 1px 0 #000, 0 0 6px rgba(0,0,0,0.6)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    el.textContent = text;
    this.root.append(el);
    this.floaters.push({ el, wx, wy, born: now });
    if (this.floaters.length > 40) this.floaters.shift()?.el.remove();
  }

  sync(
    cam: Phaser.Cameras.Scene2D.Camera,
    actors: Map<string, AgentActor>,
    view: CompanyState,
    now: number,
    selectedId: string | null,
  ): void {
    const project = (wx: number, wy: number) => ({
      x: (wx - cam.worldView.x) * cam.zoom,
      y: (wy - cam.worldView.y) * cam.zoom,
    });
    // quais balões mostrar: os mais recentes + o selecionado
    const fresh: { id: string; ts: number }[] = [];
    for (const [id] of actors) {
      const a = view.agents[id];
      const b = a?.bubble;
      if (!b) continue;
      const ts = Date.parse(b.ts);
      if (now - ts < BUBBLE_MS[b.kind]) fresh.push({ id, ts });
    }
    fresh.sort((a, b) => b.ts - a.ts);
    const shown = new Set(fresh.slice(0, MAX_BUBBLES).map((f) => f.id));
    if (selectedId && fresh.some((f) => f.id === selectedId)) shown.add(selectedId);

    for (const [id, actor] of actors) {
      const a: AgentView | undefined = view.agents[id];
      if (!a) continue;
      const it = this.item(id);
      const head = actor.head();
      const p = project(head.x, head.y);
      it.root.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
      it.root.style.zIndex = String(Math.round(actor.y));

      const b = a.bubble;
      if (b && shown.has(id)) {
        const key = `${b.ts}:${b.text}`;
        if (key !== it.bubbleKey) {
          const st = STYLE[b.kind];
          it.bubble.style.background = st.bg;
          it.bubble.style.color = st.fg;
          it.bubble.style.border = `1.5px solid ${st.border}`;
          it.bubble.style.fontStyle = b.kind === 'thought' ? 'italic' : 'normal';
          it.bubble.style.setProperty('--tail', st.tail);
          it.bubble.textContent = b.kind === 'thought' ? `💭 ${b.text}` : b.text;
          it.bubble.style.display = 'block';
          it.bubble.style.animation = 'none';
          void it.bubble.offsetWidth;
          it.bubble.style.animation = '';
          it.bubbleKey = key;
        }
        const age = now - Date.parse(b.ts);
        const life = BUBBLE_MS[b.kind];
        it.bubble.style.opacity = String(age > life - 600 ? Math.max(0, (life - age) / 600) : 1);
      } else if (it.bubble.style.display !== 'none') {
        it.bubble.style.display = 'none';
        it.bubbleKey = '';
      }

      const showName = id === selectedId || id === this.hoveredId;
      if (showName) {
        it.name.textContent = `${a.name} · ${a.title}`;
        it.name.style.display = 'block';
        it.name.style.borderColor = id === selectedId ? '#5eead4' : 'rgba(139,124,246,0.5)';
      } else it.name.style.display = 'none';

      const badge = view.paused
        ? '⏸️'
        : a.activity === 'blocked'
          ? '❗'
          : a.activity === 'celebrating'
            ? '⭐'
            : a.location === 'copa' && a.activity === 'idle'
              ? '💤'
              : a.activity === 'reviewing'
                ? '🔎'
                : '';
      if (badge) {
        it.badge.textContent = badge;
        it.badge.style.display = 'block';
      } else it.badge.style.display = 'none';
    }
    for (const id of [...this.items.keys()]) if (!actors.has(id)) this.remove(id);

    // flutuantes (relógio real: no replay acelerado continuam legíveis)
    const rt = performance.now();
    this.floaters = this.floaters.filter((f) => {
      const age = rt - f.born;
      if (age > 1800 || age < -5000) {
        f.el.remove();
        return false;
      }
      const p = project(f.wx, f.wy - (age / 1800) * 22);
      f.el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0) translateX(-50%)`;
      f.el.style.opacity = String(age > 1100 ? Math.max(0, 1 - (age - 1100) / 700) : 1);
      return true;
    });
  }

  destroy(): void {
    for (const id of [...this.items.keys()]) this.remove(id);
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }
}
