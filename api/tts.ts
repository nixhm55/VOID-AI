import {
  resolveDeepgramVoiceModel,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  synthesizeSpeechViaDeepgram,
  synthesizeSpeechViaOmniRoute,
} from '../src/lib/tools';
import { authenticateApiRequest, authenticationErrorResponse } from '../src/lib/server/supabase-auth';
import { createVercelHandler } from '../src/lib/server/vercel';

async function handle(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    let text: string;
    let lang: string;
    let voice: string | undefined;
    let model: string | undefined;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      text = (url.searchParams.get('q') ?? url.searchParams.get('text') ?? '').trim();
      lang = (url.searchParams.get('tl') ?? url.searchParams.get('lang') ?? 'en-US').trim();
      voice = url.searchParams.get('voice')?.trim() || undefined;
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      text = String(body.q ?? body.text ?? body.input ?? '').trim();
      lang = String(body.tl ?? body.lang ?? 'en-US').trim();
      voice = String(body.voice ?? '').trim() || undefined;
      model = String(body.model ?? '').trim() || undefined;
    }

    if (!text) {
      return Response.json({ error: 'Missing text parameter q' }, { status: 400 });
    }

    const deepgramModel = resolveDeepgramVoiceModel(voice);
    const result = deepgramModel
      ? await synthesizeSpeechViaDeepgram({ text, model: deepgramModel })
      : await synthesizeSpeechViaOmniRoute({
          text,
          lang,
          voice,
          model,
          baseUrl: resolveOmniBaseUrl(),
          apiKeys: resolveOmniApiKeys(),
        });

    return new Response(result.audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'X-TTS-Provider': result.provider,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      { error: error instanceof Error ? error.message : 'TTS error' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export default createVercelHandler(handle, ['GET', 'POST']);