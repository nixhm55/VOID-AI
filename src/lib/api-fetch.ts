import { getCurrentSession } from './auth';

/** Adds the current Supabase access token to same-origin protected API calls. */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const session = await getCurrentSession();
  if (!session?.access_token) {
    throw new Error('Sign in or continue as a guest to use this feature.');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
