import { z } from 'zod';
import { REVENUE_SOURCES } from './enums';

// "Só pare quando gerar US$ 10 mil" vira uma Missão com quatro campos: a métrica
// (lucro líquido, não receita), a fonte que a mede (API do meio de pagamento,
// lida por código), o teto de gasto e o prazo. Termina no que vier primeiro.

export const CreateMissionSchema = z
  .object({
    title: z.string().min(3).max(120),
    brief: z.string().min(10).max(8000),
    goalUsd: z.number().positive().max(10_000_000),
    spendCapUsd: z.number().positive().max(1_000_000),
    deadline: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Data inválida'),
    revenueSource: z.enum(REVENUE_SOURCES).default('sim'),
  })
  .refine((m) => Date.parse(m.deadline) > Date.now(), { message: 'O prazo precisa estar no futuro', path: ['deadline'] });

export type CreateMission = z.infer<typeof CreateMissionSchema>;

export const ApprovalDecisionSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(2000).nullable().default(null),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const SteerSchema = z.object({ text: z.string().min(1).max(2000) });

export const PromoteSchema = z.object({
  model: z.string().min(1),
  effort: z.string().optional(),
});
