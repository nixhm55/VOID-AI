import {
  OPENROUTER_API_KEY,
  formatSseDataFrame,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  runOmniRouteAgentStream,
} from '../src/lib/omniroute-agent.js';
import {
  buildModerationPayloadInput,
  moderateContentViaVoidAi,
} from '../src/lib/tools/index.js';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth.js';
import { createVercelHandler } from '../src/lib/server/vercel.js';

export const config = { supportsResponseStreaming: true };

interface ChatRequestBody {
  messages?: Array<{ role?: string; content?: string }>;
  model?: string;
  effort?: string;
  moderationEnabled?: boolean;
  imageUrls?: string[];
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

    // Safe pre-moderation check via `omni-moderation-latest` when enabled (default: true).
    // Fails open if the gateway disables public moderation so ordinary user content is never blocked.
    if (body.moderationEnabled !== false) {
      const lastUserMessage = [...rawMessages]
        .reverse()
        .find((m) => m && m.role === 'user' && m.content);
      const userText = String(lastUserMessage?.content ?? '').trim();

      if (userText || (body.imageUrls && body.imageUrls.length > 0)) {
        const modInput = buildModerationPayloadInput({
          text: userText,
          imageUrls: body.imageUrls,
        });
        const modResult = await moderateContentViaVoidAi({
          input: modInput,
        }).catch(() => null);

        if (modResult?.flagged) {
          const encoder = new TextEncoder();
          const flaggedStream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  formatSseDataFrame(
                    'This request was flagged by the safety moderation filter (`omni-moderation-latest`) and could not be processed.',
                  ),
                ),
              );
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
          });
          return new Response(flaggedStream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'private, no-store',
            },
          });
        }
      }
    }

    const result = await runOmniRouteAgentStream({
      rawMessages,
      requestedModel: body.model,
      effort: body.effort,
      signal: req.signal,
      baseUrl: resolveOmniBaseUrl(),
      apiKeys: resolveOmniApiKeys(),
      openRouterApiKey: process.env.OPENROUTER_API_KEY ?? OPENROUTER_API_KEY,
    });

    return new Response(result.body, {
      status: result.status,
      headers: { ...result.headers, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (req.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export default createVercelHandler(post, ['POST']);
