import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultLogger, NativeConnection, Runtime, Worker } from '@temporalio/worker';
import type { Services } from '../services';
import { createLogger, sleep } from '../util';
import { createActivities } from './activities';

// Worker Temporal: executa workflows e atividades da fila da empresa. Conecta
// com retry (o dev server pode estar subindo junto) e para limpo no shutdown.

const log = createLogger('worker');

export interface RunningWorker {
  stop(): Promise<void>;
  done: Promise<void>;
}

let runtimeInstalled = false;

/** `signal` desiste do arranque (ex.: a API religou antes de o Temporal subir). */
export async function startWorker(services: Services, signal?: AbortSignal): Promise<RunningWorker> {
  const { address, namespace, taskQueue } = services.env.temporal;
  if (!runtimeInstalled) {
    // Só avisos e erros do SDK; o bundler de workflows é verboso no nível INFO.
    Runtime.install({ logger: new DefaultLogger((process.env.TEMPORAL_LOG_LEVEL as 'WARN' | undefined) ?? 'WARN') });
    runtimeInstalled = true;
  }
  let connection: NativeConnection | null = null;
  for (let attempt = 1; !connection; attempt++) {
    if (signal?.aborted) throw new Error('arranque do worker cancelado');
    try {
      connection = await NativeConnection.connect({ address });
    } catch (err) {
      if (attempt === 1 || attempt % 10 === 0)
        log.warn(`Temporal em ${address} indisponível (${(err as Error).message}). Tentando de novo…`);
      await sleep(Math.min(5000, 500 * attempt));
    }
  }
  const workflowsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows', 'index.ts');
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: createActivities(services),
    maxConcurrentActivityTaskExecutions: 24,
    maxConcurrentWorkflowTaskExecutions: 40,
  });
  const done = worker.run().finally(() => connection?.close());
  if (signal?.aborted) {
    worker.shutdown();
    await done.catch(() => undefined);
    throw new Error('arranque do worker cancelado');
  }
  log.info(`worker na fila "${taskQueue}" (${address}/${namespace})`);
  return {
    done,
    async stop() {
      worker.shutdown();
      await done.catch(() => undefined);
    },
  };
}
