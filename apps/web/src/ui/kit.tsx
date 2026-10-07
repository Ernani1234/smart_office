import { useMemo, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { AgentView } from '@office/contracts';
import { portraitUrl } from '../office/textures';
import { useOffice } from '../store/store';

// Peças de interface reutilizadas pelos painéis.

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'gold' | 'subtle'; size?: 'sm' | 'md' }) {
  const styles = {
    primary: 'bg-cyan text-ink-950 hover:bg-[#7ff3e1] shadow-[0_0_0_1px_rgba(94,234,212,0.4),0_6px_20px_-8px_rgba(94,234,212,0.6)]',
    gold: 'bg-gold text-ink-950 hover:bg-[#f7d27a] shadow-[0_6px_20px_-8px_rgba(242,193,78,0.6)]',
    danger: 'bg-danger text-white hover:bg-[#ff6f86] shadow-[0_6px_20px_-8px_rgba(255,84,112,0.7)]',
    ghost: 'border border-ink-500/60 bg-ink-800/60 text-ink-100 hover:border-ink-300/60 hover:bg-ink-700/70',
    subtle: 'text-ink-200 hover:bg-ink-700/60 hover:text-ink-100',
  }[variant];
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button
      className={cx(
        'inline-flex select-none items-center justify-center rounded-lg font-medium transition active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
        styles,
        sizes,
        className,
      )}
      {...props}
    />
  );
}

export function Pill({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', className)}
      style={color ? { borderColor: `${color}66`, background: `${color}1a`, color } : undefined}
    >
      {children}
    </span>
  );
}

const TIER_COLORS: Record<string, string> = {
  astra: '#a78bfa',
  sol: '#2dd4bf',
  luna: '#94a3b8',
  image: '#f472b6',
  embedding: '#93c5fd',
};

export function tierOf(model: string): string {
  const pricing = useOffice.getState().config?.pricing;
  const tier = pricing?.models[model]?.tier;
  if (tier) return tier;
  if (pricing?.images[model]) return 'image';
  if (model.includes('astra')) return 'astra';
  if (model.includes('sol')) return 'sol';
  if (model.includes('luna')) return 'luna';
  return 'luna';
}

export function ModelBadge({ model, compact }: { model: string; compact?: boolean }) {
  const tier = tierOf(model);
  const color = TIER_COLORS[tier] ?? '#94a3b8';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[10.5px] leading-4"
      style={{ borderColor: `${color}55`, background: `${color}14`, color }}
      title={model}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {compact ? tier : model}
    </span>
  );
}

export function teamColor(team: string): string {
  return useOffice.getState().config?.roles.teams[team]?.color ?? '#94a3b8';
}

export function Avatar({ agent, size = 32, ring }: { agent: AgentView; size?: number; ring?: boolean }) {
  const color = teamColor(agent.team);
  const url = useMemo(() => portraitUrl(agent, color), [agent.id, agent.seed, agent.level, agent.roleId, color]);
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-lg"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(160deg, ${color}40, ${color}12)`,
        boxShadow: ring ? `0 0 0 2px ${color}` : `inset 0 0 0 1px ${color}40`,
      }}
    >
      <img
        src={url}
        alt={agent.name}
        className="pixelated"
        style={{ width: size * 0.82, height: size * 0.82 * (17 / 16), marginTop: size * 0.12 }}
      />
    </span>
  );
}

const ACTIVITY: Record<string, { label: string; color: string }> = {
  idle: { label: 'ocioso', color: '#8e89b8' },
  working: { label: 'trabalhando', color: '#5eead4' },
  thinking: { label: 'pensando', color: '#a78bfa' },
  typing: { label: 'escrevendo', color: '#5eead4' },
  testing: { label: 'testando', color: '#fbbf24' },
  researching: { label: 'pesquisando', color: '#93c5fd' },
  reviewing: { label: 'em revisão', color: '#f472b6' },
  planning: { label: 'planejando', color: '#a78bfa' },
  waiting: { label: 'aguardando', color: '#8e89b8' },
  blocked: { label: 'bloqueado', color: '#ff5470' },
  celebrating: { label: 'comemorando', color: '#f2c14e' },
};

export function activityInfo(a: string): { label: string; color: string } {
  return ACTIVITY[a] ?? { label: a, color: '#8e89b8' };
}

export function StatusDot({ activity, pulse }: { activity: string; pulse?: boolean }) {
  const { color } = activityInfo(activity);
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

/** Medidor: preenchimento carrega a severidade; trilho é um tom claro da mesma cor. */
export function Meter({ value, max, tone = 'money', label }: { value: number; max: number; tone?: 'money' | 'spend'; label?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = tone === 'money' ? '#4ade80' : ratio >= 1 ? '#ff5470' : ratio >= 0.8 ? '#fbbf24' : '#5eead4';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: `${fill}26` }}
      role="meter"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${ratio * 100}%`, background: fill }} />
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="font-pixel text-[13px] uppercase tracking-wider text-ink-300">{children}</h3>
      {right}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon && <div className="text-ink-400">{icon}</div>}
      <p className="font-pixel text-ink-200">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink-300">{children}</p>}
    </div>
  );
}

/** Folha grande que cobre o escritório (painéis). */
export function Sheet({
  title,
  icon,
  subtitle,
  onClose,
  children,
  wide,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-stretch justify-center bg-ink-950/55 p-3 sm:p-5" onMouseDown={onClose}>
      <section
        className={cx('panel flex w-full flex-col overflow-hidden rounded-2xl', wide ? 'max-w-[1400px]' : 'max-w-[1100px]')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-ink-600/60 px-5 py-3.5">
          {icon && <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-700/80 text-cyan">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 className="font-pixel text-lg leading-tight text-ink-100">{title}</h2>
            {subtitle && <p className="truncate text-xs text-ink-300">{subtitle}</p>}
          </div>
          {actions}
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-ink-700 hover:text-ink-100"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <X size={17} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-200">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-ink-300">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-ink-500/60 bg-ink-900/70 px-3 text-sm text-ink-100 outline-none transition placeholder:text-ink-400 focus:border-cyan/70 focus:ring-2 focus:ring-cyan/20';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink-500 bg-ink-800 px-1 font-mono text-[10px] text-ink-200">{children}</kbd>;
}
