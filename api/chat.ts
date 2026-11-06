import { DEFAULT_OMNI_BASE_URL, OPENROUTER_API_KEY, runOmniRouteAgentStream } from '../src/lib/omniroute-agent';
import { authenticateApiRequest, authenticationErrorResponse } from '../src/lib/server/supabase-auth';
import { createVercelHandler } from '../src/lib/server/vercel';

export const config = { supportsResponseStreaming: true };

interface ChatRequestBody {
  messages?: Array<{ role?: string; content?: string }>;
  model?: string;
  effort?: string;
}

async function post(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as ChatRequestBody;
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    if (rawMessages.length === 0) {
      return Response.json(
        { error: 'Messages array is required and cannot be empty.' },
        { status: 400 },
      );
    }

    const result = await runOmniRouteAgentStream({
      rawMessages,
      requestedModel: body.model,
      effort: body.effort,
      baseUrl: (process.env.OMNI_BASE_URL ?? DEFAULT_OMNI_BASE_URL).replace(/\/+$/, ''),
      apiKeys: [process.env.OMNI_API_KEY_1, process.env.OMNI_API_KEY_2].filter(
        (key): key is string => Boolean(key?.trim()),
      ),
      openRouterApiKey: process.env.OPENROUTER_API_KEY ?? OPENROUTER_API_KEY,
    });
    return new Response(result.body, {
      status: result.status,
      headers: { ...result.headers, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export default createVercelHandler(post, ['POST']);