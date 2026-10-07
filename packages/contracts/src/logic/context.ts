// O contexto do CEO fica abaixo de ~272 mil tokens: acima disso a requisição
// inteira vai para a tabela de contexto longo (entrada ×2, saída ×1,5). O CEO lê
// só relatórios condensados — os mais recentes primeiro, até caber no orçamento.

export function estimateTokensOf(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface FitResult<T> {
  kept: T[];
  dropped: number;
  tokens: number;
}

/**
 * Mantém os itens mais recentes (fim do array) que cabem em `maxTokens`,
 * reservando `reservedTokens` para o prompt fixo e a resposta.
 */
export function fitToContext<T>(items: T[], render: (item: T) => string, maxTokens: number, reservedTokens: number): FitResult<T> {
  const budget = Math.max(0, maxTokens - reservedTokens);
  const kept: T[] = [];
  let tokens = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const t = estimateTokensOf(render(items[i]));
    if (tokens + t > budget) break;
    kept.unshift(items[i]);
    tokens += t;
  }
  return { kept, dropped: items.length - kept.length, tokens };
}
