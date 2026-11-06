import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  continueAsGuest,
  linkOAuthIdentity,
  requestEmailIdentityLink,
  requestEmailOtp,
  requestPhoneIdentityLink,
  requestPhoneOtp,
  setCurrentPassword,
  signInWithOAuth,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailIdentityLink,
  verifyEmailOtp,
  verifyPhoneIdentityLink,
  verifyPhoneOtp,
} from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import './AuthModal.css';

interface AuthModalProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}

type AuthChannel = 'email' | 'phone';
type EmailMethod = 'password' | 'otp';

function getAuthErrorMessage(error: unknown, linkingGuest: boolean): string {
  const message =
    error instanceof Error ? error.message : 'Unable to complete sign in.';
  if (
    linkingGuest &&
    /already (?:exists|registered|linked|in use)|identity.*exists/i.test(message)
  ) {
    return 'That sign-in method belongs to another account. Your guest workspace is unchanged; sign in to the existing account separately or choose a different method to link.';
  }
  return message;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
      <path
        fill="#4285F4"
        d="M21.35 12.23c0-.72-.06-1.41-.18-2.08H12v3.94h5.24a4.48 4.48 0 0 1-1.95 2.94v2.45h3.16c1.85-1.7 2.9-4.2 2.9-7.25Z"
      />
      <path
        fill="#34A853"
        d="M12 21.75c2.65 0 4.88-.88 6.51-2.37l-3.16-2.45c-.88.59-2 .94-3.35.94-2.57 0-4.75-1.73-5.53-4.06H3.2v2.53A9.83 9.83 0 0 0 12 21.75Z"
      />
      <path
        fill="#FBBC05"
        d="M6.47 13.81a5.9 5.9 0 0 1 0-3.62V7.66H3.2a9.82 9.82 0 0 0 0 8.68l3.27-2.53Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.13c1.45 0 2.75.5 3.77 1.5l2.83-2.83C16.87 3.17 14.65 2.25 12 2.25a9.83 9.83 0 0 0-8.8 5.41l3.27 2.53c.78-2.33 2.96-4.06 5.53-4.06Z"
      />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 fill-current"
    >
      <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.61 1.21 3.25.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.12 2.96.71.78 1.14 1.78 1.14 3 0 4.3-2.61 5.23-5.1 5.51.4.35.76 1.03.76 2.08v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

export default function AuthModal({
  open,
  user,
  onClose,
  onSignOut,
}: AuthModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [channel, setChannel] = useState<AuthChannel>('email');
  const [emailMethod, setEmailMethod] = useState<EmailMethod>('password');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (open) return;
    setError('');
    setNotice('');
    setCode('');
    setCodeSent(false);
  }, [open]);

  if (!open) return null;

  const switchChannel = (next: AuthChannel) => {
    setChannel(next);
    setError('');
    setNotice('');
    setCodeSent(false);
    setCode('');
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = user?.is_anonymous
        ? await linkOAuthIdentity(provider)
        : await signInWithOAuth(provider);
      const { error: oauthError } = response;
      if (oauthError) throw oauthError;
      setNotice(
        user?.is_anonymous
          ? `Linking your ${provider === 'google' ? 'Google' : 'GitHub'} account…`
          : `Redirecting to ${provider === 'google' ? 'Google' : 'GitHub'}…`,
      );
    } catch (err) {
      setError(getAuthErrorMessage(err, Boolean(user?.is_anonymous)));
      setBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (codeSent) {
        const isLinkingGuest = Boolean(user?.is_anonymous);
        const result = isLinkingGuest
          ? channel === 'email'
            ? await verifyEmailIdentityLink(email, code)
            : await verifyPhoneIdentityLink(phone, code)
          : channel === 'email'
            ? await verifyEmailOtp(email, code)
            : await verifyPhoneOtp(phone, code);
        if (
          isLinkingGuest &&
          channel === 'email' &&
          emailMethod === 'password'
        ) {
          await setCurrentPassword(password);
        }
        if (result.session) onClose();
        return;
      }

      if (channel === 'phone') {
        if (user?.is_anonymous) await requestPhoneIdentityLink(phone);
        else await requestPhoneOtp(phone);
        setCodeSent(true);
        setNotice(
          user?.is_anonymous
            ? 'A verification code is on its way. Enter it to link this phone to your guest session.'
            : 'A one-time code is on its way to your phone.',
        );
        return;
      }

      if (emailMethod === 'otp') {
        if (user?.is_anonymous) await requestEmailIdentityLink(email);
        else await requestEmailOtp(email);
        setCodeSent(true);
        setNotice(
          user?.is_anonymous
            ? 'A verification code is on its way. Enter it to link this email to your guest session.'
            : 'A one-time code is on its way to your inbox.',
        );
        return;
      }

      if (user?.is_anonymous) {
        await requestEmailIdentityLink(email);
        setCodeSent(true);
        setNotice(
          'A verification code is on its way. Verify your email to keep this guest session, then your password will be added.',
        );
        return;
      }

      const result = isCreatingAccount
        ? await signUpWithPassword(email, password)
        : await signInWithPassword(email, password);

      if (result.session) {
        onClose();
      } else if (isCreatingAccount) {
        setNotice(
          'Check your inbox to confirm your email and finish creating your account.',
        );
      }
    } catch (err) {
      setError(getAuthErrorMessage(err, Boolean(user?.is_anonymous)));
    } finally {
      setBusy(false);
    }
  };

  const handleGuest = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await continueAsGuest();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to start a guest session.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError('');
    try {
      await onSignOut();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign out.');
    } finally {
      setBusy(false);
    }
  };

  const accountName =
    user?.email ??
    user?.phone ??
    (user?.is_anonymous ? 'Guest session' : 'Signed in');

  /* ── Liquid Glass Tailwind Design Tokens ── */
  const inputClasses =
    'h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[13px] text-white placeholder:text-white/25 outline-none backdrop-blur-md transition-all duration-200 focus:border-white/25 focus:bg-white/[0.07] focus:shadow-[0_0_24px_rgba(255,255,255,0.06)] disabled:cursor-not-allowed disabled:opacity-50';

  const oauthBtnClasses =
    'group inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-[12.5px] font-medium text-white/90 backdrop-blur-xl transition-all duration-200 hover:scale-[1.015] hover:border-white/20 hover:bg-white/[0.08] hover:text-white hover:shadow-[0_0_24px_rgba(255,255,255,0.07)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-none';

  const primaryBtnClasses =
    'group relative flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/90 px-5 text-[13px] font-semibold text-zinc-950 shadow-[0_8px_30px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-200 hover:scale-[1.015] hover:bg-white hover:shadow-[0_10px_36px_rgba(255,255,255,0.22)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100';

  const secondaryBtnClasses =
    'flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-[13px] font-medium text-white/80 backdrop-blur-xl transition-all duration-200 hover:scale-[1.01] hover:border-white/20 hover:bg-white/[0.08] hover:text-white active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-4 sm:p-6 backdrop-blur-2xl animate-auth-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {/* Subtle Ambient Cinematic Backlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.04] blur-[120px]" />
        <div className="absolute left-1/2 top-[38%] h-[260px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-400/[0.06] blur-[100px]" />
      </div>

      {/* Liquid Glass Card */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
        className="relative my-auto w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-black/40 p-7 sm:p-8 text-white shadow-[0_32px_100px_rgba(0,0,0,0.85),0_0_50px_rgba(255,255,255,0.03),inset_0_1px_0_0_rgba(255,255,255,0.16)] backdrop-blur-2xl outline-none animate-auth-card"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)',
          );
          if (!focusable?.length) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {/* Specular Liquid Glass Top Sheen */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/[0.07] to-transparent"
        />

        {/* Top Bar: Brand & Close Button */}
        <div className="relative flex items-center justify-between">
          <div className="inline-flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 rounded-full border border-white/40 bg-gradient-to-br from-white via-zinc-300 to-zinc-600 shadow-[0_0_14px_rgba(255,255,255,0.45)]"
            />
            <span className="text-[11px] font-semibold tracking-[0.24em] text-white/90 uppercase">
              VOID
            </span>
          </div>

          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/50 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-white/20 hover:bg-white/[0.1] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close sign in dialog"
            onClick={onClose}
            disabled={busy}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5 fill-none stroke-current"
              strokeLinecap="round"
              strokeWidth="2"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {user && !user.is_anonymous ? (
          /* ── Signed-in Account View ── */
          <div className="relative mt-7 flex flex-col gap-6">
            <div className="space-y-1.5 text-center">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-white/40 uppercase">
                Authenticated Session
              </p>
              <h2
                id="auth-modal-title"
                className="text-2xl font-semibold tracking-tight text-white"
              >
                You&apos;re signed in
              </h2>
              <p className="truncate text-[13px] text-white/50">
                {user.is_anonymous ? 'Guest session' : accountName}
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                className={primaryBtnClasses}
                onClick={onClose}
              >
                Continue to VOID
              </button>
              <button
                type="button"
                className={secondaryBtnClasses}
                onClick={() => void handleSignOut()}
                disabled={busy}
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>

            {error ? (
              <p
                className="rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-center text-xs leading-relaxed text-red-200 backdrop-blur-md"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          /* ── Sign-in / Sign-up View ── */
          <div className="relative mt-6 flex flex-col gap-5">
            {/* Centered Header */}
            <div className="space-y-1.5 text-center">
              <p className="text-[10px] font-medium tracking-[0.2em] text-white/40 uppercase">
                {user?.is_anonymous
                  ? 'Guest Workspace'
                  : 'A Quieter Space To Think'}
              </p>
              <h2
                id="auth-modal-title"
                className="text-[26px] font-semibold tracking-tight text-white"
              >
                {user?.is_anonymous
                  ? 'Keep this workspace'
                  : isCreatingAccount
                    ? 'Create your account'
                    : 'Welcome back'}
              </h2>
              <p className="text-[13px] leading-relaxed text-white/45">
                {user?.is_anonymous
                  ? 'Link a sign-in method to sync this workspace across devices.'
                  : 'Sign in to pick up where your ideas left off.'}
              </p>
            </div>

            {!configured ? (
              <div
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-center text-[11.5px] leading-relaxed text-white/70 backdrop-blur-md"
                role="status"
              >
                Add{' '}
                <code className="rounded bg-white/10 px-1 py-0.5 text-[10.5px] text-white">
                  VITE_SUPABASE_URL
                </code>{' '}
                and{' '}
                <code className="rounded bg-white/10 px-1 py-0.5 text-[10.5px] text-white">
                  VITE_SUPABASE_PUBLISHABLE_KEY
                </code>{' '}
                to{' '}
                <code className="rounded bg-white/10 px-1 py-0.5 text-[10.5px] text-white">
                  .env.local
                </code>{' '}
                to enable sign in.
              </div>
            ) : null}

            {/* Symmetrical OAuth Buttons (Google & GitHub) */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={oauthBtnClasses}
                onClick={() => void handleOAuth('google')}
                disabled={busy || !configured}
              >
                <GoogleMark />
                <span>{user?.is_anonymous ? 'Link Google' : 'Google'}</span>
              </button>
              <button
                type="button"
                className={oauthBtnClasses}
                onClick={() => void handleOAuth('github')}
                disabled={busy || !configured}
              >
                <GithubMark />
                <span>{user?.is_anonymous ? 'Link GitHub' : 'GitHub'}</span>
              </button>
            </div>

            {/* Minimalist Divider */}
            <div className="flex items-center gap-3 text-[11px] text-white/30">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/10" />
              <span className="tracking-wide">or continue with</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent via-white/10 to-white/10" />
            </div>

            {/* Symmetrical Channel Switcher (Email / Phone) */}
            <div className="flex flex-col gap-2.5">
              <div
                className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md"
                role="tablist"
                aria-label="Sign in method"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={channel === 'email'}
                  className={`h-8 rounded-lg text-xs font-medium transition-all duration-200 ${
                    channel === 'email'
                      ? 'border border-white/15 bg-white/[0.1] text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)]'
                      : 'border border-transparent text-white/45 hover:text-white/80'
                  }`}
                  onClick={() => switchChannel('email')}
                >
                  Email
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={channel === 'phone'}
                  className={`h-8 rounded-lg text-xs font-medium transition-all duration-200 ${
                    channel === 'phone'
                      ? 'border border-white/15 bg-white/[0.1] text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)]'
                      : 'border border-transparent text-white/45 hover:text-white/80'
                  }`}
                  onClick={() => switchChannel('phone')}
                >
                  Phone
                </button>
              </div>

              {/* Email Sub-method Toggle (Password vs Email Code) */}
              {channel === 'email' ? (
                <div className="flex items-center justify-center gap-4">
                  <button
                    type="button"
                    className={`text-[11.5px] font-medium transition-colors duration-150 ${
                      emailMethod === 'password'
                        ? 'text-white underline decoration-white/50 underline-offset-4'
                        : 'text-white/35 hover:text-white/70'
                    }`}
                    onClick={() => {
                      setEmailMethod('password');
                      setCodeSent(false);
                      setCode('');
                      setError('');
                      setNotice('');
                    }}
                  >
                    Password
                  </button>
                  <span className="h-3 w-px bg-white/10" aria-hidden="true" />
                  <button
                    type="button"
                    className={`text-[11.5px] font-medium transition-colors duration-150 ${
                      emailMethod === 'otp'
                        ? 'text-white underline decoration-white/50 underline-offset-4'
                        : 'text-white/35 hover:text-white/70'
                    }`}
                    onClick={() => {
                      setEmailMethod('otp');
                      setCodeSent(false);
                      setCode('');
                      setError('');
                      setNotice('');
                    }}
                  >
                    Email code
                  </button>
                </div>
              ) : null}
            </div>

            {/* Symmetrical Credentials Form */}
            <form
              className="flex flex-col gap-3.5"
              onSubmit={(event) => void handleSubmit(event)}
            >
              {channel === 'email' ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-white/60">
                    Email address
                  </span>
                  <input
                    autoComplete="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={busy || codeSent}
                    className={inputClasses}
                  />
                </label>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-white/60">
                    Phone number
                  </span>
                  <input
                    autoComplete="tel"
                    type="tel"
                    inputMode="tel"
                    placeholder="+1 555 000 0000"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    required
                    disabled={busy || codeSent}
                    className={inputClasses}
                  />
                  <small className="text-[10.5px] text-white/35">
                    Include your country code (e.g. +1 or +91).
                  </small>
                </label>
              )}

              {channel === 'email' &&
              emailMethod === 'password' &&
              !codeSent ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-white/60">
                      Password
                    </span>
                    {!user?.is_anonymous ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-white/45 transition-colors duration-150 hover:text-white"
                        onClick={() =>
                          setIsCreatingAccount((current) => !current)
                        }
                      >
                        {isCreatingAccount
                          ? 'Have an account? Sign in'
                          : 'Create account'}
                      </button>
                    ) : null}
                  </div>
                  <input
                    autoComplete={
                      isCreatingAccount ? 'new-password' : 'current-password'
                    }
                    type="password"
                    placeholder="At least 8 characters"
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    disabled={busy}
                    className={inputClasses}
                  />
                </div>
              ) : null}

              {codeSent ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-white/60">
                      One-time verification code
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-white/45 transition-colors duration-150 hover:text-white"
                      onClick={() => {
                        setCodeSent(false);
                        setCode('');
                        setNotice('');
                      }}
                    >
                      Change {channel === 'email' ? 'email' : 'phone'}
                    </button>
                  </div>
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Enter 6-digit code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                    disabled={busy}
                    autoFocus
                    className={inputClasses}
                  />
                </div>
              ) : null}

              <button
                type="submit"
                className={`${primaryBtnClasses} mt-1`}
                disabled={busy || !configured}
              >
                <span>
                  {busy
                    ? 'Please wait…'
                    : codeSent
                      ? user?.is_anonymous
                        ? 'Verify and link'
                        : 'Verify code'
                      : channel === 'phone' || emailMethod === 'otp'
                        ? user?.is_anonymous
                          ? channel === 'phone'
                            ? 'Link phone'
                            : 'Link email'
                          : 'Send one-time code'
                        : isCreatingAccount
                          ? 'Create account'
                          : user?.is_anonymous
                            ? 'Link email and password'
                            : 'Sign in'}
                </span>
                {!busy && !codeSent ? (
                  <span
                    aria-hidden="true"
                    className="text-sm leading-none transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  >
                    ↗
                  </span>
                ) : null}
              </button>
            </form>

            {error ? (
              <p
                className="rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-center text-xs leading-relaxed text-red-200 backdrop-blur-md"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {notice ? (
              <p
                className="rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2.5 text-center text-xs leading-relaxed text-white/80 backdrop-blur-md"
                role="status"
              >
                {notice}
              </p>
            ) : null}

            {/* Footer Actions */}
            <div className="flex flex-col items-center gap-2.5 border-t border-white/[0.06] pt-4">
              {!user ? (
                <button
                  type="button"
                  className="group inline-flex items-center justify-center gap-1.5 text-xs font-medium text-white/50 transition-colors duration-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => void handleGuest()}
                  disabled={busy || !configured}
                >
                  <span>Continue as guest</span>
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </button>
              ) : null}

              <p className="text-center text-[10.5px] text-white/25">
                {user?.is_anonymous
                  ? 'Linking preserves your current guest workspace and history.'
                  : 'Encrypted session managed by Supabase Auth.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
