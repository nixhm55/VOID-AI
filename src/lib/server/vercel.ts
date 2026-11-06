import type { IncomingMessage, ServerResponse } from 'node:http';

interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

type ApiRoute = (request: Request) => Promise<Response>;

async function toWebRequest(
  req: VercelRequest,
  res: ServerResponse,
  abortController: AbortController,
): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = new Headers();

  for (const [key, rawValue] of Object.entries(req.headers)) {
    if (typeof rawValue === 'string') {
      headers.set(key, rawValue);
    } else if (Array.isArray(rawValue)) {
      headers.set(key, rawValue.join(', '));
    }
  }

  const abortIfClientDisconnected = () => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  };

  req.once('aborted', abortIfClientDisconnected);
  req.once('close', () => {
    if (!res.writableEnded) {
      abortIfClientDisconnected();
    }
  });
  res.once('close', () => {
    if (!res.writableEnded) {
      abortIfClientDisconnected();
    }
  });

  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        if (abortController.signal.aborted) break;
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (chunks.length > 0) body = new Uint8Array(Buffer.concat(chunks));
    }
  }

  return new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method,
    headers,
    signal: abortController.signal,
    ...(body === undefined ? {} : { body }),
  });
}

async function writeWebResponse(
  response: Response,
  res: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (!res.destroyed && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted || res.destroyed) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            res.off('drain', onDrain);
            res.off('close', onClose);
            res.off('error', onError);
            signal.removeEventListener('abort', onClose);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onClose = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          res.once('drain', onDrain);
          res.once('close', onClose);
          res.once('error', onError);
          signal.addEventListener('abort', onClose, { once: true });
        });
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted || res.destroyed) {
      await reader.cancel().catch(() => {});
    }
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
}

export function createVercelHandler(
  route: ApiRoute,
  methods: string[],
): (req: VercelRequest, res: ServerResponse) => Promise<void> {
  const allowedMethods = methods.map((method) => method.toUpperCase());

  return async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (!allowedMethods.includes(method)) {
      res.statusCode = 405;
      res.setHeader('Allow', allowedMethods.join(', '));
      res.end();
      return;
    }

    const abortController = new AbortController();

    try {
      const request = await toWebRequest(req, res, abortController);
      const response = await route(request);
      await writeWebResponse(response, res, abortController.signal);
    } catch (error) {
      if (abortController.signal.aborted || res.headersSent || res.destroyed) {
        if (!res.destroyed && !res.writableEnded) res.end();
        return;
      }
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : 'Internal server error',
        }),
      );
    }
  };
}
