import { useEffect, useRef, useState } from 'react';
import PromptBar from './components/PromptBar';
import LatticeLoader from './components/LatticeLoader';
import AiMessage from './components/AiMessage';
import Sidebar from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import AuthModal from './components/AuthModal';
import type { User } from '@supabase/supabase-js';
import { signOutCurrentSession, subscribeToAuthState } from './lib/auth';
import { isSupabaseConfigured } from './lib/supabase';
import {
  streamChatCompletion,
  type StreamChatMessage,
} from './lib/chat-stream';
import {
  type ChatAttachment,
  type ChatAttachmentItem,
  type ChatMessage,
  type ChatSession,
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

const sessionFingerprint = (session: ChatSession) => JSON.stringify(session);

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

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    loadChatSessions(),
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    const initial = loadChatSessions();
    return initial.length > 0 ? initial[0].id : null;
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [historyReady, setHistoryReady] = useState(!isSupabaseConfigured());
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );

  const [selectedEffort, setSelectedEffort] = useState<string>('High');
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [lastCompletedAiId, setLastCompletedAiId] = useState<string | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);

  const handleStopGeneration = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setStreamingId(null);
  };
  const bottomRef = useRef<HTMLDivElement | null>(null);
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
          setActiveChatId(result.sessions[0]?.id ?? null);
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
        setActiveChatId(localSessions[0]?.id ?? null);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy, streamingId]);

  const handleNewChat = () => {
    if (busy) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
    setActiveChatId(null);
  };

  const handleSelectChat = (id: string) => {
    if (busy && id !== activeChatId) {
      controller.current?.abort();
      setBusy(false);
      setStreamingId(null);
    }
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
        setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
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

  const appendOrUpdateSessionMessages = (
    sessionId: string,
    updater: (prevMessages: ChatMessage[]) => ChatMessage[],
    fallbackFirstText = '',
  ) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === sessionId);
      if (!exists) {
        const initialMessages = updater([]);
        const newSession: ChatSession = {
          id: sessionId,
          title: deriveChatTitle(fallbackFirstText || 'Image analysis'),
          messages: initialMessages,
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
          updatedAt: Date.now(),
        };
      });
    });
  };

  const send = async (
    text: string,
    {
      attachments,
      model,
      effort,
    }: {
      attachments: ChatAttachmentItem[];
      model: { key: string; name?: string; shortName?: string };
      effort: string;
    },
  ) => {
    if (isSupabaseConfigured() && (!authUser || !historyReady)) {
      setAuthOpen(true);
      return;
    }

    const targetChatId = activeChatId ?? createClientId();
    if (!activeChatId) {
      setActiveChatId(targetChatId);
    }

    const uploadedImageUrls = extractAttachmentImageUrls(attachments);
    const effectiveText =
      text.trim() ||
      (uploadedImageUrls.length > 0 ? 'Analyze this image' : '');

    const userMsg: ChatMessage = {
      id: createClientId(),
      role: 'user',
      text: text.trim(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      createdAt: Date.now(),
    };

    const existingMessages = activeSession?.messages ?? [];

    // "4 Argon" is kept blank — nothing is configured inside it yet
    if (model?.key === '4-Argon' || model?.key === '4-argan') {
      appendOrUpdateSessionMessages(
        targetChatId,
        (prev) => [...prev, userMsg],
        effectiveText,
      );
      return;
    }

    // Store semantic memory vector in the dimension-partitioned store (`3072d` or `1536d`)
    if (effectiveText.length > 0) {
      void addSemanticMemory({
        text: effectiveText,
        preferredModel: settings.embeddingModel,
      }).catch(() => {});
    }

    const aiMsgId = createClientId();
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

    appendOrUpdateSessionMessages(
      targetChatId,
      (prev) => [...prev, userMsg],
      effectiveText,
    );
    setBusy(true);
    setStreamingId(null);
    setLastCompletedAiId(null);
    controller.current = new AbortController();

    let createdAiBubble = false;

    try {
      const effectiveEffort = effort || selectedEffort || 'High';
      await streamChatCompletion({
        messages: historyPayload,
        model: model?.key || 'void-combo',
        effort: effectiveEffort,
        embeddingModel: settings.embeddingModel,
        moderationEnabled: settings.moderationEnabled,
        imageUrls: uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined,
        signal: controller.current.signal,
        onChunk: (_delta, fullText) => {
          if (!createdAiBubble) {
            createdAiBubble = true;
            setStreamingId(aiMsgId);
            appendOrUpdateSessionMessages(targetChatId, (prev) => [
              ...prev,
              {
                id: aiMsgId,
                role: 'assistant',
                text: fullText,
                createdAt: Date.now(),
              },
            ]);
          } else {
            appendOrUpdateSessionMessages(targetChatId, (prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, text: fullText } : msg,
              ),
            );
          }
        },
      });
      if (createdAiBubble) {
        setLastCompletedAiId(aiMsgId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Connection error. Please try again.';
      appendOrUpdateSessionMessages(targetChatId, (prev) => [
        ...prev,
        { id: aiMsgId, role: 'assistant', text: errMsg, createdAt: Date.now() },
      ]);
    } finally {
      setBusy(false);
      setStreamingId(null);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#09090b] text-[#f5f5f5]">
      {/* Sleek Collapsible Sidebar */}
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        activeChatId={activeChatId}
        accountLabel={
          authUser?.is_anonymous
            ? 'Guest session'
            : authUser?.email ?? authUser?.phone ?? 'Sign in'
        }
        onToggle={() => setSidebarOpen((v) => !v)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onTogglePin={handleTogglePin}
        onDeleteChat={handleDeleteChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAuth={() => setAuthOpen(true)}
      />

      {/* Main Chat Viewport */}
      <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-[#09090b]">
        {/* Minimalist Top Bar (visible when sidebar is collapsed or on mobile) */}
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-1.5">
            {!sidebarOpen ? (
              <>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  title="Open sidebar"
                  aria-label="Open sidebar"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#a1a1aa] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
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
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#a1a1aa] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {!sidebarOpen ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="Settings"
                aria-label="Settings"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#a1a1aa] transition-colors hover:bg-white/[0.06] hover:text-white"
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
            className="mx-auto mt-2 w-[calc(100%-2rem)] max-w-[760px] rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-100/80"
            role="status"
          >
            {historyWarning}
          </div>
        ) : null}

        {/* Scrollable Conversation Area */}
        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-44">
          <div
            className={`mx-auto flex w-full max-w-[760px] flex-col ${
              settings.compactMode ? 'gap-4' : 'gap-6'
            }`}
          >
            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex flex-col items-end gap-2">
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
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#27272a] px-4 py-2.5 text-[15px] leading-relaxed text-[#f5f5f5] break-words">
                      {msg.text}
                    </div>
                  ) : null}
                </div>
              ) : (
                <AiMessage
                  key={msg.id}
                  text={msg.text}
                  isStreaming={streamingId === msg.id}
                  ttsVoice={settings.ttsVoice}
                  ttsModel={settings.ttsModel}
                  ttsSpeed={settings.ttsSpeed}
                  autoRead={settings.autoReadResponses}
                  shouldAutoRead={
                    settings.autoReadResponses && lastCompletedAiId === msg.id
                  }
                />
              ),
            )}

            {busy && !streamingId ? (
              <div className="flex items-center justify-start py-1 text-[#e4e4e7]">
                <LatticeLoader
                  status="working"
                  label="Thinking"
                  doneLabel="Done in"
                  errorLabel="Failed after"
                  pattern="orbit"
                  grid={3}
                  shape="round"
                  doneColor="#22c55e"
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
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Bottom Floating PromptBar centered within the active main area */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-[#09090b] via-[#09090b]/95 to-transparent px-6 pt-4 pb-8">
          <div className="pointer-events-auto w-full max-w-[760px]">
            <PromptBar
              placeholder="Ask anything"
              defaultModel="void-combo"
              efforts={['Low', 'Medium', 'High', 'Extra', 'Max']}
              defaultEffort={selectedEffort}
              onEffortChange={(nextEffort: string) =>
                setSelectedEffort(nextEffort)
              }
              busy={busy}
              onSend={send}
              onStop={handleStopGeneration}
              onAttach={() => pickFiles()}
              onDictate={() => ''}
              background="#27272a"
              color="#f5f5f5"
              menuBackground="#323236"
              sparkColor="#b39dff"
              sparkBoost={1}
              width={760}
              radius={16}
              maxRows={5}
              morphDuration={240}
              squash={0.12}
              tilt={8}
              pressScale={0.96}
              sttModel={settings.sttModel}
            />
          </div>
        </div>
      </main>

      {/* Settings Modal (Voice Settings, AI Models & General Preferences) */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onUpdateSettings={setSettings}
        onClearAllChats={handleClearAllChats}
        onClose={() => setSettingsOpen(false)}
      />
      <AuthModal
        open={authOpen}
        user={authUser}
        onClose={() => setAuthOpen(false)}
        onSignOut={signOutCurrentSession}
      />
    </div>
  );
}
