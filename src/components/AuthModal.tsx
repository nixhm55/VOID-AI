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
    <svg aria-hidden="true" viewBox="0 0 24 24" className="auth-provider-mark">
      <path fill="#4285F4" d="M21.35 12.23c0-.72-.06-1.41-.18-2.08H12v3.94h5.24a4.48 4.48 0 0 1-1.95 2.94v2.45h3.16c1.85-1.7 2.9-4.2 2.9-7.25Z" />
      <path fill="#34A853" d="M12 21.75c2.65 0 4.88-.88 6.51-2.37l-3.16-2.45c-.88.59-2 .94-3.35.94-2.57 0-4.75-1.73-5.53-4.06H3.2v2.53A9.83 9.83 0 0 0 12 21.75Z" />
      <path fill="#FBBC05" d="M6.47 13.81a5.9 5.9 0 0 1 0-3.62V7.66H3.2a9.82 9.82 0 0 0 0 8.68l3.27-2.53Z" />
      <path fill="#EA4335" d="M12 6.13c1.45 0 2.75.5 3.77 1.5l2.83-2.83C16.87 3.17 14.65 2.25 12 2.25a9.83 9.83 0 0 0-8.8 5.41l3.27 2.53c.78-2.33 2.96-4.06 5.53-4.06Z" />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="auth-provider-mark" fill="currentColor">
      <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.61 1.21 3.25.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.12 2.96.71.78 1.14 1.78 1.14 3 0 4.3-2.61 5.23-5.1 5.51.4.35.76 1.03.76 2.08v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

