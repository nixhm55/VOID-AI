import {
  type ModerationInput,
  buildModerationPayloadInput,
  moderateContentViaVoidAi,
} from '../src/lib/tools/index.js';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth.js';
import { createVercelHandler } from '../src/lib/server/vercel.js';

async function post(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as Record<string, unknown>;

    const text = typeof body.text === 'string' ? body.text : undefined;
    const imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls.map((u) => String(u ?? ''))
      : undefined;
    const rawInput = body.input as ModerationInput | undefined;

    const payloadInput = buildModerationPayloadInput({
      text,
      imageUrls,
      rawInput,
    });

    if (
      !payloadInput ||
      (typeof payloadInput === 'string' && !payloadInput.trim()) ||
      (Array.isArray(payloadInput) && payloadInput.length === 0)
    ) {
      return Response.json(
        { error: 'Moderation input (text or imageUrls) is required.' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const result = await moderateContentViaVoidAi({
      input: payloadInput,
      model: 'omni-moderation-latest',
    });

    return Response.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Moderation-Model': result.model,
      },
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        id: `modr-safe-${Date.now()}`,
        model: 'omni-moderation-latest',
        flagged: false,
        results: [],
        gatewayAvailable: false,
        warning:
          error instanceof Error ? error.message : 'Moderation service error',
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export default createVercelHandler(post, ['POST']);
