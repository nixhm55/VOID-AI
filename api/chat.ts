import {
  OPENROUTER_API_KEY,
  type TerminalToolContinuation,
  type WorkspaceContextInput,
  formatSseDataFrame,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  runOmniRouteAgentStream,
} from '../src/lib/omniroute-agent.js';
import {
  type VoidAiEmbeddingModel,
  buildModerationPayloadInput,
  createEmbeddingsViaVoidAi,
  isAgentModeTrigger,
  moderateContentViaVoidAi,
} from '../src/lib/tools/index.js';
import { inspectConnectedWorkspace } from '../src/lib/tools/terminal_executor.js';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth.js';
import { createVercelHandler } from '../src/lib/server/vercel.js';

export const config = { supportsResponseStreaming: true };

interface ChatRequestBody {
  messages?: Array<{ role?: string; content?: string; imageUrls?: string[] }>;
  model?: string;
  effort?: string;
  agentMode?: boolean;
  connectedFolders?: string[];
  terminalToolResult?: TerminalToolContinuation;
  embeddingModel?: VoidAiEmbeddingModel;
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

    const lastUserMessage = [...rawMessages]
      .reverse()
      .find((m) => m && m.role === 'user');
    const userText = String(lastUserMessage?.content ?? '').trim();
    const attachedImages =
      Array.isArray(body.imageUrls) && body.imageUrls.length > 0
        ? body.imageUrls
        : Array.isArray(lastUserMessage?.imageUrls)
          ? lastUserMessage.imageUrls
          : [];

    // Run VoidAI Moderation (`omni-moderation-latest`) and VoidAI Memory Embeddings
    // (`text-embedding-3-large` -> `text-embedding-3-small`) in parallel
    const moderationPromise =
      body.moderationEnabled !== false &&
      (userText || attachedImages.length > 0)
        ? moderateContentViaVoidAi({
            input: buildModerationPayloadInput({
              text: userText,
              imageUrls: attachedImages,
            }),
          }).catch(() => null)
        : Promise.resolve(null);

    const embeddingPromise = userText
      ? createEmbeddingsViaVoidAi({
          input: userText,
          model: body.embeddingModel || 'text-embedding-3-large',
        }).catch(() => null)
      : Promise.resolve(null);

    const [modResult] = await Promise.all([
      moderationPromise,
      embeddingPromise,
    ]);

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

    const connectedFolders = Array.isArray(body.connectedFolders)
      ? body.connectedFolders
      : [];
    const isAgent = isAgentModeTrigger(userText, Boolean(body.agentMode));

    let workspaceSummary: WorkspaceContextInput | undefined;
    if (isAgent) {
      try {
        workspaceSummary = inspectConnectedWorkspace(
          connectedFolders,
          userText,
        );
      } catch {
        workspaceSummary = undefined;
      }
    }

    const result = await runOmniRouteAgentStream({
      rawMessages,
      requestedModel: body.model,
      effort: body.effort,
      agentMode: Boolean(body.agentMode),
      connectedFolders,
      workspaceSummary,
      terminalToolResult: body.terminalToolResult,
      imageUrls: attachedImages,
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
