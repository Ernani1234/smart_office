import { z } from 'zod';
import { BILLING_MODES, EFFORTS, LEVELS, ROLE_KINDS, TOOL_GRANTS } from './enums';

// roles.yaml — cargo, modelo, esforço, modo de cobrança e orçamento por tarefa.
// Modelo é configuração, não código: a interface edita este arquivo e a próxima
// chamada de cada agente já usa o valor novo, sem deploy.

export const EscalationSchema = z.object({
  model: z.string().min(1).describe('Modelo para o qual a tarefa é promovida quando trava'),
  afterCiFailures: z.number().int().min(1).max(10).default(2),
});

export const RoleSchema = z
  .object({
    title: z.string().min(1),
    team: z.string().min(1),
    level: z.enum(LEVELS),
    kind: z.enum(ROLE_KINDS).default('llm'),
    description: z.string().optional(),
    model: z.string().min(1),
    /** Designer: modelo da arte final (o `model` faz o rascunho). */
    finalModel: z.string().optional(),
    effort: z.enum(EFFORTS).default('medium'),
    /** Líderes: esforço usado em code review. */
    reviewEffort: z.enum(EFFORTS).optional(),
    /** CEO: esforço reservado a pivôs e integração final. */
    pivotEffort: z.enum(EFFORTS).optional(),
    billing: z.enum(BILLING_MODES).default('standard'),
    taskBudgetUsd: z.number().positive().max(1000),
    instances: z.number().int().min(0).max(12).default(1),
    names: z.array(z.string().min(1)).optional(),
    tools: z.array(z.enum(TOOL_GRANTS)).default([]),
    escalation: EscalationSchema.optional(),
    prompt: z.string().optional(),
  })
  .superRefine((role, ctx) => {
    const reads = role.tools.includes('web');
    const writes = role.tools.includes('workspace') || role.tools.includes('shell');
    if (reads && writes) {
      ctx.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'Isolamento: quem lê a internet não recebe ferramenta de escrita (injeção de prompt). Separe em dois cargos.',
      });
    }
  });

export const TeamSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().optional(),
});

export const RulesSchema = z.object({
  maxReviewRounds: z.number().int().min(1).max(10).default(3),
  ciFailuresBeforePromotion: z.number().int().min(1).max(10).default(2),
  maxRespecs: z.number().int().min(0).max(5).default(1),
  ceoMaxContextTokens: z.number().int().min(10_000).default(272_000),
  approvalTimeoutHours: z.number().positive().default(72),
  budgetWarningPct: z.number().min(0.1).max(0.99).default(0.8),
});

export const AgentOverrideSchema = z.object({
  model: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
  name: z.string().optional(),
});

export const RolesFileSchema = z
  .object({
    version: z.literal(1),
    company: z.object({
      name: z.string().min(1),
      handbook: z.string().optional(),
      rules: RulesSchema.default({
        maxReviewRounds: 3,
        ciFailuresBeforePromotion: 2,
        maxRespecs: 1,
        ceoMaxContextTokens: 272_000,
        approvalTimeoutHours: 72,
        budgetWarningPct: 0.8,
      }),
    }),
    teams: z.record(z.string(), TeamSchema),
    roles: z.record(z.string(), RoleSchema),
    /** Promoções por agente (ex.: `dev-2: { model: gpt-6.1-sol }`). */
    overrides: z.record(z.string(), AgentOverrideSchema).default({}),
  })
  .superRefine((file, ctx) => {
    const roles = Object.entries(file.roles);
    const executives = roles.filter(([, r]) => r.level === 'executive' && r.instances > 0);
    if (executives.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['roles'], message: 'A empresa precisa de exatamente um CEO (level: executive).' });
    }
    for (const [id, role] of roles) {
      if (!file.teams[role.team]) {
        ctx.addIssue({ code: 'custom', path: ['roles', id, 'team'], message: `Time desconhecido: ${role.team}` });
      }
    }
    // Sem gerente de gerente: cada time com trabalhadores tem exatamente um líder.
    const teamsWithWorkers = new Set(roles.filter(([, r]) => r.level === 'worker').map(([, r]) => r.team));
    for (const team of teamsWithWorkers) {
      const leads = roles.filter(([, r]) => r.level === 'lead' && r.team === team);
      if (leads.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['roles'],
          message: `O time "${team}" precisa de exatamente um líder (tem ${leads.length}).`,
        });
      }
    }
  });

export type Role = z.infer<typeof RoleSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Rules = z.infer<typeof RulesSchema>;
export type RolesFile = z.infer<typeof RolesFileSchema>;
export type AgentOverride = z.infer<typeof AgentOverrideSchema>;
