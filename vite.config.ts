import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeOmniRouteAgent } from './src/lib/omniroute-agent';
import {
  authenticateApiRequest,
  AuthenticationRequiredError,
} from './app/api/_lib/supabase-auth';
import {
  DEFAULT_OMNI_BASE_URL,
  OPENROUTER_API_KEY,
  cleanTrilingualText,
  convertSpokenHintFast,
  executeOmniRouteSearch,
  resolveDeepgramVoiceModel,
  synthesizeSpeechViaDeepgram,
  synthesizeSpeechViaOmniRoute,
} from './src/lib/tools';

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function rejectUnauthenticated(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string>,
): Promise<boolean> {
  const authRequest = new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method: req.method ?? 'GET',
    headers: req.headers.authorization
      ? { Authorization: req.headers.authorization }
      : undefined,
  });

  try {
    await authenticateApiRequest(authRequest, {
      url: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
      publishableKey:
        env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return false;
  } catch (error) {
    const status = error instanceof AuthenticationRequiredError ? 401 : 503;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(
      JSON.stringify({
        error:
          status === 401
            ? 'A valid sign-in session is required.'
            : 'Supabase API authentication is not configured on the server.',
      }),
    );
    return true;
  }
}

function omniRouteApiPlugin(env: Record<string, string>): Plugin {
  const baseUrl = (
    env.OMNI_BASE_URL ||
    process.env.OMNI_BASE_URL ||
    DEFAULT_OMNI_BASE_URL
  ).replace(/\/+$/, '');

  const apiKeys = [
    env.OMNI_API_KEY_1 || process.env.OMNI_API_KEY_1,
    env.OMNI_API_KEY_2 || process.env.OMNI_API_KEY_2,
  ].filter((key): key is string => Boolean(key?.trim()));

  const openRouterApiKey =
    env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    OPENROUTER_API_KEY;

  const deepgramApiKey = (
    env.DEEPGRAM_API_KEY ||
    process.env.DEEPGRAM_API_KEY ||
    ''
  ).trim();

  const attachMiddleware = (
    middlewares: {
      use: (
        route: string,
        fn: (
          req: IncomingMessage,
          res: ServerResponse,
          next: () => void,
        ) => void,
      ) => void;
    },
  ) => {
    // 1. ElevenLabs Text-to-Speech via OmniRoute (/api/tts) with neural fallback
    middlewares.use('/api/tts', async (req, res) => {
      if (await rejectUnauthenticated(req, res, env)) return;
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, POST');
        res.end();
        return;
      }

      try {
        let text = '';
        let tl = 'en-US';
        let voice: string | undefined;

        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          text = String(body.q ?? body.text ?? body.input ?? '').trim();
          tl = String(body.tl ?? body.lang ?? 'en-US').trim();
          voice = String(body.voice ?? '').trim() || undefined;
        } else {
          const reqUrl = new URL(req.url ?? '', 'http://localhost');
          text = (reqUrl.searchParams.get('q') ?? '').trim();
          tl = (reqUrl.searchParams.get('tl') ?? 'en-US').trim();
          voice = (reqUrl.searchParams.get('voice') ?? '').trim() || undefined;
        }

        if (!text) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing text parameter q' }));
          return;
        }

        // Deepgram Flux voices (e.g. Meena) are served by /v2/speak; every other
        // voice keeps using the ElevenLabs / OmniRoute pipeline.
        const deepgramModel = resolveDeepgramVoiceModel(voice);
        const result = deepgramModel
          ? await synthesizeSpeechViaDeepgram({
              text,
              model: deepgramModel,
              apiKey: deepgramApiKey,
            })
          : await synthesizeSpeechViaOmniRoute({
              text,
              lang: tl,
              voice,
              baseUrl,
              apiKeys,
            });

        const buffer = Buffer.from(result.audioBuffer);
        res.statusCode = 200;
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('X-TTS-Provider', result.provider);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('Cache-Control', 'private, no-store');
        res.end(buffer);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'TTS error',
          }),
        );
      }
    });

    // 2. Direct Web Search endpoint (/api/search) via OmniRoute (Tavily, Serper, SearXNG)
    middlewares.use('/api/search', async (req, res) => {
      if (await rejectUnauthenticated(req, res, env)) return;
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.end();
        return;
      }

      try {
        const body = await readJsonBody(req);
        const query = String(body.query ?? body.q ?? '').trim();
        if (!query) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Search query is required' }));
          return;
        }

        const searchRes = await executeOmniRouteSearch({
          query,
          baseUrl,
          apiKeys,
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(searchRes));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Search error',
          }),
        );
      }
    });

    // 3. Fast Trilingual Voice Script Converter (/api/transcribe)
    middlewares.use('/api/transcribe', async (req, res) => {
      if (await rejectUnauthenticated(req, res, env)) return;
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.end();
        return;
      }

      try {
        const body = await readJsonBody(req);
        const browserHint = cleanTrilingualText(String(body.hint ?? ''));
        const lang = String(body.lang ?? 'en').trim().toLowerCase();

        if (!browserHint) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ text: '' }));
          return;
        }

        const converted = await convertSpokenHintFast({
          hint: browserHint,
          lang,
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            text: converted || browserHint,
          }),
        );
      } catch {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ text: '' }));
      }
    });

    // 4. Main Chat Completion SSE endpoint (/api/chat)
    middlewares.use('/api/chat', async (req, res) => {
      if (await rejectUnauthenticated(req, res, env)) return;
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.end();
        return;
      }

      try {
        const body = await readJsonBody(req);
        const rawMessages = Array.isArray(body.messages)
          ? (body.messages as Array<{ role?: string; content?: string }>)
          : [];
        const requestedModel = String(body.model ?? '');

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        await executeOmniRouteAgent({
          rawMessages,
          requestedModel,
          baseUrl,
          apiKeys,
          openRouterApiKey,
          onSseFrame: (frame) => {
            if (!res.writableEnded) {
              res.write(frame);
            }
          },
        });

        if (!res.writableEnded) {
          res.end();
        }
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                err instanceof Error ? err.message : 'Internal server error',
            }),
          );
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    });
  };

  return {
    name: 'omniroute-api-middleware',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), omniRouteApiPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
