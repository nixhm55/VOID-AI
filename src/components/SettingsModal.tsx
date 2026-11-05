import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AVAILABLE_TTS_VOICES,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
  type VoiceOption,
} from '../lib/chat-storage';
import { authenticatedFetch } from '../lib/api-fetch';

interface SettingsModalProps {
  open: boolean;
  settings: UserSettings;
  onUpdateSettings: (next: UserSettings) => void;
  onClearAllChats: () => void;
  onClose: () => void;
}

type SettingsTab = 'voice' | 'general';

const SPEED_OPTIONS = [0.9, 1.0, 1.1, 1.2];

const voiceMeta = (voice: VoiceOption) =>
  [
    voice.accent ?? voice.language,
    voice.gender,
    voice.provider === 'deepgram' ? 'Deepgram' : 'ElevenLabs',
  ]
    .filter(Boolean)
    .join(' · ');

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-white bg-white'
          : 'border-white/[0.14] bg-white/[0.05] hover:bg-white/[0.08]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition-transform ${
          checked
            ? 'translate-x-[19px] bg-[#101010]'
            : 'translate-x-[3px] bg-[#8a8a8f]'
        }`}
      />
    </button>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
        active
          ? 'bg-white/[0.08] text-white'
          : 'text-[#8a8a8f] hover:bg-white/[0.05] hover:text-[#e6e6e9]'
      }`}
    >
      <span className="h-4 w-4 shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}

