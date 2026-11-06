import {
  isOpenAiTtsVoice,
  resolveDeepgramApiKey,
  resolveDeepgramVoiceModel,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  resolveVoidAiApiKey,
  synthesizeSpeechViaDeepgram,
  synthesizeSpeechViaOmniRoute,
  synthesizeSpeechViaVoidAi,
} from '../src/lib/tools/index.js';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth.js';
import { createVercelHandler } from '../src/lib/server/vercel.js';

async function handle(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    let text: string;
    let lang: string;
    let voice: string | undefined;
    let model: string | undefined;
    let speed: number | undefined;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      text = (
        url.searchParams.get('q') ??
        url.searchParams.get('text') ??
        ''
      ).trim();
      lang = (
        url.searchParams.get('tl') ??
        url.searchParams.get('lang') ??
        'en-US'
      ).trim();
      voice = url.searchParams.get('voice')?.trim() || undefined;
      model = url.searchParams.get('model')?.trim() || undefined;
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      text = String(body.q ?? body.text ?? body.input ?? '').trim();
      lang = String(body.tl ?? body.lang ?? 'en-US').trim();
      voice = String(body.voice ?? '').trim() || undefined;
      model = String(body.model ?? '').trim() || undefined;
      if (typeof body.speed === 'number' && Number.isFinite(body.speed)) {
        speed = body.speed;
      }
    }

    if (!text) {
      return Response.json(
        { error: 'Missing text parameter q' },
        { status: 400 },
      );
    }

    const deepgramModel = resolveDeepgramVoiceModel(voice);
    const hasDeepgramKey = Boolean(resolveDeepgramApiKey());
    const hasVoidAiKey = Boolean(resolveVoidAiApiKey());
    const isVoidTtsModel =
      !model ||
      model === 'gpt-4o-mini-tts' ||
      model === 'tts-1-hd' ||
      model === 'tts-1';

    let result;
    // Prioritize VoidAI Speech (`gpt-4o-mini-tts` -> `tts-1-hd` -> `tts-1`) whenever
    // an OpenAI voice is selected, or a VoidAI TTS model is active without a dedicated Deepgram key,
    // or as primary speech engine when VOIDAI_API_KEY is configured.
    if (
      hasVoidAiKey &&
      (isOpenAiTtsVoice(voice) || !deepgramModel || !hasDeepgramKey || isVoidTtsModel)
    ) {
      try {
        result = await synthesizeSpeechViaVoidAi({
          text,
          voice,
          model: model || 'gpt-4o-mini-tts',
          speed,
        });
      } catch {
        if (deepgramModel && hasDeepgramKey) {
          try {
            result = await synthesizeSpeechViaDeepgram({
              text,
              model: deepgramModel,
              speed,
            });
          } catch {
            result = await synthesizeSpeechViaOmniRoute({
              text,
              lang,
              voice,
              model: model || 'gpt-4o-mini-tts',
              speed,
              baseUrl: resolveOmniBaseUrl(),
              apiKeys: resolveOmniApiKeys(),
            });
          }
        } else {
          result = await synthesizeSpeechViaOmniRoute({
            text,
            lang,
            voice,
            model: model || 'gpt-4o-mini-tts',
            speed,
            baseUrl: resolveOmniBaseUrl(),
            apiKeys: resolveOmniApiKeys(),
          });
        }
      }
    } else if (deepgramModel && hasDeepgramKey) {
      try {
        result = await synthesizeSpeechViaDeepgram({
          text,
          model: deepgramModel,
          speed,
        });
      } catch {
        result = await synthesizeSpeechViaOmniRoute({
          text,
          lang,
          voice,
          model: model || 'gpt-4o-mini-tts',
          speed,
          baseUrl: resolveOmniBaseUrl(),
          apiKeys: resolveOmniApiKeys(),
        });
      }
    } else {
      result = await synthesizeSpeechViaOmniRoute({
        text,
        lang,
        voice,
        model: model || 'gpt-4o-mini-tts',
        speed,
        baseUrl: resolveOmniBaseUrl(),
        apiKeys: resolveOmniApiKeys(),
      });
    }

    return new Response(result.audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'X-TTS-Provider': result.provider,
        ...(result.usedModel ? { 'X-TTS-Model': result.usedModel } : {}),
        ...(result.usedVoice ? { 'X-TTS-Voice': result.usedVoice } : {}),
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
