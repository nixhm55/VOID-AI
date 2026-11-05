import type {
  AuthChangeEvent,
  AuthResponse,
  OAuthResponse,
  Session,
  Subscription,
  User,
} from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

export type OAuthProvider = 'google' | 'github';
export type AppClientType = 'web' | 'desktop' | 'ios' | 'android';

export interface AuthSessionResult {
  user: User | null;
  session: Session | null;
}

async function unwrapAuthResponse(
  response: Promise<AuthResponse>,
): Promise<AuthSessionResult> {
  const { data, error } = await response;
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export function signInWithOAuth(
  provider: OAuthProvider,
  redirectTo = window.location.origin,
): Promise<OAuthResponse> {
  return getSupabaseClient().auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
}

export function linkOAuthIdentity(
  provider: OAuthProvider,
  redirectTo = window.location.origin,
): Promise<OAuthResponse> {
  return getSupabaseClient().auth.linkIdentity({
    provider,
    options: { redirectTo },
  });
}

export function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthSessionResult> {
  return unwrapAuthResponse(
    getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password }),
  );
}

export function signUpWithPassword(
  email: string,
  password: string,
  redirectTo = window.location.origin,
): Promise<AuthSessionResult> {
  return unwrapAuthResponse(
    getSupabaseClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirectTo },
    }),
  );
}

export async function requestEmailOtp(
  email: string,
  redirectTo = window.location.origin,
): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function requestEmailIdentityLink(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({
    email: email.trim(),
  });
  if (error) throw error;
}

export function verifyEmailOtp(
  email: string,
  token: string,
): Promise<AuthSessionResult> {
  return unwrapAuthResponse(
    getSupabaseClient().auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email',
    }),
  );
}

export function verifyEmailIdentityLink(
  email: string,
  token: string,
): Promise<AuthSessionResult> {
  return unwrapAuthResponse(
    getSupabaseClient().auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email_change',
    }),
  );
}

export async function setCurrentPassword(password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({ password });
  if (error) throw error;
}

export async function requestPhoneOtp(phone: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    phone: phone.trim(),
  });
  if (error) throw error;
}

export async function requestPhoneIdentityLink(phone: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({
    phone: phone.trim(),
  });
  if (error) throw error;
}

export function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<AuthSessionResult> {
  return unwrapAuthResponse(
    getSupabaseClient().auth.verifyOtp({
      phone: phone.trim(),
      token: token.trim(),
      type: 'sms',
    }),
  );
}

export function verifyPhoneIdentityLink(
  phone: string,
  token: string,
): Promise<AuthSessionResult> {
  return unwrapAuthResponse(
    getSupabaseClient().auth.verifyOtp({
      phone: phone.trim(),
      token: token.trim(),
      type: 'phone_change',
    }),
  );
}

export function continueAsGuest(): Promise<AuthSessionResult> {
  return unwrapAuthResponse(getSupabaseClient().auth.signInAnonymously());
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

function getSessionId(session: Session): string | null {
  try {
    const encodedPayload = session.access_token.split('.')[1];
    if (!encodedPayload) return null;

    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    ) as { session_id?: unknown };

    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** Tracks app/device metadata only; Supabase Auth remains the source of truth for tokens. */
export async function registerAppSession(
  session: Session,
  clientType: AppClientType = 'web',
): Promise<void> {
  const sessionId = getSessionId(session);
  if (!sessionId) return;

  const { error } = await getSupabaseClient()
    .from('app_sessions')
    .upsert(
      {
        id: sessionId,
        user_id: session.user.id,
        client_type: clientType,
        user_agent:
          typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 1000),
        last_seen_at: new Date().toISOString(),
        ended_at: null,
      },
      { onConflict: 'id' },
    );

  if (error) throw error;
}

export function subscribeToAuthState(
  onChange: (event: AuthChangeEvent, session: Session | null) => void,
  clientType: AppClientType = 'web',
): Subscription {
  const {
    data: { subscription },
  } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
    onChange(event, session);

    if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
      // Supabase recommends keeping async work outside the auth callback.
      queueMicrotask(() => {
        void registerAppSession(session, clientType).catch((error: unknown) => {
          console.warn('Unable to record the app session.', error);
        });
      });
    }
  });

  return subscription;
}

export async function signOutCurrentSession(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const sessionId = session ? getSessionId(session) : null;

  if (session && sessionId) {
    await supabase
      .from('app_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', session.user.id);
  }

  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}
