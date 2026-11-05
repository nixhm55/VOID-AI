import { type ChatSession } from '../lib/chat-storage';

interface SidebarProps {
  open: boolean;
  sessions: ChatSession[];
  activeChatId: string | null;
  accountLabel: string;
  onToggle: () => void;
  onNewChat: () => void;
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
  accountLabel,
  onToggle,
  onNewChat,
  onSelectChat,
  onTogglePin,
  onDeleteChat,
  onOpenSettings,
  onOpenAuth,
}: SidebarProps) {
  const pinnedSessions = sessions
    .filter((s) => s.pinned && s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const recentSessions = sessions
    .filter((s) => !s.pinned && s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const renderChatRow = (session: ChatSession) => {
    const isActive = session.id === activeChatId;

    return (
      <div
        key={session.id}
        className={`group relative flex items-center rounded-lg transition-colors ${
          isActive
            ? 'bg-white/[0.08] text-[#ededed]'
            : 'text-[#a1a1a6] hover:bg-white/[0.05] hover:text-[#ededed]'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectChat(session.id)}
          className="flex flex-1 items-center overflow-hidden py-2 pl-2.5 pr-14 text-left text-[13px]"
        >
          <span className="truncate">{session.title || 'New Chat'}</span>
        </button>

        <div
          className={`absolute right-1 flex items-center gap-0.5 transition-opacity ${
            session.pinned
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(session.id);
            }}
            title={session.pinned ? 'Unpin chat' : 'Pin chat to top'}
            aria-label={session.pinned ? 'Unpin chat' : 'Pin chat to top'}
            className={`rounded-md p-1.5 transition-colors hover:bg-white/[0.08] ${
              session.pinned ? 'text-[#ededed]' : 'text-[#8a8a8f] hover:text-white'
            }`}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill={session.pinned ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteChat(session.id);
            }}
            title="Delete chat"
            aria-label="Delete chat"
            className="rounded-md p-1.5 text-[#8a8a8f] opacity-0 transition-all hover:bg-white/[0.08] hover:text-white group-hover:opacity-100 focus:opacity-100"
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
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {open ? (
        <div
          className="fixed inset-0 z-20 bg-black/55 transition-opacity md:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      ) : null}

      <aside
        aria-label="Chat history sidebar"
        className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r border-white/[0.07] bg-[#0d0d0d] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:static ${
          open
            ? 'w-[268px] translate-x-0 opacity-100'
            : 'w-0 -translate-x-full overflow-hidden border-r-0 opacity-0 md:w-0 md:translate-x-0'
        }`}
      >
        <div className="flex h-full w-[268px] flex-col">
          {/* Brand row */}
          <div className="flex items-center justify-between px-3 pb-1 pt-3">
            <span className="px-1 text-[13px] font-semibold tracking-tight text-[#ededed]">
              VOID
            </span>
            <button
              type="button"
              onClick={onToggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8f] transition-colors hover:bg-white/[0.06] hover:text-white"
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
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>

          {/* New chat */}
          <div className="px-2 pt-2">
            <button
              type="button"
              onClick={onNewChat}
              className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-[13px] font-medium text-[#ededed] transition-colors hover:bg-white/[0.08]"
            >
              <svg
                className="h-4 w-4 text-[#c9c9cf]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New chat</span>
            </button>
          </div>

          {/* History */}
          <div className="mt-4 flex-1 space-y-4 overflow-y-auto px-2 pb-2">
            {pinnedSessions.length > 0 ? (
              <div className="space-y-0.5">
                <div className="px-2.5 pb-1 text-[11px] font-medium text-[#6f6f76]">
                  Pinned
                </div>
                {pinnedSessions.map(renderChatRow)}
              </div>
            ) : null}

            <div className="space-y-0.5">
              <div className="px-2.5 pb-1 text-[11px] font-medium text-[#6f6f76]">
                Chats
              </div>

              {recentSessions.map(renderChatRow)}

              {pinnedSessions.length === 0 && recentSessions.length === 0 ? (
                <div className="px-2.5 py-6 text-[12px] leading-relaxed text-[#6f6f76]">
                  No conversations yet.
                </div>
              ) : null}
            </div>
          </div>

          {/* Settings */}
          <div className="p-2">
            <button
              type="button"
              onClick={onOpenAuth}
              title="Sign in or manage your account"
              className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-[#a1a1a6] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <svg
                className="h-4 w-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              <span className="truncate">{accountLabel}</span>
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#a1a1a6] transition-colors hover:bg-white/[0.06] hover:text-white"
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
              <span>Settings</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
