import { cleanTrilingualText, convertSpokenHintFast } from '../src/lib/tools';
import { authenticateApiRequest, authenticationErrorResponse } from '../src/lib/server/supabase-auth';
import { createVercelHandler } from '../src/lib/server/vercel';

async function post(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as Record<string, unknown>;
    const hint = cleanTrilingualText(String(body.hint ?? ''));
    const lang = String(body.lang ?? 'en').trim().toLowerCase();
    if (!hint) {
      return Response.json({ text: '' }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const text = await convertSpokenHintFast({ hint, lang });
    return Response.json({ text: text || hint }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ text: '' }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}

export default createVercelHandler(post, ['POST']);