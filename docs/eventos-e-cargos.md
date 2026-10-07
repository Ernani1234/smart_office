# Schema de eventos e `roles.yaml`

O plano termina dizendo que "as duas peças de que todo o resto depende são o schema
de eventos e o roles.yaml". Este documento descreve as duas como estão implementadas.

## 1. Schema de eventos

Fonte: [`packages/contracts/src/events.ts`](../packages/contracts/src/events.ts) (Zod,
união discriminada por `type`). Todo evento é validado ao ser gravado — um evento fora
do schema é erro na hora, não um escritório corrompido depois.

### Envelope

| Campo | Tipo | Significado |
|---|---|---|
| `id` | inteiro | sequencial, atribuído pelo banco; ordena o log |
| `ts` | ISO 8601 | instante do registro |
| `type` | string | um dos tipos abaixo |
| `missionId` | string \| null | missão a que pertence (null = empresa) |
| `taskId` | string \| null | tarefa relacionada |
| `agentId` | string \| null | quem fez/sofreu |
| `data` | objeto | carga específica do tipo |

O log é **append-only** (tabela `events`). Tabelas como `missions`, `approvals` e
`ledger` existem para consulta rápida, mas a interface e o replay usam só o log: a
projeção [`applyEvent`](../packages/contracts/src/projection/apply.ts) é pura e
idempotente (reaplicar o mesmo `id` não muda nada).

### Tipos

**Empresa e equipe**

| Tipo | `data` | Efeito no escritório |
|---|---|---|
| `company.booted` | `mode`, `companyName`, `version` | — |
| `company.paused` / `company.resumed` | `by`, `reason` | alarme vermelho, todos congelam |
| `roles.updated` | `changes[]` | — |
| `agent.hired` | `name`, `roleId`, `title`, `team`, `level`, `model`, `effort`, `billing`, `desk`, `seed` | agente aparece (contratação nova entra pela porta) |
| `agent.promoted` | `fromModel`, `toModel`, `reason`, `by: board\|ladder` | faíscas e balão |
| `agent.status` | `activity`, `note` | ociosos e bloqueados vão para a copa |
| `agent.said` | `text`, `to` | balão de fala |
| `agent.thought` | `text` | resumo do raciocínio (streaming, por frase) |
| `agent.steered` | `text`, `from` | recado do Conselho |

**Missão e decisões**

| Tipo | `data` |
|---|---|
| `mission.created` | `title`, `brief`, `metric: net_profit`, `goalUsd`, `spendCapUsd`, `deadline`, `revenueSource` |
| `mission.started` | `workflowId` |
| `mission.cycle` | `cycle`, `trigger` (`start`, `reports`, `milestone:50`, `stagnation`, `approval_granted`…) |
| `ceo.decision` | `decision` (`delegate`/`wait`/`pivot`/`request_approval`), `summary`, `rationale`, `effort`, `orders[]`, `cycle` |
| `lead.planned` | `team`, `summary`, `tasks` |
| `report.submitted` | `report` (relatório condensado do líder, com custo medido por código) |
| `mission.launched` | `product`, `url`, `priceUsd` |
| `mission.completed` | `reason` (`goal_reached`/`budget_exhausted`/`deadline`/`cancelled`/`failed`), `netProfitUsd`, `revenueUsd`, `spentUsd`, `note` |

**Tarefas, trabalho e evidência**

| Tipo | `data` |
|---|---|
| `task.created` | `title`, `team`, `role`, `kind`, `parentId`, `workOrder` (ordem de serviço completa) |
| `task.assigned` | `assignee`, `reviewer`, `model`, `effort` |
| `task.started` | `attempt`, `model` |
| `tool.called` / `tool.result` | `callId`, `tool`, `label` / `ok`, `summary`, `ms` |
| `file.changed` | `path`, `op`, `additions`, `deletions` |
| `ci.started` / `ci.completed` | `runId`, `checks` / `ok`, `checks[]` (nome, ok, ms, fim da saída), `ms` |
| `pr.opened` / `pr.merged` | `branch`, `title`, `url`, `commit` |
| `delivery.submitted` | `report` (relatório de entrega + custo, modelo, tentativa, commit, arquivos) |
| `review.started` / `review.completed` | `reviewerId`, `round` / `verdict` (parecer: aprovado ou mudanças com severidade, rubrica) |
| `task.escalated` | `to` (`model`/`lead`/`ceo`/`board`), `fromModel`, `toModel`, `reason` |
| `task.respec` | `by`, `summary` |
| `task.completed` | `status` (`done`/`failed`/`cancelled`), `summary`, `costUsd` |

