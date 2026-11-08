import { useEffect, useMemo, useRef, useState } from 'react';
import PromptBar from './components/PromptBar';
import LatticeLoader from './components/LatticeLoader';
import AiMessage from './components/AiMessage';
import Sidebar, { type SidebarSection } from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import AuthModal, {
  type GuestProfileInfo,
  loadGuestProfile,
  saveGuestProfile,
} from './components/AuthModal';
import type { User } from '@supabase/supabase-js';
import { signOutCurrentSession, subscribeToAuthState } from './lib/auth';
import { isSupabaseConfigured } from './lib/supabase';
import { authenticatedFetch } from './lib/api-fetch';
import {
  streamChatCompletion,
  type StreamChatMessage,
  type TerminalToolContinuation,
} from './lib/chat-stream';
import { SpeculativePreThinkEngine } from './lib/speculative-prethink';
import { shouldTriggerWebSearch } from './lib/tools/search_engine';
import {
  type AgentPlanStep,
  type ChatAttachment,
  type ChatAttachmentItem,
  type ChatMessage,
  type ChatSession,
  type PendingTerminalCommand,
  type UserSettings,
  deriveChatTitle,
  loadLegacyChatSessions,
  loadChatSessions,
  loadUserSettings,
  saveChatSessions,
  saveUserSettings,
} from './lib/chat-storage';
import { addSemanticMemory } from './lib/memory-storage';
import {
  deleteAllChatHistory,
  deleteChatHistoryItem,
  loadAndMigrateChatHistory,
  mergeChatHistory,
  persistChangedChatSessions,
  refreshChatHistory,
  subscribeToChatHistory,
} from './lib/chat-persistence';

const sessionFingerprint = (session: ChatSession) => {
  const lastMsg = session.messages[session.messages.length - 1];
  return `${session.id}:${session.updatedAt}:${session.messages.length}:${session.pinned ? 1 : 0}:${session.title}:${lastMsg?.id ?? ''}:${lastMsg?.text.length ?? 0}:${lastMsg?.pendingCommand?.status ?? ''}`;
};

function createClientId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function readSingleFileAsAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve) => {
    if (file.type && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const rawDataUrl = String(reader.result ?? '');
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 1280;
            let { width: w, height: h } = img;
            if (w > maxDim || h > maxDim) {
              if (w >= h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, w, h);
              const compressed = canvas.toDataURL('image/jpeg', 0.86);
              resolve({
                name: file.name || 'image.jpg',
                type: 'image/jpeg',
                dataUrl: compressed,
              });
              return;
            }
          } catch {
            // Fall back to raw dataUrl
          }
          resolve({
            name: file.name || 'image.png',
            type: file.type || 'image/png',
            dataUrl: rawDataUrl,
          });
        };
        img.onerror = () =>
          resolve({
            name: file.name || 'image.png',
            type: file.type || 'image/png',
            dataUrl: rawDataUrl,
          });
        img.src = rawDataUrl;
      };
      reader.onerror = () =>
        resolve({
          name: file.name || 'image.png',
          type: file.type || 'image/png',
        });
      reader.readAsDataURL(file);
      return;
    }

    resolve({
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
    });
  });
}

const pickFiles = () =>
  new Promise<ChatAttachment[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py';
    input.multiple = true;
    input.onchange = () => {
      const rawFiles = Array.from(input.files ?? []);
      if (rawFiles.length === 0) {
        resolve([]);
        return;
      }
      void Promise.all(rawFiles.map(readSingleFileAsAttachment)).then(resolve);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });

function extractAttachmentImageUrls(
  attachments?: ChatAttachmentItem[],
): string[] {
  if (!attachments || attachments.length === 0) return [];
  const urls: string[] = [];
  for (const item of attachments) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.dataUrl === 'string' &&
      item.dataUrl.startsWith('data:image/')
    ) {
      urls.push(item.dataUrl);
    }
  }
  return urls;
}

const CHAT_SUGGESTIONS = [
  {
    id: 'chat-1',
    label: 'VOID app glass voice search UI',
    prompt: 'Design a sleek glass voice search UI component for my VOID app',
    icon: 'image',
  },
  {
    id: 'chat-2',
    label: 'Design a poster based on my taste',
    prompt: 'Create an image of a minimalist futuristic dark tech poster',
    icon: 'sparkle',
  },
  {
    id: 'chat-3',
    label: 'Find top mystery thriller movies',
    prompt: 'Find the top mystery thriller movies with twists to watch tonight',
    icon: 'ticket',
  },
];

