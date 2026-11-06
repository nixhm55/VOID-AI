import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor() {
    super('A valid Supabase access token is required.');
    this.name = 'AuthenticationRequiredError';
  }
}

export function authenticationErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthenticationRequiredError) {
    return Response.json(
      { error: 'A valid sign-in session is required.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return null;
}

function getServerSupabaseConfig(): {
  url: string;
  publishableKey: string;
} | null {
  const url = (
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  )?.trim();
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

/**
 * Validates the caller's Supabase token when present and server config is available,
 * while gracefully allowing requests when running in local/guest mode or when
 * server-side Supabase env variables are not set on Vercel.
 */
export async function authenticateApiRequest(
  request: Request,
): Promise<{ supabase: SupabaseClient | null; user: User | null }> {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  const config = getServerSupabaseConfig();

  if (!token || !config) {
    return { supabase: null, user: null };
  }

  try {
    const supabase = createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return { supabase: null, user: null };
    }
    return { supabase, user: data.user };
  } catch {
    return { supabase: null, user: null };
  }
}
