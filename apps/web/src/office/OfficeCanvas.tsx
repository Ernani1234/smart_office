import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';
import { OfficeScene } from './OfficeScene';
import { useOffice } from '../store/store';

// Monta o jogo Phaser dentro do React. O overlay HTML (balões, nomes) fica por
// cima do canvas, no mesmo retângulo.

let current: Phaser.Game | null = null;

export function officeScene(): OfficeScene | null {
  return (current?.scene.getScene('office') as OfficeScene | undefined) ?? null;
}

export function OfficeCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const following = useOffice((s) => s.following);
  const selected = useOffice((s) => s.selectedAgentId);

  useEffect(() => {
    if (!host.current || !overlay.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: '#0c0b16',
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      banner: false,
      audio: { noAudio: true },
      // Pixel art não precisa de 60 fps: 30 fps corta pela metade o custo de GPU/CPU.
      fps: { limit: 30 },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: host.current.clientWidth || 800,
        height: host.current.clientHeight || 600,
      },
      callbacks: {
        preBoot: (g) => g.registry.set('overlay', overlay.current),
      },
      scene: [OfficeScene],
    });
    current = game;
    if (import.meta.env.DEV) (window as unknown as { __office?: Phaser.Game }).__office = game;
    return () => {
      game.destroy(true);
      if (current === game) current = null;
    };
  }, []);

  const btn =
    'grid h-8 w-8 place-items-center rounded-md border border-ink-500/50 bg-ink-800/85 text-ink-200 transition hover:border-cyan/60 hover:text-cyan';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={host} className="absolute inset-0" />
      <div ref={overlay} className="pointer-events-none absolute inset-0 isolate overflow-hidden" />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button className={btn} title="Aproximar" onClick={() => officeScene()?.zoomBy(1.25)}>
          <Plus size={15} />
        </button>
        <button className={btn} title="Afastar" onClick={() => officeScene()?.zoomBy(0.8)}>
          <Minus size={15} />
        </button>
        <button className={btn} title="Enquadrar o escritório" onClick={() => officeScene()?.fit()}>
          <Maximize2 size={14} />
        </button>
        <button
          className={`${btn} ${following ? '!border-cyan !text-cyan' : ''}`}
          title={selected ? 'Seguir o agente selecionado' : 'Selecione um agente para seguir'}
          disabled={!selected}
          onClick={() => useOffice.getState().setFollowing(!following)}
        >
          <Crosshair size={15} />
        </button>
      </div>
    </div>
  );
}