**Dinheiro e Conselho**

| Tipo | `data` |
|---|---|
| `cost.recorded` | `entryId`, `amountUsd`, `kind` (`llm`/`search`/`sandbox`/`image`…), `model`, `billing`, `role`, `team`, `tokens`, `note` |
| `revenue.recorded` | `entryId`, `orderId`, `grossUsd`, `netUsd`, `source` |
| `budget.warning` | `spentUsd`, `capUsd`, `pct` |
| `finance.goal_reached` | `netProfitUsd`, `goalUsd` |
| `approval.requested` | `approvalId`, `kind` (`spend`/`publish`/`contact`/`deploy`/`escalation`), `title`, `detail`, `amountUsd`, `requestedBy` |
| `approval.decided` | `approvalId`, `approved`, `note`, `by` |
| `wiki.written` | `slug`, `title`, `kind` |
| `analytics.snapshot` | `visits`, `signups`, `checkouts`, `source` |

### Transporte

`GET /ws?after=<id>`: o servidor assina o barramento **antes** de ler o backlog, manda o
backlog em lotes (`{type:"events", backlog:true}`), sinaliza `backlog_done` e emenda o
ao vivo sem buracos nem duplicatas. Reconectar com o último `id` recebido recupera só o
que faltou. Entre processos (API e workers separados) o barramento é Redis pub/sub.

## 2. `roles.yaml`

Fonte do schema: [`packages/contracts/src/roles.ts`](../packages/contracts/src/roles.ts).
Arquivo: [`config/roles.yaml`](../config/roles.yaml). A aba **Equipe** edita o arquivo
(preservando comentários) e a próxima chamada já usa o valor novo.

### Cargo (`roles.<id>`)

| Campo | Obrigatório | Significado |
|---|---|---|
| `title` | sim | nome do cargo |
| `team` | sim | id de um time em `teams` |
| `level` | sim | `executive` \| `lead` \| `worker` \| `staff` |
| `kind` | não | `llm` (padrão), `image` (designer) ou `code` |
| `model` | sim | modelo com preço em `pricing.yaml` |
| `finalModel` | não | designer: modelo da arte final |
| `effort` | não | `none` … `max` (padrão `medium`) |
| `reviewEffort` | não | líderes: esforço em code review |
| `pivotEffort` | não | CEO: esforço para pivôs e integração final |
| `billing` | não | `standard` \| `flex` \| `batch` |
| `taskBudgetUsd` | sim | teto por tarefa (o gateway recusa a chamada que estouraria) |
| `instances` | não | quantos agentes deste cargo (escala horizontal) |
| `names` | não | nomes dos agentes, na ordem das instâncias |
| `tools` | não | `workspace`, `shell`, `web`, `image` |
| `escalation` | não | `{ model, afterCiFailures }` — a escada de modelos |
| `prompt` | não | arquivo em `config/prompts/` |

### Regras validadas

- exatamente um `executive` (o CEO);
- cada time com trabalhadores tem **exatamente um** líder (sem gerente de gerente);
- quem tem `web` não pode ter `workspace` nem `shell` (isolamento contra injeção de prompt);
- todo `model`, `finalModel` e `escalation.model` precisa ter preço em `pricing.yaml`.

### Regras da empresa (`company.rules`)

| Regra | Padrão | Efeito |
|---|---|---|
| `maxReviewRounds` | 3 | depois disso: modelo maior → CEO → Conselho |
| `ciFailuresBeforePromotion` | 2 | Luna → Sol |
| `maxRespecs` | 1 | reescritas de especificação pelo líder antes de escalar ao CEO |
| `ceoMaxContextTokens` | 272000 | relatórios mais antigos saem do contexto do CEO |
| `approvalTimeoutHours` | 72 | pedido ao Conselho expira |
| `budgetWarningPct` | 0.8 | alerta de gasto |

### Promoções (`overrides`)

```yaml
overrides:
  dev-2: { model: gpt-6.1-sol }   # “promover” um funcionário sem deploy
```

O botão **Modelo** no inspetor grava aqui; **Voltar ao modelo do cargo** remove.
