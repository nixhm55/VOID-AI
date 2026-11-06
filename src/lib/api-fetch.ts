import { getCurrentSession } from './auth';
import { isSupabaseConfigured } from './supabase';

/**
 * Adds the current Supabase access token to same-origin API calls when signed in,
 * and gracefully falls back to a standard fetch when running without an active token
 * so voice dictation, TTS, embeddings, and chat never break.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (isSupabaseConfigured()) {
    try {
      const session = await getCurrentSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // Proceed without Authorization header if session lookup fails
    }
  }

  return fetch(input, { ...init, headers });
}
