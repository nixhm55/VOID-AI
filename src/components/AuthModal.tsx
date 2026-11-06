import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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

type AuthTab = 'signup' | 'signin';
type SignInMethod = 'password' | 'otp' | 'phone';

interface CountryOption {
  code: string;
  name: string;
  dial: string;
  flag: string;
  placeholder: string;
}

const COUNTRIES: CountryOption[] = [
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸', placeholder: '(775) 351-6501' },
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', placeholder: '98765 43210' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', placeholder: '7700 900077' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪', placeholder: '50 123 4567' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', placeholder: '51 234 5678' },
  { code: 'QA', name: 'Qatar', dial: '+974', flag: '🇶🇦', placeholder: '3312 3456' },
  { code: 'OM', name: 'Oman', dial: '+968', flag: '🇴🇲', placeholder: '9212 3456' },
  { code: 'KW', name: 'Kuwait', dial: '+965', flag: '🇰🇼', placeholder: '500 12345' },
  { code: 'BH', name: 'Bahrain', dial: '+973', flag: '🇧🇭', placeholder: '3600 1234' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦', placeholder: '(416) 555-0198' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', placeholder: '412 345 678' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪', placeholder: '1512 3456789' },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷', placeholder: '6 12 34 56 78' },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', placeholder: '8123 4567' },
  { code: 'MY', name: 'Malaysia', dial: '+60', flag: '🇲🇾', placeholder: '12-345 6789' },
  { code: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵', placeholder: '90-1234-5678' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷', placeholder: '(11) 91234-5678' },
];

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
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[19px] w-[19px] shrink-0">
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
      className="h-[19px] w-[19px] shrink-0 fill-white"
    >
      <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.61 1.21 3.25.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.12 2.96.71.78 1.14 1.78 1.14 3 0 4.3-2.61 5.23-5.1 5.51.4.35.76 1.03.76 2.08v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[17px] w-[17px] shrink-0 text-[#6c6c74]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[17px] w-[17px] shrink-0 text-[#6c6c74]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
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
  const countryMenuRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState<AuthTab>('signup');
  const [signInMethod, setSignInMethod] = useState<SignInMethod>('password');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(
    COUNTRIES[0],
  );
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [password, setPassword] = useState('');
  const [showSignUpPasswordStep, setShowSignUpPasswordStep] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [otpTargetChannel, setOtpTargetChannel] = useState<'email' | 'phone'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const configured = isSupabaseConfigured();

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [countryQuery]);

  const formattedE164Phone = useMemo(() => {
    const raw = phoneLocal.trim();
    if (!raw) return '';
    if (raw.startsWith('+')) return raw.replace(/[^\d+]/g, '');
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return `${selectedCountry.dial}${digits}`;
  }, [phoneLocal, selectedCountry]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        if (countryDropdownOpen) {
          setCountryDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, countryDropdownOpen, onClose]);

  useEffect(() => {
    if (!countryDropdownOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (
        countryMenuRef.current &&
        !countryMenuRef.current.contains(event.target as Node)
      ) {
        setCountryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [countryDropdownOpen]);

  useEffect(() => {
    if (open) return;
    setError('');
    setNotice('');
    setCode('');
    setCodeSent(false);
    setShowSignUpPasswordStep(false);
    setCountryDropdownOpen(false);
    setCountryQuery('');
  }, [open]);

  if (!open) return null;

  const switchTab = (next: AuthTab) => {
    setActiveTab(next);
    setError('');
    setNotice('');
    setCode('');
    setCodeSent(false);
    setShowSignUpPasswordStep(false);
    setCountryDropdownOpen(false);
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

  const handleSendOtpFallback = async (channel: 'email' | 'phone') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const isLinkingGuest = Boolean(user?.is_anonymous);
      if (channel === 'phone') {
        if (!formattedE164Phone) {
          throw new Error('Please enter your phone number first.');
        }
        if (isLinkingGuest) await requestPhoneIdentityLink(formattedE164Phone);
        else await requestPhoneOtp(formattedE164Phone);
        setOtpTargetChannel('phone');
        setCodeSent(true);
        setNotice('A verification code has been sent to your phone.');
      } else {
        if (!email.trim()) {
          throw new Error('Please enter your email address first.');
        }
        if (isLinkingGuest) await requestEmailIdentityLink(email.trim());
        else await requestEmailOtp(email.trim());
        setOtpTargetChannel('email');
        setCodeSent(true);
        setNotice('A one-time verification code has been sent to your email.');
      }
    } catch (err) {
      setError(getAuthErrorMessage(err, Boolean(user?.is_anonymous)));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');

    // Step 1 of Sign Up: If user hasn't opened the password/verification step yet
    if (activeTab === 'signup' && !codeSent && !showSignUpPasswordStep) {
      if (!email.trim() && formattedE164Phone) {
        // Phone-only sign up via SMS OTP
        await handleSendOtpFallback('phone');
        return;
      }
      if (!email.trim()) {
        setError('Please enter your email address.');
        return;
      }
      setShowSignUpPasswordStep(true);
      return;
    }

    setBusy(true);
    try {
      const isLinkingGuest = Boolean(user?.is_anonymous);

      if (codeSent) {
        const result = isLinkingGuest
          ? otpTargetChannel === 'email'
            ? await verifyEmailIdentityLink(email, code)
            : await verifyPhoneIdentityLink(formattedE164Phone, code)
          : otpTargetChannel === 'email'
            ? await verifyEmailOtp(email, code)
            : await verifyPhoneOtp(formattedE164Phone, code);

        if (isLinkingGuest && otpTargetChannel === 'email' && password.length >= 8) {
          await setCurrentPassword(password);
        }
        if (result.session) onClose();
        return;
      }

      if (activeTab === 'signup') {
        if (isLinkingGuest) {
          await requestEmailIdentityLink(email);
          setOtpTargetChannel('email');
          setCodeSent(true);
          setNotice(
            'A verification code is on its way. Verify your email to link your account.',
          );
          return;
        }

        const result = await signUpWithPassword(email, password);
        if (result.session) {
          onClose();
        } else {
          setNotice(
            'Check your inbox to confirm your email and finish creating your account.',
          );
        }
        return;
      }

      // Sign in tab
      if (signInMethod === 'phone') {
        if (!formattedE164Phone) {
          throw new Error('Please enter your phone number.');
        }
        if (isLinkingGuest) await requestPhoneIdentityLink(formattedE164Phone);
        else await requestPhoneOtp(formattedE164Phone);
        setOtpTargetChannel('phone');
        setCodeSent(true);
        setNotice('A one-time code is on its way to your phone.');
        return;
      }

      if (signInMethod === 'otp') {
        if (isLinkingGuest) await requestEmailIdentityLink(email);
        else await requestEmailOtp(email);
        setOtpTargetChannel('email');
        setCodeSent(true);
        setNotice('A one-time code is on its way to your inbox.');
        return;
      }

      if (isLinkingGuest) {
        await requestEmailIdentityLink(email);
        setOtpTargetChannel('email');
        setCodeSent(true);
        setNotice(
          'A verification code is on its way. Verify your email to keep this session.',
        );
        return;
      }

      const result = await signInWithPassword(email, password);
      if (result.session) {
        onClose();
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-4 sm:p-6 backdrop-blur-md animate-auth-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {/* Main Dark Morphism Auth Card (No rainbow background) */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
        className="auth-morphism-card relative my-auto w-full max-w-[410px] rounded-[28px] p-7 text-white outline-none animate-auth-card"
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
        {user && !user.is_anonymous ? (
          /* ── Signed-in Account View ── */
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#8e8e96]">
                Account
              </span>
              <button
                type="button"
                className="auth-close-btn inline-flex h-9 w-9 items-center justify-center rounded-full text-[#9e9ea6] transition-all hover:text-white disabled:opacity-40"
                aria-label="Close dialog"
                onClick={onClose}
                disabled={busy}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4 fill-none stroke-current"
                  strokeLinecap="round"
                  strokeWidth="2"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <h2
              id="auth-modal-title"
              className="mt-6 text-[22px] font-semibold tracking-[-0.02em] text-white"
            >
              You&apos;re signed in
            </h2>
            <p className="mt-1 truncate text-[13.5px] text-[#8e8e96]">
              {accountName}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                className="auth-primary-btn flex h-[46px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold"
                onClick={onClose}
              >
                Continue to VOID
              </button>
              <button
                type="button"
                className="auth-social-btn flex h-[44px] w-full items-center justify-center rounded-[11px] text-[13.5px] font-medium text-white/90"
                onClick={() => void handleSignOut()}
                disabled={busy}
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>

            {error ? (
              <p
                className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-center text-xs leading-relaxed text-red-200"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          /* ── Sign up / Sign in Morphism View (Exact Reference Match) ── */
          <div>
            {/* Top Bar: Pill Segmented Switch (Sign up / Sign in) + Close Button */}
            <div className="flex items-center justify-between">
              <div
                className="auth-pill-track inline-flex items-center rounded-full p-1"
                role="tablist"
                aria-label="Authentication mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'signup'}
                  onClick={() => switchTab('signup')}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                    activeTab === 'signup'
                      ? 'auth-pill-active text-white'
                      : 'text-[#7c7c85] hover:text-white/80'
                  }`}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'signin'}
                  onClick={() => switchTab('signin')}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                    activeTab === 'signin'
                      ? 'auth-pill-active text-white'
                      : 'text-[#7c7c85] hover:text-white/80'
                  }`}
                >
                  Sign in
                </button>
              </div>

              <button
                type="button"
                className="auth-close-btn inline-flex h-9 w-9 items-center justify-center rounded-full text-[#9e9ea6] transition-all hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close sign in dialog"
                onClick={onClose}
                disabled={busy}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4 fill-none stroke-current"
                  strokeLinecap="round"
                  strokeWidth="2"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            {/* Section Title */}
            <h2
              id="auth-modal-title"
              className="mt-6 mb-5 text-[22px] font-semibold tracking-[-0.02em] text-white"
            >
              {activeTab === 'signup' ? 'Create an account' : 'Sign in'}
            </h2>

            {!configured ? (
              <div
                className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-center text-[11.5px] leading-relaxed text-white/70"
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

            {/* Form */}
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => void handleSubmit(event)}
            >
              {activeTab === 'signup' ? (
                <>
                  {/* Row 1: First Name & Last Name */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="auth-input-shell flex h-[46px] items-center rounded-[11px] px-3.5">
                      <input
                        type="text"
                        autoComplete="given-name"
                        placeholder="First name"
                        aria-label="First name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={busy || codeSent}
                        className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                      />
                    </div>
                    <div className="auth-input-shell flex h-[46px] items-center rounded-[11px] px-3.5">
                      <input
                        type="text"
                        autoComplete="family-name"
                        placeholder="Last name"
                        aria-label="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={busy || codeSent}
                        className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                      />
                    </div>
                  </div>

                  {/* Row 2: Email Input with Envelope Icon */}
                  <div className="auth-input-shell flex h-[46px] items-center gap-2.5 rounded-[11px] px-3.5">
                    <EnvelopeIcon />
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="Enter your email"
                      aria-label="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy || codeSent}
                      className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                    />
                  </div>

                  {/* Row 3: Country Flag Dropdown + Phone Number */}
                  <div
                    ref={countryMenuRef}
                    className="auth-input-shell relative flex h-[46px] items-center rounded-[11px] px-3"
                  >
                    <button
                      type="button"
                      onClick={() => setCountryDropdownOpen((v) => !v)}
                      disabled={busy || codeSent}
                      aria-label={`Selected country ${selectedCountry.name} (${selectedCountry.dial})`}
                      aria-expanded={countryDropdownOpen}
                      className="mr-2.5 inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pr-1.5 text-[14px] text-white/90 transition-colors hover:text-white"
                    >
                      <span
                        className="text-[18px] leading-none"
                        aria-hidden="true"
                      >
                        {selectedCountry.flag}
                      </span>
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className={`h-3.5 w-3.5 text-[#7c7c85] transition-transform duration-150 ${
                          countryDropdownOpen ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={selectedCountry.placeholder}
                      aria-label="Phone number"
                      value={phoneLocal}
                      onChange={(e) => setPhoneLocal(e.target.value)}
                      disabled={busy || codeSent}
                      className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                    />

                    {/* Country Selector Dropdown */}
                    {countryDropdownOpen ? (
                      <div className=" absolute left-0 top-[calc(100%+6px)] z-30 w-full overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#18181c] shadow-[0_18px_50px_rgba(0,0,0,0.85)]">
                        <div className="border-b border-white/[0.07] p-2">
                          <input
                            type="text"
                            value={countryQuery}
                            onChange={(e) => setCountryQuery(e.target.value)}
                            placeholder="Search country or code…"
                            aria-label="Search country"
                            autoFocus
                            className="h-8 w-full rounded-lg bg-[#222227] px-2.5 text-[12.5px] text-white placeholder:text-[#6c6c74] outline-none"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto py-1">
                          {filteredCountries.map((country) => {
                            const isSelected =
                              country.code === selectedCountry.code;
                            return (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => {
                                  setSelectedCountry(country);
                                  setCountryDropdownOpen(false);
                                  setCountryQuery('');
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors ${
                                  isSelected
                                    ? 'bg-white/[0.08] text-white'
                                    : 'text-[#d4d4d8] hover:bg-white/[0.04]'
                                }`}
                              >
                                <span className="flex items-center gap-2.5 truncate">
                                  <span className="text-[16px] leading-none">
                                    {country.flag}
                                  </span>
                                  <span className="truncate">{country.name}</span>
                                </span>
                                <span className="ml-2 shrink-0 font-mono text-[12px] text-[#8e8e96]">
                                  {country.dial}
                                </span>
                              </button>
                            );
                          })}
                          {filteredCountries.length === 0 ? (
                            <div className="px-3 py-3 text-center text-[12px] text-[#7c7c85]">
                              No matching country
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Step 2 on Sign Up: Password or One-Time Code */}
                  {showSignUpPasswordStep && !codeSent ? (
                    <div className="flex flex-col gap-2 pt-0.5">
                      <div className="auth-input-shell flex h-[46px] items-center gap-2.5 rounded-[11px] px-3.5">
                        <LockIcon />
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder="Create a password (min 8 chars)"
                          aria-label="Create a password"
                          minLength={8}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          disabled={busy}
                          autoFocus
                          className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-between px-0.5 text-[11.5px] text-[#7c7c85]">
                        <button
                          type="button"
                          onClick={() => void handleSendOtpFallback('email')}
                          disabled={busy}
                          className="transition-colors hover:text-white"
                        >
                          Send email verification code instead
                        </button>
                        {formattedE164Phone ? (
                          <button
                            type="button"
                            onClick={() => void handleSendOtpFallback('phone')}
                            disabled={busy}
                            className="transition-colors hover:text-white"
                          >
                            Verify phone SMS
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                /* ── Sign In Tab Fields ── */
                <>
                  {signInMethod === 'phone' ? (
                    <div
                      ref={countryMenuRef}
                      className="auth-input-shell relative flex h-[46px] items-center rounded-[11px] px-3"
                    >
                      <button
                        type="button"
                        onClick={() => setCountryDropdownOpen((v) => !v)}
                        disabled={busy || codeSent}
                        aria-label={`Selected country ${selectedCountry.name} (${selectedCountry.dial})`}
                        aria-expanded={countryDropdownOpen}
                        className="mr-2.5 inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pr-1.5 text-[14px] text-white/90 transition-colors hover:text-white"
                      >
                        <span
                          className="text-[18px] leading-none"
                          aria-hidden="true"
                        >
                          {selectedCountry.flag}
                        </span>
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 text-[#7c7c85] transition-transform duration-150 ${
                            countryDropdownOpen ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder={selectedCountry.placeholder}
                        aria-label="Phone number"
                        value={phoneLocal}
                        onChange={(e) => setPhoneLocal(e.target.value)}
                        required
                        disabled={busy || codeSent}
                        className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                      />

                      {countryDropdownOpen ? (
                        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-full overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#18181c] shadow-[0_18px_50px_rgba(0,0,0,0.85)]">
                          <div className="border-b border-white/[0.07] p-2">
                            <input
                              type="text"
                              value={countryQuery}
                              onChange={(e) => setCountryQuery(e.target.value)}
                              placeholder="Search country or code…"
                              aria-label="Search country"
                              autoFocus
                              className="h-8 w-full rounded-lg bg-[#222227] px-2.5 text-[12.5px] text-white placeholder:text-[#6c6c74] outline-none"
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto py-1">
                            {filteredCountries.map((country) => {
                              const isSelected =
                                country.code === selectedCountry.code;
                              return (
                                <button
                                  key={country.code}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCountry(country);
                                    setCountryDropdownOpen(false);
                                    setCountryQuery('');
                                  }}
                                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors ${
                                    isSelected
                                      ? 'bg-white/[0.08] text-white'
                                      : 'text-[#d4d4d8] hover:bg-white/[0.04]'
                                  }`}
                                >
                                  <span className="flex items-center gap-2.5 truncate">
                                    <span className="text-[16px] leading-none">
                                      {country.flag}
                                    </span>
                                    <span className="truncate">
                                      {country.name}
                                    </span>
                                  </span>
                                  <span className="ml-2 shrink-0 font-mono text-[12px] text-[#8e8e96]">
                                    {country.dial}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="auth-input-shell flex h-[46px] items-center gap-2.5 rounded-[11px] px-3.5">
                      <EnvelopeIcon />
                      <input
                        type="email"
                        autoComplete="email"
                        placeholder="Enter your email"
                        aria-label="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={busy || codeSent}
                        className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                      />
                    </div>
                  )}

                  {signInMethod === 'password' && !codeSent ? (
                    <div className="auth-input-shell flex h-[46px] items-center gap-2.5 rounded-[11px] px-3.5">
                      <LockIcon />
                      <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        aria-label="Password"
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={busy}
                        className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                      />
                    </div>
                  ) : null}

                  {!codeSent ? (
                    <div className="flex items-center justify-between px-0.5 text-[11.5px] text-[#7c7c85]">
                      <button
                        type="button"
                        onClick={() => {
                          setSignInMethod((m) =>
                            m === 'password' ? 'otp' : 'password',
                          );
                          setError('');
                          setNotice('');
                        }}
                        className="transition-colors hover:text-white"
                      >
                        {signInMethod === 'password'
                          ? 'Use email one-time code'
                          : 'Use email & password'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSignInMethod((m) =>
                            m === 'phone' ? 'password' : 'phone',
                          );
                          setError('');
                          setNotice('');
                        }}
                        className="transition-colors hover:text-white"
                      >
                        {signInMethod === 'phone'
                          ? 'Use email instead'
                          : 'Sign in with phone'}
                      </button>
                    </div>
                  ) : null}
                </>
              )}

              {/* One-Time Verification Code Input (when OTP sent) */}
              {codeSent ? (
                <div className="flex flex-col gap-2">
                  <div className="auth-input-shell flex h-[46px] items-center rounded-[11px] px-3.5">
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Enter 6-digit verification code"
                      aria-label="One-time verification code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      disabled={busy}
                      autoFocus
                      className="h-full w-full bg-transparent text-[14px] text-white placeholder:text-[#66666e] outline-none"
                    />
                  </div>
                  <div className="flex justify-end px-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCodeSent(false);
                        setCode('');
                        setNotice('');
                      }}
                      className="text-[11.5px] text-[#7c7c85] transition-colors hover:text-white"
                    >
                      Change {otpTargetChannel === 'email' ? 'email' : 'phone'}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Primary CTA Button */}
              <button
                type="submit"
                disabled={busy || !configured}
                className="auth-primary-btn mt-2 flex h-[46px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy
                  ? 'Please wait…'
                  : codeSent
                    ? 'Verify code'
                    : activeTab === 'signup'
                      ? 'Create an account'
                      : signInMethod === 'password'
                        ? 'Sign in'
                        : 'Send one-time code'}
              </button>
            </form>

            {error ? (
              <p
                className="mt-3.5 rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-center text-xs leading-relaxed text-red-200"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {notice ? (
              <p
                className="mt-3.5 rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2.5 text-center text-xs leading-relaxed text-white/80"
                role="status"
              >
                {notice}
              </p>
            ) : null}

            {/* Divider: OR SIGN IN WITH */}
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/[0.06]" />
              <span className="text-[10.5px] font-semibold tracking-[0.08em] text-[#5c5c66] uppercase">
                OR SIGN IN WITH
              </span>
              <span className="h-px flex-1 bg-white/[0.06]" />
            </div>

            {/* Social Buttons: Google (left) & GitHub (right, replacing Apple) */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                aria-label="Sign in with Google"
                onClick={() => void handleOAuth('google')}
                disabled={busy || !configured}
                className="auth-social-btn flex h-[44px] w-full items-center justify-center rounded-[11px] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <GoogleMark />
              </button>
              <button
                type="button"
                aria-label="Sign in with GitHub"
                onClick={() => void handleOAuth('github')}
                disabled={busy || !configured}
                className="auth-social-btn flex h-[44px] w-full items-center justify-center rounded-[11px] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <GithubMark />
              </button>
            </div>

            {/* Footer */}
            <div className="mt-5 flex flex-col items-center gap-2 text-center">
              <p className="text-[11.5px] text-[#66666e]">
                By creating an account, you agree to our Terms &amp; Service
              </p>
              {!user ? (
                <button
                  type="button"
                  onClick={() => void handleGuest()}
                  disabled={busy || !configured}
                  className="text-[11.5px] font-medium text-[#8a8a93] transition-colors hover:text-white disabled:opacity-40"
                >
                  Continue as guest →
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
