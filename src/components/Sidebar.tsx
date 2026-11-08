import { useEffect, useMemo, useRef, useState } from 'react';
import { type ChatSession } from '../lib/chat-storage';

export type SidebarSection = 'chat' | 'library' | 'images' | 'video';
export type SidebarThemeMode = 'chat' | 'agent-idle' | 'agent-working';

interface SidebarProps {
  open: boolean;
  sessions: ChatSession[];
  activeChatId: string | null;
  activeSection?: SidebarSection;
  themeMode?: SidebarThemeMode;
  isAuthenticatedAccount?: boolean;
  accountName: string;
  accountAvatarUrl?: string;
  isFullscreen?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onToggle: () => void;
  onNewChat: () => void;
  onSelectSection?: (section: SidebarSection) => void;
  onSelectChat: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onOpenSettings: () => void;
  onOpenAuth: () => void;
}

export default function Sidebar({
  open,
  sessions,
  activeChatId,
  activeSection = 'chat',
  themeMode = 'chat',
  isAuthenticatedAccount = false,
  accountName,
  accountAvatarUrl,
  isFullscreen = false,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onToggle,
  onNewChat,
  onSelectSection,
  onSelectChat,
  onTogglePin,
  onDeleteChat,
  onOpenSettings,
  onOpenAuth,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyPinnedFilter, setOnlyPinnedFilter] = useState(false);
  const [openMenuChatId, setOpenMenuChatId] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [accountAvatarUrl]);

  useEffect(() => {
    if (!openMenuChatId) return undefined;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setOpenMenuChatId(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMenuChatId]);

  const allValidSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions
      .filter((s) => s.messages.length > 0)
      .filter((s) => (onlyPinnedFilter ? s.pinned : true))
      .filter((s) =>
        q ? (s.title || 'New Chat').toLowerCase().includes(q) : true,
      );
  }, [sessions, searchQuery, onlyPinnedFilter]);

  const pinnedSessions = useMemo(
    () =>
      allValidSessions
        .filter((s) => s.pinned)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [allValidSessions],
  );

  const recentSessions = useMemo(
    () =>
      allValidSessions
        .filter((s) => !s.pinned)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [allValidSessions],
  );

  const resolvedName = useMemo(() => {
    const trimmed = (accountName || '').trim();
    return trimmed || 'Account';
  }, [accountName]);

  // True floating glass layer placed ON TOP OF the unified background canvas!
  const sidebarGlassSurface =
    themeMode === 'agent-working'
      ? 'bg-black/45 border-white/[0.06]'
      : themeMode === 'agent-idle'
        ? 'bg-white/[0.03] border-white/[0.08]'
        : 'bg-white/[0.025] border-white/[0.075]';

  const activePillClass = 'bg-white/[0.09] text-white';

  const renderChatRow = (session: ChatSession) => {
    const isActive =
      activeSection === 'chat' && session.id === activeChatId;
    const isMenuOpen = openMenuChatId === session.id;

    return (
      <div
        key={session.id}
        ref={isMenuOpen ? menuContainerRef : undefined}
        className={`group relative flex items-center rounded-xl transition-colors ${
          isActive
            ? `${activePillClass} shadow-sm`
            : 'text-[#d4d4d8] hover:bg-white/[0.05] hover:text-white'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setOpenMenuChatId(null);
            onSelectSection?.('chat');
            onSelectChat(session.id);
          }}
          className="flex min-w-0 flex-1 items-center overflow-hidden py-1.5 pl-2.5 pr-7 text-left text-[12.5px] font-normal tracking-[-0.01em]"
        >
          <span className="truncate">{session.title || 'New Chat'}</span>
        </button>

        {session.pinned && !isMenuOpen ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 flex items-center text-[#9a9aa2] group-hover:opacity-0"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          </span>
        ) : null}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenuChatId((prev) =>
              prev === session.id ? null : session.id,
            );
          }}
          title="More options"
          aria-label="More options"
          aria-expanded={isMenuOpen}
          className={`absolute right-1 inline-flex h-6 w-6 items-center justify-center rounded-md transition-opacity ${
            isMenuOpen
              ? 'bg-white/[0.12] text-white opacity-100'
              : 'text-[#a1a1aa] opacity-0 hover:bg-white/[0.08] hover:text-white group-hover:opacity-100 focus:opacity-100'
          }`}
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>

        {isMenuOpen ? (
          <div
            role="menu"
            className="absolute top-[calc(100%+2px)] right-1 z-50 w-32 overflow-hidden rounded-xl border border-white/[0.1] bg-[#1c1d22]/95 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuChatId(null);
                onTogglePin(session.id);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-[#e4e4e7] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0 text-[#a1a1aa]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
              </svg>
              <span>{session.pinned ? 'Unpin' : 'Pin'}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuChatId(null);
                onDeleteChat(session.id);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Delete</span>
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const isNewChatSelected =
    activeSection === 'chat' && activeChatId === null;

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-20 bg-black/55 transition-opacity md:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      ) : null}

      {/* Sleek Compact Tinted Glass Sidebar (w-[216px]) floating over the background */}
      <aside
        aria-label="Sidebar navigation"
        className={`relative fixed inset-y-0 left-0 z-30 flex flex-col border-r text-[#e4e4e7] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl saturate-150 select-none transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:static ${sidebarGlassSurface} ${
          open
            ? 'w-[216px] translate-x-0 opacity-100'
            : 'w-0 -translate-x-full overflow-hidden border-r-0 opacity-0 md:w-0 md:translate-x-0'
        }`}
      >
        <div className="relative z-10 flex h-full w-[216px] flex-col">
          {/* Row 1: Native macOS Traffic Lights Space + Back & Forward Navigation Arrows (slides left in Fullscreen) */}
          <div
            className={`app-drag-region flex h-9 shrink-0 items-center gap-0.5 pt-1.5 transition-all duration-200 ${
              isFullscreen ? 'pl-2.5' : 'pl-[76px]'
            }`}
          >
            <button
              type="button"
              onClick={onGoBack}
              disabled={!canGoBack}
              title="Go back"
              aria-label="Go back"
              className={`app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                canGoBack
                  ? 'text-[#b4b4be] hover:bg-white/[0.08] hover:text-white'
                  : 'cursor-default text-[#63636b] opacity-45'
              }`}
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
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onGoForward}
              disabled={!canGoForward}
              title="Go forward"
              aria-label="Go forward"
              className={`app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                canGoForward
                  ? 'text-[#b4b4be] hover:bg-white/[0.08] hover:text-white'
                  : 'cursor-default text-[#63636b] opacity-45'
              }`}
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
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          {/* Row 2: ChatGPT-style "VOID" Header below traffic lights + Search & Toggle Sidebar on the right */}
          <div className="flex h-10 shrink-0 items-center justify-between px-3">
            <span
              className="pl-0.5 text-[15px] font-semibold tracking-[-0.015em] text-[#ececec]"
              style={{
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', sans-serif",
              }}
            >
              VOID
            </span>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setSearchOpen((v) => !v);
                  if (searchOpen) setSearchQuery('');
                }}
                title="Search chats"
                aria-label="Search chats"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  searchOpen
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#b4b4be] hover:bg-white/[0.07] hover:text-white'
                }`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.2" y2="16.2" />
                </svg>
              </button>

              <button
                type="button"
                onClick={onToggle}
                title="Toggle sidebar"
                aria-label="Toggle sidebar"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#b4b4be] transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>
            </div>
          </div>

          {searchOpen ? (
            <div className="px-2.5 pb-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats…"
                className="h-7 w-full rounded-lg border border-white/[0.1] bg-black/30 px-2.5 text-[12px] text-white placeholder:text-[#7c7c86] focus:border-white/[0.22] focus:outline-none"
                autoFocus
              />
            </div>
          ) : null}

          {/* Primary Navigation Items */}
          <div className="space-y-0.5 px-2 pt-0.5">
            <button
              type="button"
              onClick={() => {
                onSelectSection?.('chat');
                onNewChat();
              }}
              className={`flex w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-[13px] font-normal tracking-[-0.01em] transition-colors ${
                isNewChatSelected
                  ? `${activePillClass} shadow-sm`
                  : 'text-[#d4d4d8] hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <svg
                className="h-4 w-4 shrink-0 text-[#d4d4d8]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>New chat</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectSection?.('library')}
              className={`flex w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-[13px] font-normal tracking-[-0.01em] transition-colors ${
                activeSection === 'library'
                  ? `${activePillClass}`
                  : 'text-[#c8c8d0] hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <svg
                className="h-4 w-4 shrink-0 text-[#c8c8d0]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <circle cx="17.5" cy="17.5" r="3.5" />
              </svg>
              <span>Library</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectSection?.('images')}
              className={`flex w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-[13px] font-normal tracking-[-0.01em] transition-colors ${
                activeSection === 'images'
                  ? `${activePillClass}`
                  : 'text-[#c8c8d0] hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <svg
                className="h-4 w-4 shrink-0 text-[#c8c8d0]"
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
              <span>Images</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectSection?.('video')}
              className={`flex w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-[13px] font-normal tracking-[-0.01em] transition-colors ${
                activeSection === 'video'
                  ? `${activePillClass}`
                  : 'text-[#c8c8d0] hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <svg
                className="h-4 w-4 shrink-0 text-[#c8c8d0]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="5" width="14" height="14" rx="2.5" />
                <path d="m16 10 6-3v10l-6-3v-4Z" />
              </svg>
              <span>Video</span>
            </button>
          </div>

          {/* All Chats Header + Scrollable List */}
          <div className="mt-4 flex items-center justify-between px-3 pb-1">
            <span className="text-[11px] font-normal text-[#94949e]">All</span>
            <button
              type="button"
              onClick={() => setOnlyPinnedFilter((v) => !v)}
              title={onlyPinnedFilter ? 'Show all chats' : 'Filter pinned chats'}
              aria-label="Filter chats"
              className={`rounded-md p-1 transition-colors ${
                onlyPinnedFilter
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#94949e] hover:bg-white/[0.06] hover:text-[#d4d4d8]'
              }`}
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {pinnedSessions.map(renderChatRow)}
            {recentSessions.map(renderChatRow)}

            {pinnedSessions.length === 0 && recentSessions.length === 0 ? (
              <div className="px-2.5 py-5 text-[12px] text-[#7c7c86]">
                {onlyPinnedFilter
                  ? 'No pinned conversations.'
                  : 'No conversations yet.'}
              </div>
            ) : null}
          </div>

          {/* Bottom User Profile / Add an Account Footer */}
          <div className="flex items-center justify-between border-t border-white/[0.06] px-2 py-2">
            <button
              type="button"
              onClick={onOpenAuth}
              title={
                isAuthenticatedAccount ? resolvedName : 'Add an account'
              }
              className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              {isAuthenticatedAccount ? (
                <>
                  {accountAvatarUrl && !avatarLoadError ? (
                    <img
                      src={accountAvatarUrl}
                      alt={resolvedName}
                      onError={() => setAvatarLoadError(true)}
                      referrerPolicy="no-referrer"
                      className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/15"
                    />
                  ) : (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-[11.5px] font-medium text-white">
                      {resolvedName.charAt(0)}
                    </span>
                  )}
                  <span className="truncate text-[13px] font-normal tracking-[-0.01em] text-[#d4d4d8] transition-colors group-hover:text-white">
                    {resolvedName}
                  </span>
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4 shrink-0 text-[#c8c8d0] transition-colors group-hover:text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                  <span className="truncate text-[13px] font-normal tracking-[-0.01em] text-[#c8c8d0] transition-colors group-hover:text-white">
                    Add an account
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#a1a1aa] transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
