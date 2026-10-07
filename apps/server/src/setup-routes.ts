import type { FastifyInstance } from 'fastify';
import { SetupKeySchema, type SetupStatus } from '@office/contracts';
import {
  checkOpenAIKey,
  keyLooksValid,
  LOCAL_ENV_FILE,
  maskKey,
  normalizeKey,
  writeLocalKey,
  type Env,
  type Services,
} from '@office/engine';

// Configuração inicial: a tela pede a chave da OpenAI, a API confere (listar
// modelos é gratuito), guarda em .env.local e religa a empresa em modo real no
// mesmo processo. Trocar de modo com missão rodando misturaria cérebros
// simulados e reais na mesma missão, então é recusado.

export interface Control {
  /** Religa a empresa no mesmo processo, relendo a configuração. */
  restart(reason: string): Promise<void>;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

export function setupStatus(env: Env): SetupStatus {
  const lockedReason = env.setup.explicit
    ? `Modo fixado por LLM_PROVIDER=${env.provider} no ambiente.`
    : !env.embedWorker
      ? 'Worker em processo separado: configure OPENAI_API_KEY e LLM_PROVIDER=openai no ambiente da API e do worker.'
      : null;
  return {
    required: env.setup.required,
    canConfigure: !lockedReason,
    lockedReason,
    keySource: env.setup.keySource,
    keyHint: env.setup.keyHint,
    sandboxNote: env.sandboxNote,
  };
}

/** Modelos que os cargos contratados vão chamar (inclui promoção e arte final). */
function requiredModels(s: Services): string[] {
  const roles = s.roles.get().roles;
  const out = new Set<string>([EMBEDDING_MODEL]);
  for (const agent of s.roles.roster()) {
    out.add(agent.model);
    const role = roles[agent.roleId];
    if (role?.escalation?.model) out.add(role.escalation.model);
    if (role?.finalModel) out.add(role.finalModel);
  }
  return [...out].sort();
}

export function registerSetupRoutes(app: FastifyInstance, s: Services, ctl: Control): void {
  const env = s.env;

  async function blocked(): Promise<string | null> {
    const status = setupStatus(env);
    if (!status.canConfigure) return status.lockedReason;
    const active = (await s.missions.running())[0];
    return active ? `Termine ou cancele a missão “${active.title}” antes de trocar o modo.` : null;
  }

  app.post('/api/setup/openai', async (req, reply) => {
    const parsed = SetupKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Cole a chave da OpenAI.' });
    const reason = await blocked();
    if (reason) return reply.code(409).send({ error: reason });

    const key = normalizeKey(parsed.data.apiKey);
    if (!keyLooksValid(key)) return reply.code(400).send({ error: 'Isso não parece uma chave da OpenAI (começa com sk-…).' });

    const check = await checkOpenAIKey(key, { baseURL: env.openai.baseURL, project: env.openai.project });
    if (!check.ok) return reply.code(check.status === 'invalid' ? 400 : 502).send({ error: check.message });

    const missing = check.models ? requiredModels(s).filter((m) => !check.models!.includes(m)) : [];
    if (missing.length && !parsed.data.force) {
      return reply.code(409).send({
        error: `Sua conta OpenAI não enxerga ${missing.length === 1 ? 'o modelo' : 'os modelos'} ${missing.join(', ')}.`,
        code: 'missing_models',
        missing,
      });
    }

    writeLocalKey(env.setup.localEnvFile, key);
    s.log.info(`chave da OpenAI (${maskKey(key)}) salva em ${LOCAL_ENV_FILE}; religando em modo real`);
    setTimeout(() => void ctl.restart('chave da OpenAI conectada'), 150);
    return {
      ok: true,
      restarting: true,
      keyHint: maskKey(key),
      missing,
      warning: check.status === 'unverified' ? check.message : null,
    };
  });

  app.delete('/api/setup/openai', async (_req, reply) => {
    const reason = await blocked();
    if (reason) return reply.code(409).send({ error: reason });
    if (env.setup.keySource !== 'ui') return reply.code(409).send({ error: 'Não há chave salva pela interface.' });
    writeLocalKey(env.setup.localEnvFile, null);
    s.log.info(`chave da OpenAI removida de ${LOCAL_ENV_FILE}; religando em simulação`);
    setTimeout(() => void ctl.restart('chave da OpenAI desconectada'), 150);
    return { ok: true, restarting: true };
  });
}