export default function SettingsModal({
  open,
  settings,
  onUpdateSettings,
  onClearAllChats,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('voice');
  const [voiceGender, setVoiceGender] = useState<'Female' | 'Male' | null>(null);
  const [query, setQuery] = useState('');
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      setQuery('');
      setVoiceGender(null);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewingVoice(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const voiceCounts = useMemo(
    () => ({
      Female: AVAILABLE_TTS_VOICES.filter((voice) => voice.gender === 'Female').length,
      Male: AVAILABLE_TTS_VOICES.filter((voice) => voice.gender === 'Male').length,
    }),
    [],
  );

  const selectedVoice =
    AVAILABLE_TTS_VOICES.find((voice) => voice.id === settings.ttsVoice) ??
    AVAILABLE_TTS_VOICES.find((voice) => voice.id === DEFAULT_USER_SETTINGS.ttsVoice) ??
    null;

  const genderVoices = useMemo(() => {
    if (!voiceGender) return [];
    const q = query.trim().toLowerCase();
    return AVAILABLE_TTS_VOICES.filter((voice) => voice.gender === voiceGender).filter(
      (voice) =>
        !q ||
        [voice.name, voice.accent, voice.language, voice.description, voice.id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
    );
  }, [voiceGender, query]);

  if (!open) return null;

  const handlePreviewVoice = async (voice: VoiceOption) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewingVoice === voice.id) {
      setPreviewingVoice(null);
      return;
    }

    setPreviewingVoice(voice.id);
    try {
      const res = await authenticatedFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:
            voice.previewText ??
            'Hello! I am VOID, developed by MN. Ready to help with your project.',
          tl: voice.previewLang ?? 'en-US',
          voice: voice.id,
        }),
      });
      if (!res.ok) {
        setPreviewingVoice(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = settings.ttsSpeed || 1.0;
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewingVoice(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPreviewingVoice(null);
      };
      await audio.play();
    } catch {
      setPreviewingVoice(null);
    }
  };

  const renderVoiceRow = (voice: VoiceOption) => {
    const selected = settings.ttsVoice === voice.id;
    const isPreviewing = previewingVoice === voice.id;
    const isDefault = DEFAULT_USER_SETTINGS.ttsVoice === voice.id;

    return (
      <div
        key={voice.id}
        onClick={() => onUpdateSettings({ ...settings, ttsVoice: voice.id })}
        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
          selected
            ? 'border-white/[0.22] bg-white/[0.06]'
            : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.03]'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-[#ededed]">
              {voice.name}
            </span>
            {isDefault ? (
              <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] leading-none text-[#8a8a8f]">
                Default
              </span>
            ) : null}
          </div>
          <p
            className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]"
            title={voice.description}
          >
            {voiceMeta(voice)}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handlePreviewVoice(voice);
          }}
          aria-label={`Preview ${voice.name}`}
          className="rounded-md px-2 py-1 text-[11.5px] font-medium text-[#a1a1a6] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          {isPreviewing ? 'Stop' : 'Preview'}
        </button>

        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-white bg-white text-black' : 'border-white/25'
          }`}
        >
          {selected ? (
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-[ai-fade-in_160ms_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[620px] max-h-[calc(100vh-2rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#111111] text-[#ededed] shadow-2xl md:flex-row"
      >
        {/* Left navigation */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.07] bg-[#0d0d0d] px-3 py-2 md:w-[196px] md:flex-col md:items-stretch md:gap-0.5 md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4">
          <div className="hidden px-2 pb-3 text-[12.5px] font-semibold text-[#ededed] md:block">
            Settings
          </div>

          <NavItem
            active={activeTab === 'voice'}
            onClick={() => {
              setActiveTab('voice');
              setVoiceGender(null);
              setQuery('');
            }}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
            }
          >
            Voice
          </NavItem>

          <NavItem
            active={activeTab === 'general'}
            onClick={() => setActiveTab('general')}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            }
          >
            General
          </NavItem>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8a8f] hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 md:px-6">
            <div>
              <h2 className="text-[15px] font-semibold text-white">
                {activeTab === 'voice' ? 'Voice' : 'General'}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-[#8a8a8f]">
                {activeTab === 'voice'
                  ? 'Choose the voice used for spoken replies and previews.'
                  : 'Interface and conversation preferences for this browser.'}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8a8a8f] transition-colors hover:bg-white/[0.06] hover:text-white md:inline-flex"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {activeTab === 'voice' ? (
            <>
              {voiceGender === null ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
                  <div className="text-[11px] font-medium tracking-wide text-[#6f6f76]">
                    CURRENT VOICE
                  </div>
                  <div className="mt-2 flex items-center gap-3 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-[#ededed]">
                          {selectedVoice ? selectedVoice.name : 'Not selected'}
                        </span>
                        {selectedVoice &&
                        selectedVoice.id === DEFAULT_USER_SETTINGS.ttsVoice ? (
                          <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] leading-none text-[#8a8a8f]">
                            Default
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]">
                        {selectedVoice ? voiceMeta(selectedVoice) : '—'}
                      </p>
                    </div>
                    {selectedVoice ? (
                      <button
                        type="button"
                        onClick={() => void handlePreviewVoice(selectedVoice)}
                        aria-label={`Preview ${selectedVoice.name}`}
                        className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium text-[#a1a1a6] transition-colors hover:bg-white/[0.08] hover:text-white"
                      >
                        {previewingVoice === selectedVoice.id ? 'Stop' : 'Preview'}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-6 text-[11px] font-medium tracking-wide text-[#6f6f76]">
                    BROWSE VOICES
                  </div>
                  <div className="mt-2 space-y-1">
                    {(['Female', 'Male'] as const).map((gender) => (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => {
                          setVoiceGender(gender);
                          setQuery('');
                        }}
                        className="flex w-full items-center justify-between rounded-lg border border-white/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                      >
                        <span className="text-[13px] font-medium text-[#ededed]">
                          {gender} voices
                        </span>
                        <span className="flex items-center gap-2 text-[11.5px] text-[#8a8a8f]">
                          {voiceCounts[gender]}
                          <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-5 pt-4 md:px-6">
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceGender(null);
                        setQuery('');
                      }}
                      className="flex items-center gap-1 text-[12.5px] font-medium text-[#8a8a8f] transition-colors hover:text-white"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      All voices
                    </button>
                    <span className="text-[11.5px] text-[#6f6f76]">
                      {voiceGender} · {voiceCounts[voiceGender]}
                    </span>
                  </div>

                  <div className="px-5 pt-3 md:px-6">
                    <div className="relative">
                      <svg
                        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f6f76]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${voiceGender.toLowerCase()} voices`}
                        aria-label={`Search ${voiceGender.toLowerCase()} voices`}
                        className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-[13px] text-[#ededed] placeholder:text-[#6f6f76] focus:border-white/[0.2] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-5 py-4 md:px-6">
                    {genderVoices.map(renderVoiceRow)}

                    {genderVoices.length === 0 ? (
                      <p className="px-1 py-6 text-center text-[12.5px] text-[#8a8a8f]">
                        No voices match “{query.trim()}”.
                      </p>
                    ) : null}
                  </div>
                </>
              )}

              <div className="space-y-3.5 border-t border-white/[0.07] px-5 py-4 md:px-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13px] font-medium text-[#ededed]">
                      Speech speed
                    </div>
                    <div className="text-[11.5px] text-[#8a8a8f]">
                      Playback rate for spoken replies
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
                    {SPEED_OPTIONS.map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ ...settings, ttsSpeed: spd })
                        }
                        aria-pressed={Math.abs(settings.ttsSpeed - spd) < 0.02}
                        className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                          Math.abs(settings.ttsSpeed - spd) < 0.02
                            ? 'bg-white/[0.1] text-white'
                            : 'text-[#8a8a8f] hover:text-[#e6e6e9]'
                        }`}
                      >
                        {spd.toFixed(1)}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13px] font-medium text-[#ededed]">
                      Auto-read responses
                    </div>
                    <div className="text-[11.5px] text-[#8a8a8f]">
                      Read VOID replies aloud when they finish
                    </div>
                  </div>
                  <Switch
                    checked={settings.autoReadResponses}
                    label="Auto-read responses"
                    onChange={() =>
                      onUpdateSettings({
                        ...settings,
                        autoReadResponses: !settings.autoReadResponses,
                      })
                    }
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[#ededed]">
                    Compact chat layout
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#8a8a8f]">
                    Reduce vertical spacing between messages
                  </div>
                </div>
                <Switch
                  checked={settings.compactMode}
                  label="Compact chat layout"
                  onChange={() =>
                    onUpdateSettings({
                      ...settings,
                      compactMode: !settings.compactMode,
                    })
                  }
                />
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="text-[11px] font-medium tracking-wide text-[#6f6f76]">
                  CONNECTED TOOLS
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[
                    'VOID Combo',
                    'Web search',
                    'ElevenLabs TTS',
                    'Deepgram Flux TTS',
                  ].map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11.5px] text-[#c9c9cf]"
                    >
                      <span className="h-1 w-1 rounded-full bg-white/60" />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-white/[0.07] pt-4">
                <div>
                  <div className="text-[13px] font-medium text-[#ededed]">
                    Clear all chats
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#8a8a8f]">
                    Delete every saved conversation from this browser
                  </div>
                </div>
                {confirmClear ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[11.5px] font-medium text-[#c9c9cf] transition-colors hover:bg-white/[0.1] hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClearAllChats();
                        setConfirmClear(false);
                      }}
                      className="rounded-md bg-red-500/15 px-2.5 py-1.5 text-[11.5px] font-medium text-red-300 transition-colors hover:bg-red-500/25"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="shrink-0 rounded-md border border-white/[0.1] px-2.5 py-1.5 text-[11.5px] font-medium text-[#c9c9cf] transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
