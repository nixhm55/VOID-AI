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
  if (
    error instanceof Error &&
    error.message.startsWith('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY')
  ) {
    return Response.json(
      { error: 'Supabase API authentication is not configured on the server.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return null;
}

export interface SupabaseApiConfig {
  url?: string;
  publishableKey?: string;
}

function getServerSupabaseConfig(config?: SupabaseApiConfig) {
  const url = (config?.url ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
  const publishableKey = (
    config?.publishableKey ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  )?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the server environment.',
    );
  }

  return { url, publishableKey };
}

/** Use the caller's JWT so all database requests continue to obey RLS. */
export async function authenticateApiRequest(
  request: Request,
  config?: SupabaseApiConfig,
): Promise<{ supabase: SupabaseClient; user: User }> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthenticationRequiredError();

  const { url, publishableKey } = getServerSupabaseConfig(config);
  const supabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new AuthenticationRequiredError();

  return { supabase, user: data.user };
}
