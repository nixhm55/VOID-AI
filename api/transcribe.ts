import {
  cleanTrilingualText,
  convertSpokenHintFast,
  transcribeAudioViaVoidAi,
} from '../src/lib/tools/index.js';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth.js';
import { createVercelHandler } from '../src/lib/server/vercel.js';

function decodeBase64Audio(base64: string): Uint8Array {
  const cleaned = base64.replace(/^data:audio\/[^;]+;base64,/i, '').trim();
  const buf = Buffer.from(cleaned, 'base64');
  return new Uint8Array(buf);
}

async function post(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const contentType = req.headers.get('content-type') || '';

    // 1. Multipart audio file upload for OpenAI / VoidAI STT (`gpt-4o-transcribe` -> `gpt-4o-mini-transcribe` -> `whisper-1`)
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      const preferredModel = String(
        form.get('model') ?? 'gpt-4o-transcribe',
      ).trim();
      const language = String(form.get('language') ?? form.get('lang') ?? '')
        .trim()
        .toLowerCase();

      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const arrayBuf = await (file as Blob).arrayBuffer();
        const audioBytes = new Uint8Array(arrayBuf);
        const mimeType = (file as Blob).type || 'audio/webm';
        const result = await transcribeAudioViaVoidAi({
          audioBytes,
          mimeType,
          preferredModel,
          language:
            language && language !== 'auto' ? language : undefined,
        });

        return Response.json(
          {
            text: result.text,
            model: result.usedModel,
            fallbackUsed: result.fallbackUsed,
          },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-STT-Model': result.usedModel,
            },
          },
        );
      }
    }

    const body = (await req.json()) as Record<string, unknown>;
    const requestedModel = String(body.model ?? 'default').trim();
    const isDefaultManualMode = requestedModel === 'default';

    // 2. Base64 audio payload for OpenAI / VoidAI STT (`gpt-4o-transcribe` -> `gpt-4o-mini-transcribe` -> `whisper-1`)
    if (typeof body.audioBase64 === 'string' && body.audioBase64.trim()) {
      const audioBytes = decodeBase64Audio(body.audioBase64);
      const mimeType = String(body.mimeType ?? 'audio/webm').trim();
      const preferredModel =
        requestedModel === 'gemini' || requestedModel === 'default'
          ? 'gpt-4o-transcribe'
          : requestedModel;
      const lang = String(body.lang ?? body.language ?? '')
        .trim()
        .toLowerCase();

      try {
        const result = await transcribeAudioViaVoidAi({
          audioBytes,
          mimeType,
          preferredModel,
          language:
            isDefaultManualMode && lang && lang !== 'auto'
              ? lang
              : lang === 'ml' || lang === 'hi'
                ? lang
                : undefined,
        });

        return Response.json(
          {
            text: result.text,
            model: result.usedModel,
            fallbackUsed: result.fallbackUsed,
          },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-STT-Model': result.usedModel,
            },
          },
        );
      } catch (audioErr) {
        const fallbackHint = cleanTrilingualText(String(body.hint ?? ''));
        if (fallbackHint) {
          const fallbackText = await convertSpokenHintFast({
            hint: fallbackHint,
            lang,
            autoDetect: !isDefaultManualMode,
          });
          return Response.json(
            {
              text: fallbackText || fallbackHint,
              model: requestedModel,
              fallbackUsed: true,
            },
            {
              headers: { 'Cache-Control': 'private, no-store' },
            },
          );
        }
        throw audioErr;
      }
    }

    // 3. Spoken Hint Conversion (supports both Default EN/ML/HI mode and Gemini Auto-Detect mode)
    const hint = cleanTrilingualText(String(body.hint ?? ''));
    const lang = String(body.lang ?? 'en').trim().toLowerCase();
    if (!hint) {
      return Response.json(
        { text: '', model: requestedModel },
        {
          headers: { 'Cache-Control': 'private, no-store' },
        },
      );
    }

    const text = await convertSpokenHintFast({
      hint,
      lang,
      autoDetect: !isDefaultManualMode,
    });
    return Response.json(
      {
        text: text || hint,
        model: requestedModel,
        fallbackUsed: false,
      },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      { text: '' },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}

export default createVercelHandler(post, ['POST']);