export default function AuthModal({ open, user, onClose, onSignOut }: AuthModalProps) {
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
        if (isLinkingGuest && channel === 'email' && emailMethod === 'password') {
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
        setNotice('A verification code is on its way. Verify your email to keep this guest session, then your password will be added.');
        return;
      }

      const result = isCreatingAccount
        ? await signUpWithPassword(email, password)
        : await signInWithPassword(email, password);

      if (result.session) {
        onClose();
      } else if (isCreatingAccount) {
        setNotice('Check your inbox to confirm your email and finish creating your account.');
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
      setError(err instanceof Error ? err.message : 'Unable to start a guest session.');
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
    user?.email ?? user?.phone ?? (user?.is_anonymous ? 'Guest session' : 'Signed in');

  return (
    <div
      className="auth-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
        className="auth-modal"
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
        <button
          type="button"
          className="auth-modal-close"
          aria-label="Close sign in dialog"
          onClick={onClose}
          disabled={busy}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>

        <div className="auth-modal-brand">
          <span className="auth-brand-orb" aria-hidden="true" />
          <span>VOID</span>
        </div>

        {user && !user.is_anonymous ? (
          <div className="auth-account-view">
            <p className="auth-eyebrow">YOUR ACCOUNT</p>
            <h2 id="auth-modal-title">You’re in.</h2>
            <p className="auth-modal-subtitle">{user.is_anonymous ? 'Guest session' : accountName}</p>
            <button type="button" className="auth-primary-button" onClick={onClose}>
              Continue to VOID
            </button>
            <button
              type="button"
              className="auth-secondary-button"
              onClick={() => void handleSignOut()}
              disabled={busy}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
            {error ? <p className="auth-message auth-message-error" role="alert">{error}</p> : null}
          </div>
        ) : (
          <>
            <p className="auth-eyebrow">
              {user?.is_anonymous ? 'GUEST SESSION' : 'A QUIETER SPACE TO THINK'}
            </p>
            <h2 id="auth-modal-title">
              {user?.is_anonymous ? 'Keep this workspace.' : 'Welcome back.'}
            </h2>
            <p className="auth-modal-subtitle">
              {user?.is_anonymous
                ? 'Link a sign-in method so you can return to this guest account on your other devices.'
                : 'Sign in to pick up where your ideas left off.'}
            </p>

            {!configured ? (
              <div className="auth-config-notice" role="status">
                Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to <code>.env.local</code> to enable sign in.
              </div>
            ) : null}

            <div className="auth-provider-grid">
              <button
                type="button"
                className="auth-provider-button"
                onClick={() => void handleOAuth('google')}
                disabled={busy || !configured}
              >
                <GoogleMark />
                {user?.is_anonymous ? 'Link Google' : 'Continue with Google'}
              </button>
              <button
                type="button"
                className="auth-provider-button"
                onClick={() => void handleOAuth('github')}
                disabled={busy || !configured}
              >
                <GithubMark />
                {user?.is_anonymous ? 'Link GitHub' : 'Continue with GitHub'}
              </button>
            </div>

            <div className="auth-divider"><span>or continue with</span></div>

            <div className="auth-channel-tabs" role="tablist" aria-label="Sign in method">
              <button
                type="button"
                role="tab"
                aria-selected={channel === 'email'}
                className={channel === 'email' ? 'is-active' : ''}
                onClick={() => switchChannel('email')}
              >
                Email
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={channel === 'phone'}
                className={channel === 'phone' ? 'is-active' : ''}
                onClick={() => switchChannel('phone')}
              >
                Phone
              </button>
            </div>

            {channel === 'email' ? (
              <div className="auth-method-row">
                <button
                  type="button"
                  className={emailMethod === 'password' ? 'is-active' : ''}
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
                <button
                  type="button"
                  className={emailMethod === 'otp' ? 'is-active' : ''}
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

            <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
              {channel === 'email' ? (
                <label className="auth-field">
                  <span>Email address</span>
                  <input
                    autoComplete="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={busy || codeSent}
                  />
                </label>
              ) : (
                <label className="auth-field">
                  <span>Phone number</span>
                  <input
                    autoComplete="tel"
                    type="tel"
                    inputMode="tel"
                    placeholder="+1 555 000 0000"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    required
                    disabled={busy || codeSent}
                  />
                  <small>Use the international format, including your country code.</small>
                </label>
              )}

              {channel === 'email' && emailMethod === 'password' && !codeSent ? (
                <>
                  <label className="auth-field">
                    <span>Password</span>
                    <input
                      autoComplete={isCreatingAccount ? 'new-password' : 'current-password'}
                      type="password"
                      placeholder="At least 8 characters"
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  {!user?.is_anonymous ? (
                    <button
                      type="button"
                      className="auth-inline-link"
                      onClick={() => setIsCreatingAccount((current) => !current)}
                    >
                      {isCreatingAccount
                        ? 'Already have an account? Sign in'
                        : 'New to VOID? Create an account'}
                    </button>
                  ) : null}
                </>
              ) : null}

              {codeSent ? (
                <>
                  <label className="auth-field">
                    <span>One-time code</span>
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Enter your code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      required
                      disabled={busy}
                      autoFocus
                    />
                  </label>
                  <button
                    type="button"
                    className="auth-inline-link"
                    onClick={() => {
                      setCodeSent(false);
                      setCode('');
                      setNotice('');
                    }}
                  >
                    Change {channel === 'email' ? 'email address' : 'phone number'}
                  </button>
                </>
              ) : null}

              <button type="submit" className="auth-primary-button" disabled={busy || !configured}>
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
                {!busy && !codeSent ? <span aria-hidden="true">↗</span> : null}
              </button>
            </form>

            {error ? <p className="auth-message auth-message-error" role="alert">{error}</p> : null}
            {notice ? <p className="auth-message auth-message-success" role="status">{notice}</p> : null}

            {!user ? (
              <button
                type="button"
                className="auth-guest-button"
                onClick={() => void handleGuest()}
                disabled={busy || !configured}
              >
                Continue as guest <span aria-hidden="true">→</span>
              </button>
            ) : null}
            <p className="auth-modal-footnote">
              {user?.is_anonymous
                ? 'Linking keeps your current guest account and its data.'
                : 'Your session is encrypted and managed by Supabase Auth.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
