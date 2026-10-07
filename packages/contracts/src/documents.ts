import { z } from 'zod';
import { CEO_DECISIONS, SEVERITIES, TASK_KINDS } from './enums';

// Os agentes não conversam em texto livre. Trocam documentos com schema fixo,
// validados via Structured Outputs. Os schemas "...Out" são o que o modelo
// produz (todos os campos obrigatórios, opcionais viram null — exigência do modo
// estrito); campos como custo e commit são preenchidos por código depois.

const ApprovalAskKind = z.enum(['spend', 'publish', 'contact', 'deploy']);

// ---------------------------------------------------------------- ordem de serviço

/** Ordem de serviço: objetivo, contexto, critérios de aceite, orçamento e artefatos de entrada. */
export const WorkOrderSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  team: z.string(),
  role: z.string(),
  kind: z.enum(TASK_KINDS),
  title: z.string(),
  objective: z.string(),
  context: z.string(),
  acceptanceCriteria: z.array(z.string()),
  budgetUsd: z.number(),
  inputs: z.array(z.string()).describe('Artefatos de entrada: caminhos no repositório, páginas da wiki, URLs'),
  constraints: z.array(z.string()),
});
export type WorkOrder = z.infer<typeof WorkOrderSchema>;

// ---------------------------------------------------------------- relatório de entrega

export const EvidenceSchema = z.object({
  kind: z.enum(['ci', 'test', 'file', 'commit', 'url', 'wiki', 'note']),
  ref: z.string().describe('Caminho, URL, id de execução de CI ou slug da wiki'),
  description: z.string(),
});

export const AcceptanceCheckSchema = z.object({
  criterion: z.string(),
  met: z.boolean(),
  evidence: z.string().describe('Como você comprovou (teste, arquivo, saída de comando)'),
});

/** Relatório de entrega como o modelo escreve. */
export const DeliveryReportOutSchema = z.object({
  summary: z.string().describe('O que foi feito, em 2-4 frases'),
  done: z.array(z.string()).describe('Itens concluídos'),
  evidence: z.array(EvidenceSchema),
  acceptance: z.array(AcceptanceCheckSchema).describe('Autoconferência contra cada critério de aceite'),
  risks: z.array(z.string()),
  questions: z.array(z.string()),
});
export type DeliveryReportOut = z.infer<typeof DeliveryReportOutSchema>;

/** Relatório completo: o que o modelo escreveu + o que o código mediu. */
export const DeliveryReportSchema = DeliveryReportOutSchema.extend({
  costUsd: z.number(),
  model: z.string(),
  attempt: z.number().int(),
  commit: z.string().nullable(),
  filesChanged: z.array(z.string()),
});
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;

// ---------------------------------------------------------------- parecer de revisão

export const ChangeRequestSchema = z.object({
  item: z.string().describe('Mudança pedida, específica e verificável'),
  severity: z.enum(SEVERITIES),
});

export const RubricScoreSchema = z.object({
  criterion: z.string(),
  score: z.number().describe('0 = ausente, 1 = fraco, 2 = ok, 3 = excelente'),
  note: z.string(),
});

/** Parecer de revisão: aprovado ou lista de mudanças, item a item, com severidade. */
export const ReviewVerdictOutSchema = z.object({
  approved: z.boolean(),
  summary: z.string(),
  changes: z.array(ChangeRequestSchema),
  rubric: z.array(RubricScoreSchema),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictOutSchema>;
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

// ---------------------------------------------------------------- CEO

export const ApprovalAskSchema = z.object({
  kind: ApprovalAskKind,
  title: z.string(),
  justification: z.string(),
  amountUsd: z.number().nullable(),
});
export type ApprovalAsk = z.infer<typeof ApprovalAskSchema>;

export const CeoOrderSchema = z.object({
  team: z.string().describe('Id do time (ex.: produto, engenharia, qa, growth)'),
  title: z.string(),
  objective: z.string(),
  context: z.string(),
  acceptanceCriteria: z.array(z.string()),
  budgetUsd: z.number().describe('Teto em USD para o time cumprir esta ordem'),
  dependsOn: z.array(z.string()).describe('Times cuja entrega deste ciclo precisa vir antes'),
});
export type CeoOrder = z.infer<typeof CeoOrderSchema>;

export const CeoDirectiveOutSchema = z.object({
  decision: z.enum(CEO_DECISIONS),
  summary: z.string().describe('Uma frase que vira o balão de fala do CEO'),
  rationale: z.string(),
  orders: z.array(CeoOrderSchema),
  approvals: z.array(ApprovalAskSchema).describe('Ações irreversíveis que precisam do Conselho'),
});
export type CeoDirective = z.infer<typeof CeoDirectiveOutSchema>;

export const ArbitrationOutSchema = z.object({
  decision: z.enum(['accept', 'drop', 'board']),
  rationale: z.string(),
});
export type Arbitration = z.infer<typeof ArbitrationOutSchema>;

// ---------------------------------------------------------------- líderes

export const PlannedTaskSchema = z.object({
  role: z.string().describe('Id do cargo trabalhador que executa'),
  kind: z.enum(TASK_KINDS),
  title: z.string(),
  objective: z.string(),
  context: z.string(),
  acceptanceCriteria: z.array(z.string()),
  budgetUsd: z.number(),
});
export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

export const LeadPlanOutSchema = z.object({
  summary: z.string(),
  tasks: z.array(PlannedTaskSchema),
});
export type LeadPlan = z.infer<typeof LeadPlanOutSchema>;

export const RespecOutSchema = z.object({
  summary: z.string(),
  objective: z.string(),
  context: z.string(),
  acceptanceCriteria: z.array(z.string()),
});
export type Respec = z.infer<typeof RespecOutSchema>;

/** Relatório condensado do líder para o CEO (o CEO nunca lê código). */
export const TeamReportOutSchema = z.object({
  summary: z.string(),
  deliverables: z.array(z.object({ title: z.string(), ref: z.string() })),
  risks: z.array(z.string()),
  questions: z.array(z.string()),
  needsApproval: z.array(ApprovalAskSchema),
});
export type TeamReportOut = z.infer<typeof TeamReportOutSchema>;

export const TeamReportSchema = TeamReportOutSchema.extend({
  team: z.string(),
  cycle: z.number().int(),
  costUsd: z.number(),
  tasksDone: z.number().int(),
  tasksFailed: z.number().int(),
});
export type TeamReport = z.infer<typeof TeamReportSchema>;

// ---------------------------------------------------------------- staff

export const OneLinerOutSchema = z.object({ text: z.string() });
export const WikiPageOutSchema = z.object({
  title: z.string(),
  body: z.string().describe('Markdown'),
  tags: z.array(z.string()),
});
export type WikiPageOut = z.infer<typeof WikiPageOutSchema>;

/** Entrega de quem trabalha numa sandbox hospedada: relatório + arquivos produzidos. */
export const HostedDeliveryOutSchema = z.object({
  report: DeliveryReportOutSchema,
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
