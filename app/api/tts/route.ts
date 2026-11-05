import {
  resolveDeepgramVoiceModel,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  synthesizeSpeechViaDeepgram,
  synthesizeSpeechViaOmniRoute,
} from '../../../src/lib/tools';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../_lib/supabase-auth';

export const runtime = 'edge';

export async function GET(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const url = new URL(req.url);
    const text = (url.searchParams.get('q') ?? url.searchParams.get('text') ?? '').trim();
    const lang = (url.searchParams.get('tl') ?? url.searchParams.get('lang') ?? 'en-US').trim();
    const voice = (url.searchParams.get('voice') ?? '').trim() || undefined;

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
  } catch (err) {
    const authResponse = authenticationErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : 'TTS error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as Record<string, unknown>;
    const text = String(body.q ?? body.text ?? body.input ?? '').trim();
    const lang = String(body.tl ?? body.lang ?? 'en-US').trim();
    const voice = String(body.voice ?? '').trim() || undefined;
    const model = String(body.model ?? '').trim() || undefined;

    if (!text) {
      return Response.json({ error: 'Missing text parameter' }, { status: 400 });
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
  } catch (err) {
    const authResponse = authenticationErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : 'TTS error';
    return Response.json({ error: message }, { status: 500 });
  }
}
