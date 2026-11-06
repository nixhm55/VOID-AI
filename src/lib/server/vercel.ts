import type { IncomingMessage, ServerResponse } from 'node:http';

interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

type ApiRoute = (request: Request) => Promise<Response>;

async function toWebRequest(req: VercelRequest): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  const authorization = req.headers.authorization;
  const contentType = req.headers['content-type'];
  if (typeof authorization === 'string') headers.set('authorization', authorization);
  if (typeof contentType === 'string') headers.set('content-type', contentType);

  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (chunks.length > 0) body = new Uint8Array(Buffer.concat(chunks));
    }
  }

  return new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function writeWebResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  while (!res.destroyed) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!res.write(Buffer.from(value))) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          res.off('drain', onDrain);
          res.off('close', onClose);
          res.off('error', onError);
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
      });
    }
  }
  if (!res.destroyed) res.end();
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

    try {
      const request = await toWebRequest(req);
      await writeWebResponse(await route(request), res);
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.end();
        return;
      }
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }));
    }
  };
}