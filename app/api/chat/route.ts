import {
  DEFAULT_OMNI_BASE_URL,
  OPENROUTER_API_KEY,
  runOmniRouteAgentStream,
} from '../../../src/lib/omniroute-agent';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../_lib/supabase-auth';

export const runtime = 'edge';

export interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequestBody {
  messages?: ChatRequestMessage[];
  model?: string;
  effort?: string;
}

function getApiKeys(): string[] {
  const keys = [
    process.env.OMNI_API_KEY_1,
    process.env.OMNI_API_KEY_2,
  ].filter((k): k is string => Boolean(k && k.trim()));

  return keys;
}

export async function POST(req: Request): Promise<Response> {
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

    const baseUrl = (
      process.env.OMNI_BASE_URL ?? DEFAULT_OMNI_BASE_URL
    ).replace(/\/+$/, '');
    const apiKeys = getApiKeys();
    const openRouterApiKey =
      process.env.OPENROUTER_API_KEY ?? OPENROUTER_API_KEY;

    const agentResponse = await runOmniRouteAgentStream({
      rawMessages,
      requestedModel: body.model,
      baseUrl,
      apiKeys,
      openRouterApiKey,
    });

    return new Response(agentResponse.body, {
      status: agentResponse.status,
      headers: agentResponse.headers,
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