function SuggestionIcon({ kind }: { kind: string }) {
  if (kind === 'image') {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-[#a1a1aa]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    );
  }
  if (kind === 'ticket') {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-[#a1a1aa]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    );
  }
  return (
    <svg
      className="h-4 w-4 shrink-0 text-[#a1a1aa]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
    </svg>
  );
}

/**
 * Gemini-Style User Message Bubble:
 * - Symmetric `rounded-2xl` on all 4 corners (no sharp bottom-right tooth!)
 * - Collapses long messages to 4 lines by default with a compact `v` / `^` chevron button to expand/collapse.
 */
function UserMessageBubble({
  text,
  agentMode,
}: {
  text: string;
  agentMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLongMessage = useMemo(
    () => text.length > 210 || text.split('\n').length > 4,
    [text],
  );

  return (
    <div className="relative flex max-w-[82%] items-start gap-2 rounded-2xl bg-[#23242a] px-4 py-2.5 text-[15px] leading-relaxed text-[#f5f5f5] shadow-sm">
      <div
        className={`min-w-0 flex-1 break-words ${
          isLongMessage && !expanded ? 'line-clamp-4' : ''
        }`}
      >
        {agentMode ? (
          <span className="mr-2 inline-flex items-center gap-1 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10.5px] font-medium text-[#e4e4e7]">
            Agent
          </span>
        ) : null}
        {text}
      </div>

      {isLongMessage ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse message' : 'Expand message'}
          aria-label={expanded ? 'Collapse message' : 'Expand message'}
          aria-expanded={expanded}
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#a1a1aa] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function deriveContextualChatThoughts(userPrompt: string): string[] {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return [
      'Examining your attached media and visual details…',
      'Identifying key elements and preparing a clear response…',
    ];
  }

  if (
    /^(hi+|hello+|hey+|hlo+|yo+|hola|sup|namaskaram|salaam|assalamu\s*alaikum|good\s*(morning|afternoon|evening))[!.?\s]*$/i.test(
      raw,
    )
  ) {
    return [
      'Recognizing the greeting and checking conversation context…',
      'Thinking of a warm, natural way to greet you back…',
      'Formulating a friendly opening response…',
    ];
  }

  if (raw.length <= 4 && !/\s/.test(raw)) {
    return [
      'Interpreting the message intent and conversation context…',
      'Checking possible meanings and relevant context…',
      'Preparing a clear, helpful reply…',
    ];
  }

  if (/[\u0D00-\u0D7F]/.test(raw)) {
    return [
      'സന്ദേശത്തിന്റെ ആശയവും പശ്ചാത്തലവും വിശകലനം ചെയ്യുന്നു…',
      'പ്രധാന വിവരങ്ങൾ പരിശോധിച്ച് മറുപടി ക്രമീകരിക്കുന്നു…',
      'വ്യക്തവും കൃത്യവുമായ മറുപടി തയ്യാറാക്കുന്നു…',
    ];
  }

  if (
    /\b(code|bug|error|fix|function|react|typescript|python|css|html|api|component|build|compile)\b/i.test(
      lower,
    )
  ) {
    return [
      'Analyzing the technical details and architecture…',
      'Checking edge cases, logic flow, and clean implementation patterns…',
      'Structuring a clear, working solution…',
    ];
  }

  if (
    /^(what|how|why|when|where|who|which|can|could|should|is|are|do|does|explain|tell)\b/i.test(
      lower,
    ) ||
    raw.endsWith('?')
  ) {
    return [
      'Understanding the core question and relevant context…',
      'Gathering the most relevant facts and details…',
      'Structuring a clear, direct explanation…',
    ];
  }

  return [
    'Understanding the context and key points of your message…',
    'Evaluating key details to address your request…',
    'Drafting a clear, helpful response…',
  ];
}

function GoogleEmblemIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 opacity-85"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z"
      />
    </svg>
  );
}

/**
 * Chat Mode 3-Dot Wave + Faded-Out Grey Live AI Thoughts Indicator:
 * - The thinking text starts at `left: 0` of the 720px column — on the EXACT same
 *   vertical alignment line as the AI response text ("Hey!...") and the PromptBar's left edge.
 * - The 3 waving dots (`• • •`) sit OUTSIDE to the left (`right-full mr-2`) with tight spacing.
 * - When web search is active, displays the Google `G` emblem alongside the search status.
 */
function ChatThinkingWave({
  userPrompt,
  liveThought,
  searchSource,
}: {
  userPrompt: string;
  liveThought?: string | null;
  searchSource?: string | null;
}) {
  const willSearch = useMemo(
    () => Boolean(searchSource || shouldTriggerWebSearch(userPrompt)),
    [searchSource, userPrompt],
  );
  const contextualThoughts = useMemo(() => {
    if (willSearch) {
      return [
        'Searching Google…',
        'Checking Reddit and live web discussions…',
        'Synthesizing verified information from live sources…',
      ];
    }
    return deriveContextualChatThoughts(userPrompt);
  }, [userPrompt, willSearch]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
    const timer = window.setInterval(() => {
      setStepIndex((prev) =>
        prev < contextualThoughts.length - 1 ? prev + 1 : prev,
      );
    }, 1450);
    return () => window.clearInterval(timer);
  }, [contextualThoughts]);

  const activeThoughtText =
    liveThought && liveThought.trim().length > 0
      ? liveThought.trim()
      : contextualThoughts[stepIndex] || contextualThoughts[0];

  return (
    <div
      className="relative flex items-center py-1 select-none"
      role="status"
      aria-live="polite"
    >
      {/* 3-Dot Wave Animation placed OUTSIDE to the left of the text start line */}
      <div className="absolute right-full mr-2 inline-flex items-center gap-[3px] py-1">
        <span
          className="thinking-wave-dot"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="thinking-wave-dot"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="thinking-wave-dot"
          style={{ animationDelay: '300ms' }}
        />
      </div>

      {/* Faded-Out Grey Dynamic AI Thought Text aligned directly with PromptBar left edge */}
      <div className="flex items-center gap-2">
        {willSearch ? <GoogleEmblemIcon /> : null}
        <span
          key={activeThoughtText}
          className="thinking-thought-text max-w-[650px] truncate"
        >
          {activeThoughtText}
        </span>
      </div>
    </div>
  );
}

/**
 * Top Capsule Switcher (`Chat` | `Agent`) — visible ONLY on an empty New Chat.
 */
