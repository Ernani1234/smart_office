import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { newEvent } from '@office/contracts';
import { createLogger, createServices, OfficeTemporal, readEnv, startWorker, type RunningWorker } from '@office/engine';
import { registerRoutes } from './routes';
import { registerSetupRoutes } from './setup-routes';
import { registerWs } from './ws';

const log = createLogger('api');

interface Office {
  stop(): Promise<void>;
}

let office: Office | null = null;
let restarting: Promise<void> | null = null;

/** Religa a empresa no mesmo processo (ex.: a chave da OpenAI acabou de ser salva). */
function restart(reason: string): Promise<void> {
  restarting ??= (async () => {
    log.info(`religando: ${reason}`);
    await office?.stop();
    office = null;
    for (let attempt = 1; !office; attempt++) {
      try {
        office = await boot();
      } catch (err) {
        if (attempt >= 3) throw err;
        log.warn(`religar falhou (${attempt}/3): ${String(err)}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  })()
    .catch((err) => {
      log.error(`não consegui religar: ${String((err as Error)?.stack ?? err)}`);
      process.exit(1);
    })
    .finally(() => {
      restarting = null;
    });
  return restarting;
}

async function boot(): Promise<Office> {
  const env = readEnv();
  const services = await createServices(env);
  const temporal = new OfficeTemporal(env);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const abort = new AbortController();
  let worker: Promise<RunningWorker | null> = Promise.resolve(null);
  let reconcileTimer: NodeJS.Timeout | null = null;

  const stop = async () => {
    abort.abort();
    if (reconcileTimer) clearInterval(reconcileTimer);
    await app.close().catch(() => undefined);
    await (await worker)?.stop().catch(() => undefined);
    await temporal.close();
    await services.close().catch(() => undefined);
  };

  try {
    await app.register(cors, {
      origin: [env.http.corsOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    });
    await app.register(websocket);

    // Autenticação opcional (VPS): Authorization: Bearer <OFFICE_TOKEN> ou ?token=
    if (env.http.token) {
      app.addHook('onRequest', async (req, reply) => {
        if (!req.url.startsWith('/api') && !req.url.startsWith('/ws')) return;
        if (req.url.startsWith('/api/health')) return;
        const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
        const query = new URL(req.url, 'http://x').searchParams.get('token');
        if (header !== env.http.token && query !== env.http.token) {
          await reply.code(401).send({ error: 'Não autorizado' });
        }
      });
    }

    registerRoutes(app, services, temporal);
    registerSetupRoutes(app, services, { restart });
    registerWs(app, services);

    // Em produção a API também serve o build do front.
    const webDist = path.join(env.root, 'apps', 'web', 'dist');
    if (existsSync(path.join(webDist, 'index.html'))) {
      await app.register(fastifyStatic, { root: webDist, wildcard: false });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.code(404).send({ error: 'Não encontrado' });
        return reply.sendFile('index.html');
      });
    }

    await services.syncStaff();
    await services.events.append(
      newEvent('company.booted', { mode: env.mode, companyName: services.roles.get().company.name, version: env.version }),
    );

    if (env.embedWorker) {
      worker = startWorker(services, abort.signal)
        .then((w) => {
          w.done.catch((err) => log.error(`worker parou: ${String(err)}`));
          return w;
        })
        .catch((err) => {
          if (!abort.signal.aborted) log.error(`worker não subiu: ${String(err)}`);
          return null;
        });
    }
    services.market.start();

    // Missões criadas sem workflow (ex.: Temporal estava fora do ar) começam assim que der.
    const reconcile = async () => {
      if (!(await temporal.ping())) return;
      for (const m of await services.missions.running()) {
        if (!m.workflowId) {
          try {
            const wf = await temporal.startMission(m.id);
            await services.missions.setWorkflow(m.id, wf);
            log.info(`missão ${m.id} iniciada (pendente)`);
          } catch (err) {
            log.warn(`não consegui iniciar ${m.id}: ${String(err)}`);
          }
        }
      }
    };
    reconcileTimer = setInterval(() => void reconcile(), 5000);
    void reconcile();

    await app.listen({ host: env.http.host, port: env.http.port });
  } catch (err) {
    await stop();
    throw err;
  }

  log.info(
    `API em http://${env.http.host}:${env.http.port} · modo ${env.mode} · banco ${services.db.kind} · barramento ${services.bus.kind}`,
  );
  if (env.mode === 'real') {
    log.info(
      `MODO REAL: chamadas cobradas na conta OpenAI (${env.setup.keyHint}, ${env.setup.keySource === 'ui' ? 'chave da tela inicial' : 'chave do ambiente'}), até o teto de cada missão.`,
    );
    if (env.sandboxNote) log.warn(env.sandboxNote);
  } else if (env.setup.required) {
    log.info('Abra o escritório e cole sua chave da OpenAI para ligar o modo real. Enquanto isso: simulação, nada é cobrado.');
  } else {
    log.info('MODO SIMULAÇÃO (LLM_PROVIDER=sim): custo calculado com a tabela real, nada é cobrado.');
  }
  return { stop };
}

const shutdown = async (signal: string) => {
  log.info(`${signal}: encerrando…`);
  await restarting?.catch(() => undefined);
  await office?.stop().catch(() => undefined);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

boot()
  .then((o) => {
    office = o;
  })
  .catch((err) => {
    log.error(String(err?.stack ?? err));
    process.exit(1);
  });
