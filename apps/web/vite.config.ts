import net from 'node:net';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.OFFICE_API ?? 'http://127.0.0.1:4000';

/**
 * Enquanto a API liga (ou religa ao trocar de modo), responde 503 "ligando" em
 * vez de deixar o proxy devolver 500 e encher o terminal de ECONNREFUSED.
 */
function apiGate(target: string): Plugin {
  const { hostname, port } = new URL(target);
  let checkedAt = 0;
  let up = false;
  const isUp = () =>
    new Promise<boolean>((resolve) => {
      if (Date.now() - checkedAt < 400) return resolve(up);
      const socket = net.connect({ host: hostname, port: Number(port) || 80 });
      const done = (ok: boolean) => {
        socket.destroy();
        checkedAt = Date.now();
        up = ok;
        resolve(ok);
      };
      socket.setTimeout(400, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  return {
    name: 'office-api-gate',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) return next();
        void isUp().then((ok) => {
          if (ok) return next();
          res.statusCode = 503;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'A API ainda está ligando', booting: true }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [apiGate(api), react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
  },
});
