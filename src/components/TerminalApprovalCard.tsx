import { useEffect, useRef, useState } from 'react';
import type { PendingTerminalCommand } from '../lib/tools/index';

export interface TerminalApprovalCardProps {
  pendingCommand: PendingTerminalCommand;
  disabled?: boolean;
  onDecision: (
    action: 'allow' | 'deny' | 'skip',
    finalCommand: string,
  ) => void;
}

export default function TerminalApprovalCard({
  pendingCommand,
  disabled = false,
  onDecision,
}: TerminalApprovalCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [commandText, setCommandText] = useState(pendingCommand.command);
  const [showOutput, setShowOutput] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setCommandText(pendingCommand.command);
  }, [pendingCommand.command]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const isPending = pendingCommand.status === 'pending';
  const isRunning = pendingCommand.status === 'running';
  const isResolved =
    pendingCommand.status === 'completed' ||
    pendingCommand.status === 'failed' ||
    pendingCommand.status === 'denied' ||
    pendingCommand.status === 'skipped';

  const handleAllow = () => {
    if (disabled || !isPending) return;
    const trimmed = commandText.trim() || pendingCommand.command;
    setIsEditing(false);
    onDecision('allow', trimmed);
  };

  const handleDeny = () => {
    if (disabled || !isPending) return;
    setIsEditing(false);
    onDecision('deny', commandText.trim() || pendingCommand.command);
  };

  const handleSkip = () => {
    if (disabled || !isPending) return;
    setIsEditing(false);
    onDecision('skip', commandText.trim() || pendingCommand.command);
  };

  const handleToggleEdit = () => {
    if (disabled || !isPending) return;
    setIsEditing((prev) => !prev);
  };

  return (
    <div
      className="my-3.5 w-full max-w-[620px] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#121318]/95 shadow-[0_14px_40px_rgba(0,0,0,0.65)] backdrop-blur-md transition-all duration-300"
      role="region"
      aria-label="Terminal command verification"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.08] text-white">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </span>
          <span className="text-[12.5px] font-medium tracking-tight text-[#e4e4e7]">
            Terminal Command Request
          </span>
        </div>

        {/* Status Indicator Badge */}
        {isPending ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            Approval Required
          </span>
        ) : isRunning ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Running…
          </span>
        ) : pendingCommand.status === 'completed' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white">
            <svg
              className="h-3 w-3 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Allowed & Executed
          </span>
        ) : pendingCommand.status === 'failed' ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-300">
            Command Exited ({pendingCommand.exitCode ?? 1})
          </span>
        ) : pendingCommand.status === 'denied' ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-300">
            Denied
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-[#a1a1aa]">
            Skipped
          </span>
        )}
      </div>

      {/* Main Card Body */}
      <div className="px-4 pt-3.5 pb-3">
        {pendingCommand.explanation ? (
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-[#a1a1aa]">
            {pendingCommand.explanation}
          </p>
        ) : null}

        {/* Monospace Command Display / Inline Editor */}
        <div
          className={`relative rounded-xl border transition-colors ${
            isEditing
              ? 'border-white/40 bg-[#08090d] ring-2 ring-white/10'
              : 'border-white/[0.08] bg-[#08090d]'
          } px-3.5 py-3`}
        >
          <div className="flex items-start gap-2.5">
            <span
              className="select-none font-mono text-[13.5px] font-semibold text-white/70"
              aria-hidden="true"
            >
              $
            </span>
            {isEditing ? (
              <textarea
                ref={inputRef}
                rows={Math.max(1, Math.min(4, commandText.split('\n').length))}
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setIsEditing(false);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setCommandText(pendingCommand.command);
                    setIsEditing(false);
                  }
                }}
                aria-label="Edit terminal command"
                className="w-full resize-none bg-transparent font-mono text-[13.5px] leading-relaxed text-[#f4f4f6] outline-none"
              />
            ) : (
              <pre className="m-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[13.5px] leading-relaxed text-[#f4f4f6]">
                <code>{commandText}</code>
              </pre>
            )}
          </div>
        </div>

        {/* Action Layout: Left Side (Subtle Edit & Skip) | Right Side (Prominent Allow & Deny) */}
        {isPending ? (
          <div className="mt-3.5 flex items-center justify-between gap-3">
            {/* Left Side (Subtle): Edit and Skip */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={handleToggleEdit}
                className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  isEditing
                    ? 'bg-white/[0.08] text-white'
                    : 'text-[#8e8ea0] hover:bg-white/[0.04] hover:text-[#d4d4d8]'
                } disabled:opacity-40`}
              >
                {isEditing ? 'Done editing' : 'Edit'}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={handleSkip}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[#8e8ea0] transition-colors hover:bg-white/[0.04] hover:text-[#d4d4d8] disabled:opacity-40"
              >
                Skip
              </button>
            </div>

            {/* Right Side (Prominent): Deny and Allow */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={handleDeny}
                className="inline-flex items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-1.5 text-[12.5px] font-semibold text-rose-200 shadow-sm transition-all hover:border-rose-500/50 hover:bg-rose-500/20 hover:text-white active:scale-[0.98] disabled:opacity-40"
              >
                Deny
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={handleAllow}
                className="inline-flex items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-500/90 px-4 py-1.5 text-[12.5px] font-semibold text-[#06120c] shadow-[0_4px_14px_rgba(16,185,129,0.28)] transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-40"
              >
                Allow
              </button>
            </div>
          </div>
        ) : null}

        {/* Captured Output Preview when command was Allowed & Executed */}
        {isResolved &&
        (pendingCommand.status === 'completed' ||
          pendingCommand.status === 'failed') &&
        pendingCommand.output ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-[#07080c]">
            <button
              type="button"
              onClick={() => setShowOutput((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] font-medium text-[#8e8ea0] transition-colors hover:bg-white/[0.03] hover:text-white"
            >
              <span>Terminal Output</span>
              <span>{showOutput ? 'Hide' : 'Show'}</span>
            </button>
            {showOutput ? (
              <pre className="max-h-48 overflow-y-auto border-t border-white/[0.05] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[#d4d4d8]">
                <code>{pendingCommand.output}</code>
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Footer / Warning at the absolute bottom of the curved box */}
      <div className="border-t border-white/[0.06] bg-black/35 px-4 py-2 text-center">
        <p className="m-0 text-[11.5px] italic tracking-wide text-[#8e8ea0]">
          Look at the command and verify. AI can make mistakes.
        </p>
      </div>
    </div>
  );
}
