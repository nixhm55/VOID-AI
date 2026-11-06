import {
  executeOmniRouteSearch,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
} from '../src/lib/tools';
import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth';
import { createVercelHandler } from '../src/lib/server/vercel';

const DEFAULT_MAX_RESULTS = 6;
const MAX_RESULTS = 10;

function boundedMaxResults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value)));
}

async function post(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as Record<string, unknown>;
    const query = String(body.query ?? body.q ?? '').trim();
    if (!query) {
      return Response.json(
        { error: 'Search query is required.' },
        { status: 400 },
      );
    }

    const maxResults = boundedMaxResults(body.maxResults);
    const results = await executeOmniRouteSearch({
      query,
      maxResults,
      baseUrl: resolveOmniBaseUrl(),
      apiKeys: resolveOmniApiKeys(),
    });

    return Response.json({
      ...results,
      results: results.results.slice(0, maxResults),
    }, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      { error: error instanceof Error ? error.message : 'Search error' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export default createVercelHandler(post, ['POST']);