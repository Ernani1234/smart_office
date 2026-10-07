import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ApprovalDecisionSchema,
  CreateMissionSchema,
  EFFORTS,
  OneLinerOutSchema,
  PromoteSchema,
  SteerSchema,
  newEvent,
  type HealthDto,
  type ServerConfig,
  type TaskDiffDto,
} from '@office/contracts';
import { BudgetExceededError, clip, newId, type OfficeTemporal, type RolesPatch, type Services } from '@office/engine';
import { setupStatus } from './setup-routes';

function parse<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const r = schema.safeParse(body);
  if (!r.success) {
    void reply.code(400).send({ error: 'Dados inválidos', details: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return null;
  }
  return r.data;
}

const RolesPatchSchema = z.object({
  roles: z
    .record(
      z.string(),
      z.object({
        model: z.string().optional(),
        finalModel: z.string().optional(),
        effort: z.enum(EFFORTS).optional(),
        reviewEffort: z.enum(EFFORTS).optional(),
        pivotEffort: z.enum(EFFORTS).optional(),
        billing: z.enum(['standard', 'flex', 'batch']).optional(),
        taskBudgetUsd: z.number().positive().max(1000).optional(),
        instances: z.number().int().min(0).max(12).optional(),
      }),
    )
    .optional(),
  overrides: z
    .record(z.string(), z.object({ model: z.string().optional(), effort: z.string().optional(), name: z.string().optional() }).nullable())
    .optional(),
  rules: z
    .object({
      maxReviewRounds: z.number().int().min(1).max(10).optional(),
      ciFailuresBeforePromotion: z.number().int().min(1).max(10).optional(),
      maxRespecs: z.number().int().min(0).max(5).optional(),
      approvalTimeoutHours: z.number().positive().optional(),
      budgetWarningPct: z.number().min(0.1).max(0.99).optional(),
    })
    .optional(),
});

export function registerRoutes(app: FastifyInstance, s: Services, temporal: OfficeTemporal): void {
  const env = s.env;

  // Ids que viram caminho no disco ou nome de branch: só letras, números, - e _.
  app.addHook('preValidation', async (req, reply) => {
    const params = (req.params ?? {}) as Record<string, string>;
    for (const key of ['missionId', 'taskId', 'id']) {
      const v = params[key];
      if (v !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(v)) {
        await reply.code(400).send({ error: `Parâmetro inválido: ${key}` });
        return;
      }
    }
  });

  async function runningWorkflows(): Promise<string[]> {
    return (await s.missions.running()).map((m) => m.workflowId).filter((w): w is string => Boolean(w));
  }

  app.get('/api/health', async (): Promise<HealthDto> => ({
    ok: true,
    temporal: temporal.connected,
    mode: env.mode,
    setupRequired: env.setup.required,
  }));

  app.get('/api/config', async (): Promise<ServerConfig> => ({
    mode: env.mode,
    companyName: s.roles.get().company.name,
    version: env.version,
    provider: env.provider,
    workerRuntime: env.workerRuntime,
    sandbox: env.sandbox,
    temporal: {
      address: env.temporal.address,
      namespace: env.temporal.namespace,
      connected: temporal.connected,
      uiUrl: env.temporal.uiUrl,
    },
    storage: s.db.kind === 'pglite' ? 'pglite' : 'postgres',
    bus: s.bus.kind,
    revenueSources: [...s.revenue.keys()],
    paused: await s.settings.isPaused(),
    authRequired: Boolean(env.http.token),
    roles: s.roles.get(),
    roster: s.roles.roster(),
    pricing: s.pricing.get(),
    integrations: {
      openai: env.provider === 'openai',
      github: Boolean(env.integrations.github),
      posthog: Boolean(env.integrations.posthog),
      langfuse: Boolean(env.integrations.langfuse || env.integrations.otlpEndpoint),
      tavily: Boolean(env.integrations.tavily),
      firecrawl: Boolean(env.integrations.firecrawl),
      redis: Boolean(env.redisUrl),
      postgres: Boolean(env.databaseUrl),
    },
    setup: setupStatus(env),
  }));

  // ------------------------------------------------------------ eventos
  app.get<{ Querystring: { after?: string; missionId?: string; limit?: string } }>('/api/events', async (req) => {
    return s.events.list({
      after: Number(req.query.after ?? 0),
      missionId: req.query.missionId || null,
      limit: Number(req.query.limit ?? 5000),
    });
  });

  // ------------------------------------------------------------ missões
  app.get('/api/missions', async () => s.missions.list());

  app.post('/api/missions', async (req, reply) => {
    const body = parse(CreateMissionSchema, req.body, reply);
    if (!body) return;
    const active = await s.missions.running();
    if (active.length > 0) {
      return reply.code(409).send({ error: `Já existe uma missão em andamento (“${active[0].title}”). Uma de cada vez.` });
    }
    const id = newId('m');
    const mission = await s.missions.create(id, body);
    await s.events.append(
      newEvent(
        'mission.created',
        {
          title: body.title,
          brief: body.brief,
          metric: 'net_profit',
          goalUsd: body.goalUsd,
          spendCapUsd: body.spendCapUsd,
          deadline: new Date(body.deadline).toISOString(),
          revenueSource: body.revenueSource,
        },
        { missionId: id },
      ),
    );
    try {
      const workflowId = await temporal.startMission(id);
      await s.missions.setWorkflow(id, workflowId);
      return { ...mission, workflowId };
    } catch (err) {
      return reply
        .code(202)
        .send({ ...mission, warning: `Temporal indisponível (${(err as Error).message}). A missão começa assim que ele subir.` });
    }
  });

  app.post<{ Params: { id: string } }>('/api/missions/:id/cancel', async (req, reply) => {
    const m = await s.missions.get(req.params.id);
    if (!m?.workflowId) return reply.code(404).send({ error: 'Missão sem workflow' });
    await temporal.cancel(m.workflowId);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/missions/:id/status', async (req, reply) => {
    const m = await s.missions.get(req.params.id);
    if (!m) return reply.code(404).send({ error: 'Missão não encontrada' });
    return { mission: m, workflow: m.workflowId ? await temporal.status(m.workflowId) : null };
  });

  // ------------------------------------------------------------ conselho
  app.get<{ Querystring: { status?: string } }>('/api/approvals', async (req) => s.approvals.list(req.query.status));

  app.post<{ Params: { id: string } }>('/api/approvals/:id', async (req, reply) => {
    const body = parse(ApprovalDecisionSchema, req.body, reply);
    if (!body) return;
    const decided = await s.approvals.decide(req.params.id, body.approved, body.note);
    if (!decided) return reply.code(409).send({ error: 'Pedido inexistente ou já decidido' });
    await s.events.append(
      newEvent(
        'approval.decided',
        { approvalId: decided.id, approved: body.approved, note: body.note, by: 'conselho' },
        { missionId: decided.missionId, taskId: decided.taskId },
      ),
    );
    if (decided.workflowId)
      await temporal.approval(decided.workflowId, { approvalId: decided.id, approved: body.approved, note: body.note });
    return decided;
  });

  app.post<{ Body: { reason?: string } }>('/api/panic', async (req) => {
    await s.settings.set('paused', true);
    await s.events.append(newEvent('company.paused', { by: 'conselho', reason: clip(String(req.body?.reason ?? 'Botão de pânico'), 200) }));
    await temporal.pause(await runningWorkflows());
    return { paused: true };
  });

  app.post('/api/resume', async () => {
    await s.settings.set('paused', false);
    await s.events.append(newEvent('company.resumed', { by: 'conselho' }));
    await temporal.resume(await runningWorkflows());
    return { paused: false };
  });

  // ------------------------------------------------------------ dinheiro
  app.get<{ Querystring: { missionId?: string; limit?: string } }>('/api/ledger', async (req) =>
    s.ledger.entries(req.query.missionId || null, Math.min(1000, Number(req.query.limit ?? 300))),
  );

  app.get<{ Querystring: { missionId?: string } }>('/api/finance', async (req) => s.ledger.totals(req.query.missionId || null));

  // ------------------------------------------------------------ equipe (roles.yaml)
  app.get('/api/roles', async () => ({
    roles: s.roles.get(),
    roster: s.roles.roster(),
    models: [...s.pricing.models()],
    imageModels: [...s.pricing.imageModels()],
  }));

  app.patch('/api/roles', async (req, reply) => {
    const body = parse(RolesPatchSchema, req.body, reply);
    if (!body) return;
    try {
      const changes = s.roles.update(body as RolesPatch, s.pricing.models(), s.pricing.imageModels());
      if (changes.length) {
        await s.events.append(newEvent('roles.updated', { changes }));
        await s.syncStaff();
      }
      return { changes, roles: s.roles.get(), roster: s.roles.roster() };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/promote', async (req, reply) => {
    const body = parse(PromoteSchema, req.body, reply);
    if (!body) return;
    const agent = s.roles.roster().find((a) => a.id === req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agente não encontrado' });
    try {
      s.roles.update(
        { overrides: { [agent.id]: { model: body.model, effort: body.effort } } },
        s.pricing.models(),
        s.pricing.imageModels(),
      );
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    await s.events.append(
      newEvent(
        'agent.promoted',
        { fromModel: agent.model, toModel: body.model, reason: 'decisão do Conselho', by: 'board' },
        { agentId: agent.id },
      ),
    );
    await s.syncStaff();
    return { ok: true, roster: s.roles.roster() };
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/reset', async (req, reply) => {
    const agent = s.roles.roster().find((a) => a.id === req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agente não encontrado' });
    s.roles.update({ overrides: { [agent.id]: null } }, s.pricing.models(), s.pricing.imageModels());
    const after = s.roles.roster().find((a) => a.id === agent.id)!;
    if (after.model !== agent.model) {
      await s.events.append(
        newEvent(
          'agent.promoted',
          { fromModel: agent.model, toModel: after.model, reason: 'volta ao modelo do cargo', by: 'board' },
          { agentId: agent.id },
        ),
      );
    }
    await s.syncStaff();
    return { ok: true };
  });

  /** Falar com o agente: o recado entra no próximo turno; a resposta curta sai na hora. */
  app.post<{ Params: { id: string } }>('/api/agents/:id/message', async (req, reply) => {
    const body = parse(SteerSchema, req.body, reply);
    if (!body) return;
    const agent = s.roles.roster().find((a) => a.id === req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agente não encontrado' });
    const active = (await s.missions.running())[0] ?? null;
    await s.messages.add(agent.id, null, body.text);
    await s.events.append(
      newEvent('agent.steered', { text: body.text, from: 'conselho' }, { agentId: agent.id, missionId: active?.id ?? null }),
    );
    const secretary = s.roles.roster().find((a) => a.roleId === 'secretaria');
    if (secretary) {
      void s.gateway
        .structured(
          { missionId: active?.id ?? null, taskId: null, agentId: agent.id, taskBudgetUsd: null },
          {
            roleId: secretary.roleId,
            model: secretary.model,
            effort: 'none',
            name: 'agent.ack',
            schemaName: 'one_liner',
            schema: OneLinerOutSchema,
            input: `Você é ${agent.name} (${agent.title}). O Conselho mandou: “${body.text}”. Responda em uma linha confirmando o que vai fazer.`,
            maxOutputTokens: 200,
            sim: { purpose: 'secretary.reply', seed: body.text.length },
          },
        )
        .then((r) =>
          s.events.append(
            newEvent('agent.said', { text: r.value.text, to: 'conselho' }, { agentId: agent.id, missionId: active?.id ?? null }),
          ),
        )
        .catch((err) => {
          if (!(err instanceof BudgetExceededError)) s.log.warn(`resposta do agente falhou: ${String(err)}`);
        });
    }
    return { ok: true };
  });

  // ------------------------------------------------------------ wiki
  app.get<{ Querystring: { q?: string } }>('/api/wiki', async (req) => {
    const q = req.query.q?.trim();
    if (!q) return s.wiki.list();
    const [vec] = await s.embedder.embed([q]).catch(() => [null]);
    return s.wiki.search(vec ?? null, q, 12);
  });

  app.get<{ Params: { slug: string } }>('/api/wiki/:slug', async (req, reply) => {
    const page = await s.wiki.get(req.params.slug);
    return page ?? reply.code(404).send({ error: 'Página não encontrada' });
  });

  // ------------------------------------------------------------ repositório
  app.get<{ Params: { missionId: string } }>('/api/repo/:missionId/tree', async (req) => s.repos.tree(req.params.missionId));

  app.get<{ Params: { missionId: string } }>('/api/repo/:missionId/log', async (req) => s.repos.log(req.params.missionId));

  app.get<{ Params: { missionId: string }; Querystring: { path?: string } }>('/api/repo/:missionId/file', async (req, reply) => {
    const content = req.query.path ? await s.repos.readFile(req.params.missionId, req.query.path) : null;
    return content === null ? reply.code(404).send({ error: 'Arquivo não encontrado' }) : { path: req.query.path, content };
  });

  app.get<{ Params: { missionId: string; taskId: string } }>(
    '/api/repo/:missionId/tasks/:taskId/diff',
    async (req): Promise<TaskDiffDto> => {
      const { missionId, taskId } = req.params;
      const merged = (await s.events.list({ missionId, types: ['pr.merged'], limit: 5000 })).find((e) => e.taskId === taskId);
      const d =
        merged && merged.type === 'pr.merged'
          ? await s.repos.mergedDiff(missionId, merged.data.commit)
          : await s.repos.diff(missionId, taskId);
      return { taskId, branch: s.repos.branchOf(taskId), diff: d.diff, files: d.files };
    },
  );

  // ------------------------------------------------------------ secretaria
  app.post('/api/secretary/summary', async () => {
    const recent = (await s.events.list({ after: Math.max(0, (await s.events.lastId()) - 400), limit: 400 })).filter((e) =>
      [
        'ceo.decision',
        'task.completed',
        'revenue.recorded',
        'approval.requested',
        'mission.launched',
        'ci.completed',
        'task.escalated',
      ].includes(e.type),
    );
    const sec = s.roles.roster().find((a) => a.roleId === 'secretaria');
    const sales = recent.filter((e) => e.type === 'revenue.recorded').length;
    const done = recent.filter((e) => e.type === 'task.completed').length;
    const pending = (await s.approvals.list('pending')).length;
    const text =
      env.mode === 'sim' || !sec
        ? `Resumo: ${done} tarefa(s) fechada(s), ${sales} venda(s) e ${pending} pedido(s) esperando o Conselho.`
        : (
            await s.gateway.structured(
              { missionId: null, taskId: null, agentId: sec.id, taskBudgetUsd: 0.01 },
              {
                roleId: sec.roleId,
                effort: 'none',
                name: 'secretary.summary',
                schemaName: 'one_liner',
                schema: OneLinerOutSchema,
                input: `Resuma para o Conselho em uma frase:\n${recent
                  .map((e) => `${e.type} ${JSON.stringify(e.data).slice(0, 160)}`)
                  .join('\n')
                  .slice(0, 12_000)}`,
                maxOutputTokens: 300,
                sim: { purpose: 'secretary.reply', seed: 1 },
              },
            )
          ).value.text;
    if (sec) await s.events.append(newEvent('agent.said', { text, to: 'conselho' }, { agentId: sec.id }));
    return { text };
  });
}
