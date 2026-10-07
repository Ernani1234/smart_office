import { defineConfig } from 'vitest/config';

// Testes nunca falam com a OpenAI: simulação mesmo com chave salva em .env.local.
export default defineConfig({
  test: { env: { LLM_PROVIDER: 'sim' } },
});
