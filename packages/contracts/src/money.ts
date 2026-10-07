// Dinheiro é contado por código, em micro-dólares inteiros (1 USD = 1_000_000).
// Nada de float acumulando erro no livro-caixa.

export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}

const usdFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
const usdFmtPrecise = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** "US$ 1.234,56" — valores < 1 centavo ganham 4 casas ("US$ 0,0034"). */
export function formatUsd(usd: number, opts: { precise?: boolean } = {}): string {
  const abs = Math.abs(usd);
  if (opts.precise || (abs > 0 && abs < 0.01)) return usdFmtPrecise.format(usd);
  return usdFmt.format(usd);
}

/** Versão curta para HUD: "US$ 12,3k". */
export function formatUsdCompact(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 1000) {
    return `US$ ${(usd / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  }
  return formatUsd(usd);
}

/** Estimativa grosseira de tokens (≈ 4 caracteres por token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