function TopModeCapsule({
  agentMode,
  onSelectMode,
}: {
  agentMode: boolean;
  onSelectMode: (isAgent: boolean) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Conversation mode"
      className="inline-flex items-center rounded-full border border-white/[0.08] bg-[#141418]/90 p-1 shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all duration-300"
    >
      <button
        type="button"
        role="tab"
        aria-selected={!agentMode}
        onClick={() => onSelectMode(false)}
        className={`rounded-full px-4 py-1 text-[13px] font-medium transition-all duration-200 ${
          !agentMode
            ? 'border border-white/[0.12] bg-[#2b2b33] text-white shadow-sm'
            : 'border border-transparent text-[#9a9aa2] hover:text-[#e4e4e7]'
        }`}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={agentMode}
        onClick={() => onSelectMode(true)}
        className={`rounded-full px-4 py-1 text-[13px] font-medium transition-all duration-200 ${
          agentMode
            ? 'border border-white/[0.16] bg-[#323238] text-white shadow-sm'
            : 'border border-transparent text-[#9a9aa2] hover:text-[#e4e4e7]'
        }`}
      >
        Agent
      </button>
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    loadChatSessions(),
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SidebarSection>('chat');
  const [agentMode, setAgentMode] = useState<boolean>(false);
  const [connectedFolders, setConnectedFolders] = useState<string[]>([]);
  const [newChatAnimKey, setNewChatAnimKey] = useState<number>(1);

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [guestProfile, setGuestProfile] = useState<GuestProfileInfo | null>(
    () => loadGuestProfile(),
  );
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyReady, setHistoryReady] = useState(!isSupabaseConfigured());
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );

  const [selectedEffort, setSelectedEffort] = useState<string>('High');
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [liveChatThought, setLiveChatThought] = useState<string | null>(null);
  const [liveSearchSource, setLiveSearchSource] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const preThinkEngineRef = useRef<SpeculativePreThinkEngine | null>(null);
  if (!preThinkEngineRef.current) {
    preThinkEngineRef.current = new SpeculativePreThinkEngine();
  }
  const checkedInitialAuthModalRef = useRef(false);

  const handleStopGeneration = () => {
    controller.current?.abort();
    controller.current = null;
    preThinkEngineRef.current?.reset();
    setBusy(false);
    setStreamingId(null);
    setLiveChatThought(null);
    setLiveSearchSource(null);
  };

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const latestUserMsgRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledUserMsgIdRef = useRef<string | null>(null);
  const historyUserId = useRef<string | null | undefined>(undefined);
  const historyRequest = useRef(0);
  const persistedHashes = useRef<Record<string, string>>({});
  const latestSessions = useRef(sessions);

  useEffect(() => {
    latestSessions.current = sessions;
  }, [sessions]);

  const activeSession =
    sessions.find((s) => s.id === activeChatId) ?? null;
  const messages: ChatMessage[] = activeSession?.messages ?? [];

  const lastUserMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  }, [messages]);

  const lastUserMessageId =
    lastUserMessageIndex >= 0 ? messages[lastUserMessageIndex].id : null;

  useEffect(() => {
    if (!lastUserMessageId) {
      lastScrolledUserMsgIdRef.current = null;
      return;
    }
    if (lastScrolledUserMsgIdRef.current === lastUserMessageId) return;
    lastScrolledUserMsgIdRef.current = lastUserMessageId;

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const targetEl = latestUserMsgRef.current;
      if (container && targetEl) {
        const targetTop = Math.max(0, targetEl.offsetTop - 24);
        container.scrollTo({
          top: targetTop,
          behavior: 'smooth',
        });
      }
    });
  }, [lastUserMessageId]);

  const isSessionLocked = messages.length > 0;
  const lockedSessionAgentMode = useMemo(() => {
    if (!activeSession || activeSession.messages.length === 0) return null;
    if (typeof activeSession.agentMode === 'boolean') {
      return activeSession.agentMode;
    }
    return activeSession.messages.some((m) => Boolean(m.agentMode));
  }, [activeSession]);

  const effectiveAgentMode =
    lockedSessionAgentMode !== null ? lockedSessionAgentMode : agentMode;

  const isAuthenticatedAccount = Boolean(authUser && !authUser.is_anonymous);
  const hasAnyActiveSession = Boolean(isAuthenticatedAccount || guestProfile);

  // On first visit (if neither signed in with a real account nor logged in as Guest in localStorage),
  // automatically open the Login Modal! Once Guest or Account is logged in, it persists across refreshes/restarts.
  useEffect(() => {
    if (!historyReady || checkedInitialAuthModalRef.current) return;
    checkedInitialAuthModalRef.current = true;
    const savedGuest = loadGuestProfile();
    if (!authUser && !savedGuest) {
      setAuthOpen(true);
    } else if (authUser?.is_anonymous && !savedGuest) {
      setAuthOpen(true);
    }
  }, [historyReady, authUser]);

  // Extract Google / Authenticated user's display name or Guest name, preserving exact user-entered casing!
  // Returns empty string '' when no account or guest is logged in yet (so greeting says "Hi, what's on your mind?").
  const accountDisplayName = useMemo(() => {
    if (isAuthenticatedAccount && authUser) {
      const meta = authUser.user_metadata as
        | Record<string, unknown>
        | undefined;
      const fullName =
        (typeof meta?.full_name === 'string' && meta.full_name.trim()) ||
        (typeof meta?.name === 'string' && meta.name.trim()) ||
        (typeof meta?.user_name === 'string' && meta.user_name.trim()) ||
        '';
      if (fullName) return fullName;

      const email = authUser.email ?? '';
      if (email) {
        return email.split('@')[0] || 'Account';
      }
      if (authUser.phone) return authUser.phone;
    }
    if (guestProfile?.name) {
      return guestProfile.name;
    }
    return '';
  }, [authUser, isAuthenticatedAccount, guestProfile]);

  const accountAvatarUrl = useMemo(() => {
    if (!isAuthenticatedAccount || !authUser) return undefined;
    const meta = authUser.user_metadata as Record<string, unknown> | undefined;
    const url =
      (typeof meta?.avatar_url === 'string' && meta.avatar_url.trim()) ||
      (typeof meta?.picture === 'string' && meta.picture.trim()) ||
      '';
    return url || undefined;
  }, [authUser, isAuthenticatedAccount]);

  // Preserve exact casing typed by the user; if not logged in / no guest name yet, empty string -> "Hi, what's on your mind?"
  const userFirstName = useMemo(() => {
    if (!accountDisplayName.trim()) return '';
    return accountDisplayName.trim().split(/\s+/)[0] || '';
  }, [accountDisplayName]);

  const galleryImages = useMemo(() => {
    const list: Array<{ id: string; url: string; title: string }> = [];
    for (const sess of sessions) {
      for (const m of sess.messages) {
        for (const url of extractAttachmentImageUrls(m.attachments)) {
          list.push({
            id: `${m.id}-att-${list.length}`,
            url,
            title: sess.title || 'Uploaded image',
          });
        }
        if (m.text.includes('![') && m.text.includes('](')) {
          const lines = m.text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('![') && trimmed.endsWith(')')) {
              const mid = trimmed.indexOf('](');
              if (mid >= 2) {
                const alt = trimmed.slice(2, mid);
                const src = trimmed.slice(mid + 2, -1).trim();
                if (src) {
                  list.push({
                    id: `${m.id}-gen-${list.length}`,
                    url: src,
                    title: alt || sess.title || 'Generated image',
                  });
                }
              }
            }
          }
        }
      }
    }
    return list;
  }, [sessions]);

  useEffect(() => {
    if (!historyReady) return;
    saveChatSessions(sessions, authUser?.id);
  }, [sessions, authUser?.id, historyReady]);

  useEffect(() => {
    if (!authUser || !historyReady) return;
    const userId = authUser.id;
    const changed = sessions.filter(
      (session) =>
        persistedHashes.current[session.id] !== sessionFingerprint(session),
    );
    if (changed.length === 0) return;

    const timer = window.setTimeout(() => {
      void persistChangedChatSessions(userId, changed)
        .then(() => {
          if (historyUserId.current !== userId) return;
          for (const session of changed) {
            const current = latestSessions.current.find(
              (item) => item.id === session.id,
            );
            if (
              current &&
              sessionFingerprint(current) === sessionFingerprint(session)
            ) {
              persistedHashes.current[session.id] = sessionFingerprint(session);
            }
          }
          setHistoryWarning(null);
        })
        .catch((error: unknown) => {
          if (historyUserId.current !== userId) return;
          const details = error instanceof Error ? ` ${error.message}` : '';
          setHistoryWarning(
            `Chat history is saved on this device but could not sync to Supabase.${details}`,
          );
          console.error('Chat history sync failed.', error);
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [sessions, authUser, historyReady]);

  useEffect(() => {
    saveUserSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;

    const subscription = subscribeToAuthState((event, session) => {
      const nextUser = session?.user ?? null;
      setAuthUser(session?.user ?? null);

      if (nextUser) {
        if (historyUserId.current === nextUser.id) return;
        historyUserId.current = nextUser.id;
        const requestId = ++historyRequest.current;
        persistedHashes.current = {};
        setHistoryReady(false);
        setHistoryWarning(null);
        setSessions([]);
        setActiveChatId(null);
        void loadAndMigrateChatHistory(nextUser.id).then((result) => {
          if (historyRequest.current !== requestId) return;
          setSessions(result.sessions);
          setActiveChatId(null);
          setHistoryWarning(result.warning);
          if (!result.warning) {
            persistedHashes.current = Object.fromEntries(
              result.sessions.map((item) => [
                item.id,
                sessionFingerprint(item),
              ]),
            );
          }
          setHistoryReady(true);
        });
        return;
      }

      if (historyUserId.current !== null) {
        historyUserId.current = null;
        historyRequest.current += 1;
        persistedHashes.current = {};
        setHistoryWarning(null);
        const localSessions =
          event === 'INITIAL_SESSION' ? loadLegacyChatSessions() : [];
        setSessions(localSessions);
        setActiveChatId(null);
        setHistoryReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUser || !historyReady) return undefined;
    let active = true;
    const channel = subscribeToChatHistory(authUser.id, () => {
      void refreshChatHistory(authUser.id)
        .then((remoteSessions) => {
          if (!active || historyUserId.current !== authUser.id) return;
          setSessions((current) => {
            const merged = mergeChatHistory(remoteSessions, current);
            return merged.filter(
              (session) =>
                remoteSessions.some((remote) => remote.id === session.id) ||
                persistedHashes.current[session.id] !==
                  sessionFingerprint(session),
            );
          });
        })
        .catch((error: unknown) => {
          console.warn('Unable to refresh chat history.', error);
        });
    });

    return () => {
      active = false;
      void channel.unsubscribe();
    };
  }, [authUser?.id, historyReady]);

  const handleConnectFolder = async () => {
    try {
      const win = window as unknown as {
        showDirectoryPicker?: () => Promise<{ name: string }>;
      };
      if (typeof win.showDirectoryPicker === 'function') {
        const handle = await win.showDirectoryPicker();
        if (handle?.name) {
          setConnectedFolders((prev) =>
            prev.includes(handle.name) ? prev : [...prev, handle.name],
          );
          return;
        }
      }
    } catch {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.onchange = () => {
      const firstFile = input.files?.[0] as
        | (File & { webkitRelativePath?: string })
        | undefined;
      const folderName =
        firstFile?.webkitRelativePath?.split('/')[0] ||
        firstFile?.name ||
        'Workspace';
      setConnectedFolders((prev) =>
        prev.includes(folderName) ? prev : [...prev, folderName],
      );
    };
    input.click();
  };

  const handleDisconnectFolder = (folderName?: string) => {
    if (!folderName) return;
    setConnectedFolders((prev) => prev.filter((name) => name !== folderName));
  };

  // New Chat resets to 'Chat' mode and triggers the blooming entrance animation
  const handleNewChat = () => {
    if (busy) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
    setActiveSection('chat');
    setActiveChatId(null);
    setAgentMode(false);
    setNewChatAnimKey((k) => k + 1);
  };

  const handleSelectChat = (id: string) => {
    if (busy && id !== activeChatId) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
    const targetSession = sessions.find((s) => s.id === id);
    if (targetSession) {
      const targetIsAgent =
        typeof targetSession.agentMode === 'boolean'
          ? targetSession.agentMode
          : targetSession.messages.some((m) => Boolean(m.agentMode));
      setAgentMode(targetIsAgent);
    }
    setActiveSection('chat');
    setActiveChatId(id);
  };

  const handleTogglePin = (id: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s,
      ),
    );
  };

  const handleDeleteChat = (id: string) => {
    if (id === activeChatId && busy) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (id === activeChatId) {
        const nextSession = remaining.length > 0 ? remaining[0] : null;
        setActiveChatId(nextSession ? nextSession.id : null);
        if (nextSession) {
          const nextIsAgent =
            typeof nextSession.agentMode === 'boolean'
              ? nextSession.agentMode
              : nextSession.messages.some((m) => Boolean(m.agentMode));
          setAgentMode(nextIsAgent);
        } else {
          setAgentMode(false);
        }
      }
      return remaining;
    });
    persistedHashes.current[id] = '';
    if (authUser && historyReady) {
      void deleteChatHistoryItem(authUser.id, id).catch((error: unknown) => {
        const details = error instanceof Error ? ` ${error.message}` : '';
        setHistoryWarning(
          `Could not delete this conversation from Supabase.${details}`,
        );
      });
    }
  };

  const handleClearAllChats = () => {
    if (busy) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
    setSessions([]);
    setActiveChatId(null);
    setAgentMode(false);
    persistedHashes.current = {};
    if (authUser && historyReady) {
      void deleteAllChatHistory(authUser.id).catch((error: unknown) => {
        const details = error instanceof Error ? ` ${error.message}` : '';
        setHistoryWarning(
          `Could not clear chat history from Supabase.${details}`,
        );
      });
    }
  };

  /**
   * Logs out of any account (both Google/Email accounts AND Guest sessions)
   * when triggered from Settings -> General -> Log out or AuthModal.
   */
  const handleFullLogOut = async () => {
    if (busy) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
    saveGuestProfile(null);
    setGuestProfile(null);
    setActiveChatId(null);
    setAgentMode(false);
    setSettingsOpen(false);
    try {
      if (authUser) {
        await signOutCurrentSession();
      }
    } catch {
      // Ignore if session already expired
    }
    setAuthUser(null);
    setAuthOpen(true);
  };

  const appendOrUpdateSessionMessages = (
    sessionId: string,
    updater: (prevMessages: ChatMessage[]) => ChatMessage[],
    fallbackFirstText = '',
    lockedAgentFlag = false,
  ) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === sessionId);
      if (!exists) {
        const initialMessages = updater([]);
        const newSession: ChatSession = {
          id: sessionId,
          title: deriveChatTitle(fallbackFirstText || 'Image analysis'),
          messages: initialMessages,
          agentMode: lockedAgentFlag,
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return [newSession, ...prev];
      }

      return prev.map((s) => {
        if (s.id !== sessionId) return s;
        const nextMsgs = updater(s.messages);
        const nextTitle =
          s.title === 'New Chat' && fallbackFirstText
            ? deriveChatTitle(fallbackFirstText)
            : s.title;
        return {
          ...s,
          title: nextTitle,
          messages: nextMsgs,
          agentMode: s.agentMode ?? lockedAgentFlag,
          updatedAt: Date.now(),
        };
      });
    });
  };

  const handleTerminalDecision = async (
    sessionId: string,
    aiMsgId: string,
    action: 'allow' | 'deny' | 'skip',
    finalCommand: string,
  ) => {
    const targetSession = latestSessions.current.find(
      (s) => s.id === sessionId,
    );
    const targetAiMsg = targetSession?.messages.find((m) => m.id === aiMsgId);
    if (!targetSession || !targetAiMsg || !targetAiMsg.pendingCommand) return;

    const currentPending = targetAiMsg.pendingCommand;

    const immediateStatus: PendingTerminalCommand['status'] =
      action === 'allow'
        ? 'running'
        : action === 'deny'
          ? 'denied'
          : 'skipped';

    appendOrUpdateSessionMessages(
      sessionId,
      (prev) =>
        prev.map((m) => {
          if (m.id !== aiMsgId) return m;
          const updatedSteps = m.agentSteps?.map((s) =>
            s.id === 'step-terminal'
              ? {
                  ...s,
                  status:
                    action === 'allow'
                      ? ('running' as const)
                      : ('completed' as const),
                  detail:
                    action === 'allow'
                      ? `Executing \`${finalCommand}\`…`
                      : action === 'deny'
                        ? 'Command rejected by user'
                        : 'Command skipped by user',
                }
              : s,
          );
          return {
            ...m,
            agentSteps: updatedSteps,
            pendingCommand: {
              ...currentPending,
              command: finalCommand,
              status: immediateStatus,
            },
          };
        }),
      '',
      true,
    );

    let terminalResultPayload: TerminalToolContinuation = {
      id: currentPending.id,
      command: finalCommand,
      cwd: currentPending.cwd,
      status: action === 'deny' ? 'denied' : 'skipped',
      output:
        action === 'deny'
          ? 'Command execution rejected by user.'
          : 'Command skipped by user.',
      exitCode: null,
    };

    try {
      const termRes = await authenticatedFetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          command: finalCommand,
          cwd: currentPending.cwd,
          connectedFolders,
        }),
      });

      if (termRes.ok) {
        const data = (await termRes.json()) as {
          command?: string;
          status?: 'completed' | 'failed' | 'denied' | 'skipped';
          output?: string;
          exitCode?: number | null;
          cwd?: string;
        };
        terminalResultPayload = {
          id: currentPending.id,
          command: data.command || finalCommand,
          cwd: data.cwd ?? currentPending.cwd,
          status:
            data.status ??
            (action === 'allow'
              ? 'completed'
              : action === 'deny'
                ? 'denied'
                : 'skipped'),
          output: data.output ?? '',
          exitCode: data.exitCode ?? 0,
        };
      }
    } catch (err) {
      terminalResultPayload = {
        id: currentPending.id,
        command: finalCommand,
        cwd: currentPending.cwd,
        status:
          action === 'allow'
            ? 'failed'
            : action === 'deny'
              ? 'denied'
              : 'skipped',
        output:
          err instanceof Error ? err.message : 'Terminal execution failed.',
        exitCode: 1,
      };
    }

    appendOrUpdateSessionMessages(
      sessionId,
      (prev) =>
        prev.map((m) => {
          if (m.id !== aiMsgId) return m;
          const updatedSteps = m.agentSteps?.map((s) =>
            s.id === 'step-terminal'
              ? {
                  ...s,
                  status:
                    terminalResultPayload.status === 'failed'
                      ? ('failed' as const)
                      : ('completed' as const),
                  detail:
                    action === 'allow'
                      ? `Executed \`${terminalResultPayload.command}\` (exit ${terminalResultPayload.exitCode ?? 0})`
                      : action === 'deny'
                        ? 'Command rejected by user'
                        : 'Command skipped by user',
                }
              : s,
          );
          return {
            ...m,
            agentSteps: updatedSteps,
            pendingCommand: {
              ...currentPending,
              command: terminalResultPayload.command,
              cwd: terminalResultPayload.cwd,
              status: terminalResultPayload.status,
              output: terminalResultPayload.output,
              exitCode: terminalResultPayload.exitCode,
            },
          };
        }),
      '',
      true,
    );

    const msgIdx = targetSession.messages.findIndex((m) => m.id === aiMsgId);
    const priorMessages =
      msgIdx >= 0
        ? targetSession.messages.slice(0, msgIdx)
        : targetSession.messages;

    const historyPayload: StreamChatMessage[] = priorMessages
      .filter(
        (m) =>
          m.text.trim().length > 0 ||
          extractAttachmentImageUrls(m.attachments).length > 0,
      )
      .map((m) => {
        const msgImages = extractAttachmentImageUrls(m.attachments);
        return {
          role: m.role,
          content:
            m.text.trim() ||
            (msgImages.length > 0 ? 'Please analyze this image.' : ''),
          ...(msgImages.length > 0 ? { imageUrls: msgImages } : {}),
        };
      });

    setBusy(true);
    setStreamingId(aiMsgId);
    controller.current = new AbortController();

    try {
      await streamChatCompletion({
        messages: historyPayload,
        model: targetSession.modelKey || 'void-combo',
        effort: selectedEffort || 'High',
        agentMode: true,
        connectedFolders,
        terminalToolResult: terminalResultPayload,
        embeddingModel: settings.embeddingModel,
        moderationEnabled: settings.moderationEnabled,
        signal: controller.current.signal,
        onAgentSteps: (steps, taskTitle) => {
          appendOrUpdateSessionMessages(
            sessionId,
            (prev) =>
              prev.map((m) =>
                m.id === aiMsgId
                  ? {
                      ...m,
                      agentSteps: steps,
                      ...(taskTitle ? { agentTaskTitle: taskTitle } : {}),
                    }
                  : m,
              ),
            '',
            true,
          );
        },
        onChunk: (_delta, fullText) => {
          appendOrUpdateSessionMessages(
            sessionId,
            (prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, text: fullText } : m,
              ),
            '',
            true,
          );
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Connection error while resuming agent response.';
      appendOrUpdateSessionMessages(
        sessionId,
        (prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: errMsg } : m)),
        '',
        true,
      );
    } finally {
      setBusy(false);
      setStreamingId(null);
    }
  };

  const handleDraftChange = (nextDraft: string) => {
    if (busy || effectiveAgentMode) {
      preThinkEngineRef.current?.reset();
      return;
    }
    const existingMessages = activeSession?.messages ?? [];
    const historyPayload: StreamChatMessage[] = existingMessages
      .filter((m) => m.text.trim().length > 0)
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: m.text.trim(),
      }));
    preThinkEngineRef.current?.updateDraft({
      draft: nextDraft,
      model: activeSession?.modelKey || 'void-combo',
      effort: 'Low',
      agentMode: effectiveAgentMode,
      history: historyPayload,
    });
  };

  const send = async (
    text: string,
    {
      attachments,
      model,
      effort,
      agentMode: overrideAgentMode,
      sentViaVoice = false,
    }: {
      attachments: ChatAttachmentItem[];
      model: { key: string; name?: string; shortName?: string };
      effort: string;
      agentMode?: boolean;
      sentViaVoice?: boolean;
    },
  ) => {
    if (!hasAnyActiveSession) {
      setAuthOpen(true);
      return;
    }

    const isAgent =
      lockedSessionAgentMode !== null
        ? lockedSessionAgentMode
        : overrideAgentMode !== undefined
          ? overrideAgentMode
          : agentMode;

    setAgentMode(isAgent);
    setActiveSection('chat');
    const targetChatId = activeChatId ?? createClientId();
    if (!activeChatId) {
      setActiveChatId(targetChatId);
    }

    const uploadedImageUrls = extractAttachmentImageUrls(attachments);
    const effectiveText =
      text.trim() ||
      (uploadedImageUrls.length > 0 ? 'Analyze this image' : '');

    // Consume any invisible background pre-thought generated while the user was typing/speaking
    const preThought =
      !isAgent && uploadedImageUrls.length === 0
        ? preThinkEngineRef.current?.consumeForSend(effectiveText) ?? null
        : null;
    if (isAgent || uploadedImageUrls.length > 0) {
      preThinkEngineRef.current?.reset();
    }

    const userMsg: ChatMessage = {
      id: createClientId(),
      role: 'user',
      text: text.trim(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      agentMode: Boolean(isAgent),
      createdAt: Date.now(),
    };

    const existingMessages = activeSession?.messages ?? [];

    if (effectiveText.length > 0) {
      void addSemanticMemory({
        text: effectiveText,
        preferredModel: settings.embeddingModel,
      }).catch(() => {});
    }

    const aiMsgId = createClientId();
    // Voice-Only Auto-Read: ONLY auto-read when the message was sent via microphone dictation!
    const shouldAutoReadThisTurn = Boolean(sentViaVoice);

    appendOrUpdateSessionMessages(
      targetChatId,
      (prev) => [...prev, userMsg],
      effectiveText,
      Boolean(isAgent),
    );

    // Fast-path: If background pre-thinking already completed an exact response for this exact text,
    // deliver it immediately so the response feels instantaneous!
    if (
      preThought?.exactReply &&
      preThought.exactReply.trim().length > 0 &&
      !shouldTriggerWebSearch(effectiveText)
    ) {
      const readyReply = preThought.exactReply;
      appendOrUpdateSessionMessages(
        targetChatId,
        (prev) => [
          ...prev,
          {
            id: aiMsgId,
            role: 'assistant',
            text: readyReply,
            agentMode: false,
            shouldAutoRead: shouldAutoReadThisTurn,
            createdAt: Date.now(),
          },
        ],
        effectiveText,
        false,
      );
      return;
    }

    const historyPayload: StreamChatMessage[] = [...existingMessages, userMsg]
      .filter(
        (m) =>
          m.text.trim().length > 0 ||
          extractAttachmentImageUrls(m.attachments).length > 0,
      )
      .map((m) => {
        const msgImages = extractAttachmentImageUrls(m.attachments);
        return {
          role: m.role,
          content:
            m.text.trim() ||
            (msgImages.length > 0 ? 'Please analyze this image.' : ''),
          ...(msgImages.length > 0 ? { imageUrls: msgImages } : {}),
        };
      });

    setBusy(true);
    setStreamingId(null);
    setLiveChatThought(null);
    setLiveSearchSource(
      !isAgent && shouldTriggerWebSearch(effectiveText) ? 'google' : null,
    );
    controller.current = new AbortController();

    let createdAiBubble = false;
    let latestSteps: AgentPlanStep[] | undefined;
    let latestTaskTitle: string | undefined;
    let latestPendingCmd: PendingTerminalCommand | undefined;

    const ensureOrUpdateAiBubble = (options: {
      nextText?: string;
      nextSteps?: AgentPlanStep[];
      nextTaskTitle?: string;
      nextPendingCmd?: PendingTerminalCommand;
    }) => {
      if (options.nextSteps) {
        latestSteps = options.nextSteps;
      }
      if (options.nextTaskTitle) {
        latestTaskTitle = options.nextTaskTitle;
      }
      if (options.nextPendingCmd) {
        latestPendingCmd = options.nextPendingCmd;
      }
      if (!createdAiBubble) {
        createdAiBubble = true;
        setStreamingId(aiMsgId);
        appendOrUpdateSessionMessages(
          targetChatId,
          (prev) => [
            ...prev,
            {
              id: aiMsgId,
              role: 'assistant',
              text: options.nextText ?? '',
              agentMode: Boolean(isAgent),
              agentSteps: latestSteps,
              agentTaskTitle: latestTaskTitle,
              pendingCommand: latestPendingCmd,
              shouldAutoRead: shouldAutoReadThisTurn,
              createdAt: Date.now(),
            },
          ],
          effectiveText,
          Boolean(isAgent),
        );
      } else {
        appendOrUpdateSessionMessages(
          targetChatId,
          (prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId
                ? {
                    ...msg,
                    ...(options.nextText !== undefined
                      ? { text: options.nextText }
                      : {}),
                    ...(latestSteps ? { agentSteps: latestSteps } : {}),
                    ...(latestTaskTitle
                      ? { agentTaskTitle: latestTaskTitle }
                      : {}),
                    ...(latestPendingCmd
                      ? { pendingCommand: latestPendingCmd }
                      : {}),
                  }
                : msg,
            ),
          effectiveText,
          Boolean(isAgent),
        );
      }
    };

    try {
      const effectiveEffort = effort || selectedEffort || 'High';
      await streamChatCompletion({
        messages: historyPayload,
        model: model?.key || 'void-combo',
        effort: effectiveEffort,
        agentMode: Boolean(isAgent),
        connectedFolders,
        embeddingModel: settings.embeddingModel,
        moderationEnabled: settings.moderationEnabled,
        imageUrls: uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined,
        signal: controller.current.signal,
        onAgentSteps: (steps, taskTitle) => {
          ensureOrUpdateAiBubble({
            nextSteps: steps,
            nextTaskTitle: taskTitle,
          });
        },
        onPendingCommand: (pendingCmd) => {
          ensureOrUpdateAiBubble({
            nextPendingCmd: pendingCmd,
          });
        },
        onChatThought: (thoughtText, searchSource) => {
          setLiveChatThought(thoughtText);
          if (searchSource) {
            setLiveSearchSource(searchSource);
          }
        },
        onChunk: (_delta, fullText) => {
          setLiveChatThought(null);
          setLiveSearchSource(null);
          ensureOrUpdateAiBubble({
            nextText: fullText,
          });
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Connection error. Please try again.';
      appendOrUpdateSessionMessages(
        targetChatId,
        (prev) => [
          ...prev,
          {
            id: aiMsgId,
            role: 'assistant',
            text: errMsg,
            agentMode: Boolean(isAgent),
            createdAt: Date.now(),
          },
        ],
        effectiveText,
        Boolean(isAgent),
      );
    } finally {
      setBusy(false);
      setStreamingId(null);
      setLiveChatThought(null);
      setLiveSearchSource(null);
    }
  };

  const isEmptyNewChat = activeSection === 'chat' && !isSessionLocked;
  const isAgentWorkingOrStarted = effectiveAgentMode && !isEmptyNewChat;
  const isAgentIdleHero = effectiveAgentMode && isEmptyNewChat;
  const sidebarThemeMode = isAgentWorkingOrStarted
    ? 'agent-working'
    : isAgentIdleHero
      ? 'agent-idle'
      : 'chat';

  return (
    <div
      className={`relative flex h-screen w-full overflow-hidden text-[#f5f5f5] transition-colors duration-500 ${
        isAgentWorkingOrStarted
          ? 'bg-[#000000]'
          : isAgentIdleHero
            ? 'bg-[#151619]'
            : 'bg-[#080a10]'
      }`}
    >
      {/* Dedicated Full-Screen Background Layer Behind Both Sidebar & Main Viewport (so Sidebar is true glass on top of it!) */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-0 transition-opacity duration-500 ease-in-out ${
          effectiveAgentMode ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          background:
            'radial-gradient(circle at 12% 24%, rgba(44, 78, 195, 0.22) 0%, rgba(22, 40, 112, 0.1) 34%, rgba(8, 10, 16, 0) 68%), radial-gradient(circle at 58% 54%, rgba(36, 68, 178, 0.27) 0%, rgba(22, 38, 110, 0.14) 38%, rgba(8, 10, 16, 0) 72%)',
        }}
      />

      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-0 transition-opacity duration-500 ease-in-out ${
          isAgentIdleHero ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background:
            'radial-gradient(circle at 12% 24%, rgba(165, 168, 178, 0.15) 0%, rgba(95, 97, 106, 0.07) 34%, rgba(21, 22, 25, 0) 68%), radial-gradient(circle at 58% 52%, rgba(160, 162, 172, 0.16) 0%, rgba(95, 97, 106, 0.08) 40%, rgba(21, 22, 25, 0) 72%)',
        }}
      />

      {/* Sleek 216px Tinted Glass Sidebar placed ON TOP of the background layer */}
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        activeChatId={activeChatId}
        activeSection={activeSection}
        themeMode={sidebarThemeMode}
        isAuthenticatedAccount={isAuthenticatedAccount}
        accountName={accountDisplayName}
        accountAvatarUrl={accountAvatarUrl}
        onToggle={() => setSidebarOpen((v) => !v)}
        onNewChat={handleNewChat}
        onSelectSection={(sec) => setActiveSection(sec)}
        onSelectChat={handleSelectChat}
        onTogglePin={handleTogglePin}
        onDeleteChat={handleDeleteChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAuth={() => setAuthOpen(true)}
      />

      {/* Main Viewport */}
      <main className="relative z-10 flex h-full flex-1 flex-col overflow-hidden bg-transparent">
        {/* Top Bar */}
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-4">
          <div className="flex w-28 items-center gap-1.5">
            {!sidebarOpen ? (
              <>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  title="Toggle sidebar"
                  aria-label="Toggle sidebar"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#b4b4be] transition-colors hover:bg-white/[0.07] hover:text-white"
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
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={handleNewChat}
                  title="New chat"
                  aria-label="New chat"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#b4b4be] transition-colors hover:bg-white/[0.07] hover:text-white"
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
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>

          <div className="flex items-center justify-center">
            {isEmptyNewChat ? (
              <TopModeCapsule
                agentMode={effectiveAgentMode}
                onSelectMode={(next) => {
                  setAgentMode(next);
                  setNewChatAnimKey((k) => k + 1);
                }}
              />
            ) : null}
          </div>

          <div className="flex w-28 items-center justify-end gap-2">
            {!sidebarOpen ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="Settings"
                aria-label="Settings"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#b4b4be] transition-colors hover:bg-white/[0.07] hover:text-white"
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
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            ) : null}
          </div>
        </header>

        {historyWarning ? (
          <div
            className="relative z-10 mx-auto mt-2 w-[calc(100%-2rem)] max-w-[720px] rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-100/80"
            role="status"
          >
            {historyWarning}
          </div>
        ) : null}

        {/* Library / Images / Video Views */}
        {activeSection !== 'chat' ? (
          <div className="relative z-10 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-[820px]">
              <div className="flex items-center justify-between pb-5">
                <div>
                  <h1 className="text-xl font-semibold text-white capitalize">
                    {activeSection}
                  </h1>
                  <p className="mt-1 text-xs text-[#8e8e95]">
                    {activeSection === 'library'
                      ? 'Your saved conversations and media library'
                      : activeSection === 'images'
                        ? 'Uploaded and AI-generated images'
                        : 'AI video workspace and media clips'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="rounded-full bg-[#2b2b30] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#383840]"
                >
                  Back to chat
                </button>
              </div>

              {activeSection === 'library' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {sessions.filter((s) => s.messages.length > 0).length > 0 ? (
                    sessions
                      .filter((s) => s.messages.length > 0)
                      .map((sess) => (
                        <button
                          key={sess.id}
                          type="button"
                          onClick={() => handleSelectChat(sess.id)}
                          className="flex flex-col justify-between rounded-2xl border border-white/[0.07] bg-[#141418]/90 p-4 text-left transition-colors hover:border-white/[0.15] hover:bg-[#1a1a20]"
                        >
                          <div>
                            <div className="truncate text-sm font-medium text-white">
                              {sess.title || 'New Chat'}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-[#8e8e95]">
                              {sess.messages[sess.messages.length - 1]?.text ||
                                'Media attachment'}
                            </p>
                          </div>
                          <div className="mt-3 text-[11px] text-[#6f6f76]">
                            {sess.messages.length} messages
                          </div>
                        </button>
                      ))
                  ) : (
                    <div className="col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-[#8e8e95]">
                      No saved items in your library yet.
                    </div>
                  )}
                </div>
              ) : activeSection === 'images' ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {galleryImages.length > 0 ? (
                    galleryImages.map((img) => (
                      <a
                        key={img.id}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141418]"
                      >
                        <img
                          src={img.url}
                          alt={img.title}
                          className="h-44 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                        <div className="truncate px-3 py-2 text-xs text-[#a1a1aa]">
                          {img.title}
                        </div>
                      </a>
                    ))
                  ) : (
                    <div className="col-span-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-[#8e8e95]">
                      No uploaded or generated images yet. Try asking to create
                      an image in Chat!
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-[#8e8e95]">
                  Video studio ready. Start a chat or Agent task to plan or
                  script video workflows.
                </div>
              )}
            </div>
          </div>
        ) : isEmptyNewChat ? (
          /* Centered Gemini-style New Chat / Agent Mode Hero Viewport with Smooth Blooming Animation */
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-12">
            <div
              key={newChatAnimKey}
              className="flex w-full max-w-[680px] flex-col items-center"
            >
              <h1 className="hero-greeting-title animate-new-chat-title mb-6 text-center text-[27px] sm:text-[30px]">
                {effectiveAgentMode
                  ? 'Let’s cross something off your list'
                  : userFirstName
                    ? `Hi ${userFirstName}, what’s on your mind?`
                    : 'Hi, what’s on your mind?'}
              </h1>

              <div className="animate-new-chat-bar w-full">
                <PromptBar
                  placeholder="Ask anything"
                  defaultModel="void-combo"
                  efforts={['Low', 'Medium', 'High', 'Extra', 'Max']}
                  defaultEffort={selectedEffort}
                  onEffortChange={(nextEffort: string) =>
                    setSelectedEffort(nextEffort)
                  }
                  agentMode={effectiveAgentMode}
                  connectedFolders={connectedFolders}
                  onConnectFolder={handleConnectFolder}
                  onDisconnectFolder={handleDisconnectFolder}
                  busy={busy}
                  onSend={send}
                  onDraftChange={handleDraftChange}
                  onStop={handleStopGeneration}
                  onAttach={() => pickFiles()}
                  onDictate={() => ''}
                  background={effectiveAgentMode ? '#1e1f24' : '#0c0e14'}
                  color="#f5f5f5"
                  menuBackground={effectiveAgentMode ? '#27282e' : '#1c1e26'}
                  sparkColor="#d4d4d8"
                  sparkBoost={1}
                  width={680}
                  radius={22}
                  maxRows={5}
                  morphDuration={240}
                  squash={0.12}
                  tilt={8}
                  pressScale={0.96}
                  sttModel={settings.sttModel}
                />
              </div>

              <div className="animate-new-chat-suggestions mt-7 flex min-h-[124px] w-full max-w-[640px] flex-col items-start gap-1.5 pl-2">
                {!effectiveAgentMode
                  ? CHAT_SUGGESTIONS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          void send(item.prompt, {
                            attachments: [],
                            model: {
                              key: 'void-combo',
                              name: 'VOID',
                              shortName: 'VOID',
                            },
                            effort: selectedEffort,
                            agentMode: false,
                          })
                        }
                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] text-[#d4d4d8] transition-colors hover:bg-white/[0.05] hover:text-white"
                      >
                        <SuggestionIcon kind={item.icon} />
                        <span>{item.label}</span>
                      </button>
                    ))
                  : null}
              </div>
            </div>
          </div>
        ) : (
          /* Active Conversation Thread with Exact 720px Left-Edge Alignment Matching PromptBar */
          <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-6 pt-6 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div
                className={`mx-auto flex w-full max-w-[720px] flex-col ${
                  settings.compactMode ? 'gap-4' : 'gap-6'
                }`}
              >
                {messages.map((msg, idx) => {
                  const isLatestUserMsg = idx === lastUserMessageIndex;
                  const isInLatestTurn =
                    lastUserMessageIndex >= 0 && idx >= lastUserMessageIndex;

                  if (msg.role === 'user') {
                    return (
                      <div
                        key={msg.id}
                        ref={isLatestUserMsg ? latestUserMsgRef : undefined}
                        className="scroll-mt-6 flex flex-col items-end gap-2 pt-1"
                      >
                        {msg.attachments && msg.attachments.length > 0 ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            {msg.attachments.map((item, i) => {
                              const isObj = item && typeof item === 'object';
                              const name = isObj ? item.name : String(item);
                              const dataUrl = isObj ? item.dataUrl : undefined;
                              if (dataUrl && dataUrl.startsWith('data:image/')) {
                                return (
                                  <div
                                    key={`${name}-${i}`}
                                    className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#18181b] shadow-md"
                                  >
                                    <img
                                      src={dataUrl}
                                      alt={name}
                                      className="max-h-56 max-w-[260px] object-cover"
                                    />
                                  </div>
                                );
                              }
                              return (
                                <span
                                  key={`${name}-${i}`}
                                  className="rounded-lg bg-[#27272a] px-2.5 py-1 text-xs text-[#a1a1aa]"
                                >
                                  {name}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        {msg.text ? (
                          <UserMessageBubble
                            text={msg.text}
                            agentMode={msg.agentMode}
                          />
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={
                        isInLatestTurn && idx === messages.length - 1
                          ? 'min-h-[calc(100vh-280px)] pb-6'
                          : ''
                      }
                    >
                      <AiMessage
                        text={msg.text}
                        isStreaming={streamingId === msg.id}
                        ttsVoice={settings.ttsVoice}
                        ttsModel={settings.ttsModel}
                        ttsSpeed={settings.ttsSpeed}
                        autoRead={false}
                        shouldAutoRead={Boolean(msg.shouldAutoRead)}
                        agentSteps={msg.agentSteps}
                        agentTaskTitle={msg.agentTaskTitle}
                        pendingCommand={msg.pendingCommand}
                        onTerminalDecision={(action, finalCommand) => {
                          if (activeChatId) {
                            void handleTerminalDecision(
                              activeChatId,
                              msg.id,
                              action,
                              finalCommand,
                            );
                          }
                        }}
                      />
                    </div>
                  );
                })}

                {busy && !streamingId ? (
                  <div className="min-h-[calc(100vh-280px)] flex items-start justify-start py-1 text-[#e4e4e7]">
                    {effectiveAgentMode ? (
                      <LatticeLoader
                        status="working"
                        label="Thinking it through"
                        doneLabel="Done in"
                        errorLabel="Failed after"
                        pattern="orbit"
                        grid={3}
                        shape="round"
                        doneColor="#ffffff"
                        errorColor="#ef4444"
                        cellSize={6}
                        gap={2}
                        fontSize={14}
                        step={90}
                        idleOpacity={0.15}
                        glow={false}
                        glowColor=""
                        showTimer
                        elapsed={undefined}
                        style={undefined}
                      />
                    ) : (
                      <ChatThinkingWave
                        userPrompt={
                          lastUserMessageIndex >= 0
                            ? messages[lastUserMessageIndex]?.text ?? ''
                            : ''
                        }
                        liveThought={liveChatThought}
                        searchSource={liveSearchSource}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Bottom PromptBar aligned in the exact same px-6 + max-w-[720px] column as the messages above */}
            <div
              className={`shrink-0 px-6 pt-2 pb-6 transition-colors duration-500 ${
                effectiveAgentMode ? 'bg-[#000000]' : 'bg-transparent'
              }`}
            >
              <div className="mx-auto w-full max-w-[720px]">
                <PromptBar
                  placeholder="Ask anything"
                  defaultModel="void-combo"
                  efforts={['Low', 'Medium', 'High', 'Extra', 'Max']}
                  defaultEffort={selectedEffort}
                  onEffortChange={(nextEffort: string) =>
                    setSelectedEffort(nextEffort)
                  }
                  agentMode={effectiveAgentMode}
                  connectedFolders={connectedFolders}
                  onConnectFolder={handleConnectFolder}
                  onDisconnectFolder={handleDisconnectFolder}
                  busy={busy}
                  onSend={send}
                  onDraftChange={handleDraftChange}
                  onStop={handleStopGeneration}
                  onAttach={() => pickFiles()}
                  onDictate={() => ''}
                  background={effectiveAgentMode ? '#111114' : '#0c0e14'}
                  color="#f5f5f5"
                  menuBackground={effectiveAgentMode ? '#1c1c21' : '#1c1e26'}
                  sparkColor="#e4e4e7"
                  sparkBoost={1}
                  width={720}
                  radius={22}
                  maxRows={5}
                  morphDuration={240}
                  squash={0.12}
                  tilt={8}
                  pressScale={0.96}
                  sttModel={settings.sttModel}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal with Log out option under Clear all chats */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        canLogOut={hasAnyActiveSession}
        accountLabel={
          isAuthenticatedAccount
            ? accountDisplayName
            : guestProfile
              ? `Guest (${guestProfile.name})`
              : undefined
        }
        onUpdateSettings={setSettings}
        onClearAllChats={handleClearAllChats}
        onLogOut={() => void handleFullLogOut()}
        onClose={() => setSettingsOpen(false)}
      />
      <AuthModal
        open={authOpen}
        user={authUser}
        guestProfile={guestProfile}
        onUpdateGuestProfile={(profile) => setGuestProfile(profile)}
        onClose={() => setAuthOpen(false)}
        onSignOut={handleFullLogOut}
      />
    </div>
  );
}
