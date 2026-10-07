import { useEffect, useState } from 'react';
import { health } from '../lib/api';

// Na primeira vez a API sobe bem depois do Vite (banco criado, workflows do
// Temporal compilados). Em vez de erro, a tela espera com o prédio acendendo.

export function useApiReady(): { ready: boolean; waitedMs: number } {
  const [ready, setReady] = useState(false);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    void (async () => {
      while (alive) {
        if (await health()) {
          if (alive) setReady(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 700));
        if (alive) setNow(Date.now());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return { ready, waitedMs: now - started };
}

const WINDOWS = Array.from({ length: 16 }, (_, i) => ({
  x: 8 + (i % 4) * 4,
  y: 9 + Math.floor(i / 4) * 4,
  delay: ((i * 7919) % 2600) + 100,
  lit: i % 5 === 2 ? '#5eead4' : '#f2c14e',
}));

function PixelBuilding() {
  return (
    <svg viewBox="0 0 32 32" className="pixelated h-32 w-32 drop-shadow-[0_0_28px_rgba(242,193,78,0.25)]" shapeRendering="crispEdges">
      <rect x="15" y="1" width="2" height="4" fill="#3d3866" />
      <rect x="15" y="0" width="2" height="1" fill="#ff5470" className="animate-pulse" />
      <rect x="5" y="5" width="22" height="2" fill="#2d2950" />
      <rect x="6" y="7" width="20" height="21" fill="#20242f" />
      <rect x="6" y="7" width="1" height="21" fill="#2a2f3d" />
      {WINDOWS.map((w, i) => (
        <rect
          key={i}
          x={w.x}
          y={w.y}
          width="3"
          height="3"
          className="boot-window"
          style={{ animationDelay: `${w.delay}ms`, ['--lit' as string]: w.lit }}
        />
      ))}
      <rect x="14" y="25" width="4" height="3" fill="#c98d5a" />
      <rect x="2" y="28" width="28" height="2" fill="#2d2950" />
    </svg>
  );
}

export function BootScreen({ waitedMs, title = 'Ligando o escritório…' }: { waitedMs: number; title?: string }) {
  const hint =
    waitedMs > 75_000 ? (
      <>
        A API ainda não respondeu. Confira o terminal do <code className="font-mono text-ink-200">pnpm dev</code>.
      </>
    ) : waitedMs > 15_000 ? (
      'Primeira vez demora mais: o banco é criado e os workflows do Temporal são compilados.'
    ) : (
      'Banco, Temporal e API subindo.'
    );
  return (
    <div className="grid h-full place-items-center p-4">
      <div className="flex flex-col items-center text-center">
        <PixelBuilding />
        <div className="mt-6 font-pixel text-2xl text-ink-100">{title}</div>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-300">{hint}</p>
        <div className="mt-5 h-1.5 w-56 overflow-hidden rounded-full bg-ink-800">
          <div className="boot-bar h-full w-1/3 rounded-full bg-cyan" />
        </div>
      </div>
    </div>
  );
}
