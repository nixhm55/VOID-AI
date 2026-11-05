import {
  executeOmniRouteSearch,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
} from '../../../src/lib/tools';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../_lib/supabase-auth';

export const runtime = 'edge';

export async function POST(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as Record<string, unknown>;
    const query = String(body.query ?? body.q ?? '').trim();
    const maxResults =
      typeof body.maxResults === 'number' ? body.maxResults : 6;

    if (!query) {
      return Response.json(
        { error: 'Search query is required.' },
        { status: 400 },
      );
    }

    const results = await executeOmniRouteSearch({
      query,
      maxResults,
      baseUrl: resolveOmniBaseUrl(),
      apiKeys: resolveOmniApiKeys(),
    });

    return Response.json(results, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    const authResponse = authenticationErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : 'Search error';
    return Response.json({ error: message }, { status: 500 });
  }
}
