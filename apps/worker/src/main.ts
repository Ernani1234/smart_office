import { createLogger, createServices, readEnv, startWorker } from '@office/engine';

// Worker standalone para o modo completo (Docker Compose / VPS): Postgres e Redis
// compartilhados com a API, quantas réplicas quiser na mesma fila.

const log = createLogger('worker');

async function main() {
  const env = readEnv();
  if (!env.databaseUrl) {
    throw new Error('Worker separado precisa de DATABASE_URL (PGlite só aceita um processo; no modo local o worker roda dentro da API).');
  }
  if (!env.redisUrl) log.warn('Sem REDIS_URL: eventos deste worker não chegam às abas abertas em tempo real.');
  const services = await createServices(env);
  const worker = await startWorker(services);
  const stop = async () => {
    await worker.stop();
    await services.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  await worker.done;
}

main().catch((err) => {
  log.error(String(err?.stack ?? err));
  process.exit(1);
});
