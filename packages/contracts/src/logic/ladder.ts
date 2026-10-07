// Escada de modelos: a tarefa começa no modelo barato com esforço alto. Se o CI
// falhar N vezes, ela é promovida ao modelo de escalonamento. Se falhar de novo,
// volta ao líder para reescrever a especificação. No escritório isso aparece
// como o júnior levantando para pedir ajuda ao sênior.

export interface LadderState {
  /** Falhas de CI acumuladas nesta especificação. */
  ciFailures: number;
  currentModel: string;
  baseModel: string;
  escalationModel: string | null;
  afterCiFailures: number;
  respecs: number;
  maxRespecs: number;
}

export type LadderAction = { action: 'retry' } | { action: 'promote'; toModel: string } | { action: 'respec' } | { action: 'escalate_ceo' };

/** Decide o próximo passo depois de uma falha de CI no modelo atual. */
export function onCiFailure(s: LadderState): LadderAction {
  const giveBack: LadderAction = s.respecs < s.maxRespecs ? { action: 'respec' } : { action: 'escalate_ceo' };
  const canPromote = !!s.escalationModel && s.escalationModel !== s.currentModel;
  const wasPromoted = !!s.escalationModel && s.currentModel === s.escalationModel && s.baseModel !== s.escalationModel;
  if (wasPromoted) return giveBack;
  if (canPromote && s.ciFailures >= s.afterCiFailures) return { action: 'promote', toModel: s.escalationModel! };
  if (!canPromote && s.ciFailures >= s.afterCiFailures + 1) return giveBack;
  return { action: 'retry' };
}

// Revisão: no máximo N idas e voltas. Estourou, sobe para um modelo maior,
// depois para o CEO, depois para o Conselho.
export type ReviewAction = { action: 'done' } | { action: 'revise' } | { action: 'promote'; toModel: string } | { action: 'escalate_ceo' };

export function afterReview(args: {
  approved: boolean;
  round: number;
  maxRounds: number;
  currentModel: string;
  escalationModel: string | null;
}): ReviewAction {
  if (args.approved) return { action: 'done' };
  if (args.round < args.maxRounds) return { action: 'revise' };
  if (args.escalationModel && args.currentModel !== args.escalationModel) {
    return { action: 'promote', toModel: args.escalationModel };
  }
  return { action: 'escalate_ceo' };
}
