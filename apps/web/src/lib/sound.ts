// Efeitos sonoros 8-bit sintetizados na hora (WebAudio), sem arquivos.
// Começa mudo; o botão de som na barra de cima liga.

type Sfx = 'coin' | 'bell' | 'success' | 'fanfare' | 'alert' | 'alarm' | 'fail' | 'click';

let ctx: AudioContext | null = null;
let muted = true;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', gain = 0.06): void {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.02);
}

const SEQUENCES: Record<Sfx, () => void> = {
  coin: () => {
    tone(988, 0, 0.08);
    tone(1319, 0.07, 0.22);
  },
  bell: () => {
    tone(880, 0, 0.3, 'triangle', 0.08);
    tone(1175, 0.12, 0.4, 'triangle', 0.06);
  },
  success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.18, 'square', 0.05)),
  fanfare: () => [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.2, 'square', 0.05)),
  alert: () => {
    tone(660, 0, 0.12, 'sawtooth', 0.04);
    tone(440, 0.14, 0.18, 'sawtooth', 0.04);
  },
  alarm: () =>
    [0, 0.3, 0.6].forEach((t) => {
      tone(880, t, 0.14, 'sawtooth', 0.05);
      tone(622, t + 0.15, 0.14, 'sawtooth', 0.05);
    }),
  fail: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.24, 'triangle', 0.06)),
  click: () => tone(1500, 0, 0.03, 'square', 0.03),
};

export const sound = {
  setMuted(v: boolean) {
    muted = v;
  },
  play(name: Sfx) {
    if (muted) return;
    SEQUENCES[name]();
  },
};
