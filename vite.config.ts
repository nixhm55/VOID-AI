import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import chatHandler from './api/chat';
import searchHandler from './api/search';
import ttsHandler from './api/tts';
import transcribeHandler from './api/transcribe';

/**
 * Mounts the root `/api/*.ts` Vercel Serverless Functions during local Vite
 * `dev` and `preview` so local development mirrors Vercel production 1:1
 * without affecting the static frontend production build (`vite build`).
 */
function vercelServerlessDevAdapter(env: Record<string, string>): Plugin {
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const routes: Record<
    string,
    (req: IncomingMessage, res: ServerResponse) => Promise<void>
  > = {
    '/api/chat': chatHandler,
    '/api/search': searchHandler,
    '/api/tts': ttsHandler,
    '/api/transcribe': transcribeHandler,
  };

  const attach = (middlewares: {
    use: (
      fn: (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
      ) => void,
    ) => void;
  }) => {
    middlewares.use((req, res, next) => {
      const pathname = (req.url ?? '').split('?')[0];
      const handler = routes[pathname];
      if (!handler) {
        next();
        return;
      }
      void handler(req, res);
    });
  };

  return {
    name: 'vercel-serverless-dev-adapter',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), vercelServerlessDevAdapter(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
