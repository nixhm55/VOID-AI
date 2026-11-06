import {
  OPENROUTER_API_KEY,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  runOmniRouteAgentStream,
} from '../../../src/lib/omniroute-agent';

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

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    if (rawMessages.length === 0) {
      return Response.json(
        { error: 'Messages array is required and cannot be empty.' },
        { status: 400 },
      );
    }

    const agentResponse = await runOmniRouteAgentStream({
      rawMessages,
      requestedModel: body.model,
      effort: body.effort,
      signal: req.signal,
      baseUrl: resolveOmniBaseUrl(),
      apiKeys: resolveOmniApiKeys(),
      openRouterApiKey:
        process.env.OPENROUTER_API_KEY ?? OPENROUTER_API_KEY,
    });

    return new Response(agentResponse.body, {
      status: agentResponse.status,
      headers: agentResponse.headers,
    });
  } catch (error) {
    if (req.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
