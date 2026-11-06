import {
  type VoidAiEmbeddingModel,
  createEmbeddingsViaVoidAi,
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
    const rawInput = body.input ?? body.text ?? body.texts;

    if (
      !rawInput ||
      (typeof rawInput !== 'string' && !Array.isArray(rawInput))
    ) {
      return Response.json(
        { error: 'A string or array of strings is required in `input`.' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const requestedModel = String(
      body.model ?? 'text-embedding-3-large',
    ).trim() as VoidAiEmbeddingModel;

    const result = await createEmbeddingsViaVoidAi({
      input: rawInput as string | string[],
      model: requestedModel,
    });

    return Response.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Embedding-Model': result.model,
        'X-Embedding-Dimensions': String(result.dimensions),
      },
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Embedding generation error',
      },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export default createVercelHandler(post, ['POST']);
