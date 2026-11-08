import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { splitTextIntoSpeechChunks } from '../lib/tools/text_to_speech';
import type {
  AgentPlanStep,
  PendingTerminalCommand,
} from '../lib/tools/index';
import { authenticatedFetch } from '../lib/api-fetch';
import TerminalApprovalCard from './TerminalApprovalCard';

interface AiMessageProps {
  text: string;
  isStreaming?: boolean;
  ttsVoice?: string;
  ttsModel?: string;
  ttsSpeed?: number;
  autoRead?: boolean;
  shouldAutoRead?: boolean;
  agentSteps?: AgentPlanStep[];
  agentTaskTitle?: string;
  pendingCommand?: PendingTerminalCommand;
  onTerminalDecision?: (
    action: 'allow' | 'deny' | 'skip',
    finalCommand: string,
  ) => void;
}

interface CodeBlockProps {
  language: string;
  code: string;
}

let activeStopSpeechCallback: (() => void) | null = null;

/**
 * Gemini-style clean, borderless step-by-step Agent Execution Timeline.
 * - All completion checkmarks (ticks) are crisp white (`text-white`) as requested.
 * - Dynamic task action title + "Completed X steps" + minimize/expand chevron.
 */
function AgentExecutionTimeline({
  steps,
  taskTitle,
  isStreaming,
  isWaitingApproval,
}: {
  steps: AgentPlanStep[];
  taskTitle?: string;
  isStreaming: boolean;
  isWaitingApproval: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const allCompleted =
    steps.length > 0 &&
    completedCount === steps.length &&
    !isStreaming &&
    !isWaitingApproval;

  const resolvedTitle =
    !allCompleted
      ? 'Thinking it through'
      : taskTitle || steps[0]?.taskTitle || 'Thinking it through';

  const completedLabel =
    completedCount > 0
      ? `Completed ${completedCount} ${completedCount === 1 ? 'step' : 'steps'}`
      : 'Thinking…';

  return (
    <div className="mb-3.5 w-full max-w-[640px] select-none">
      {/* Clean Gemini-style inline collapsible header — No checkmark on top header, only on inner steps! */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="group/header inline-flex max-w-full items-center gap-2 rounded-full py-1.5 pr-3 pl-1 text-left transition-colors hover:bg-white/[0.04]"
      >
        {/* Status Indicator Icon (Only shown while actively running or waiting approval; no tick when finished) */}
        {allCompleted ? null : isWaitingApproval ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          </span>
        ) : (
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <span className="absolute h-3.5 w-3.5 animate-spin rounded-full border-[1.7px] border-white/80 border-t-transparent" />
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
        )}

        {/* Dynamic Task Action Title ("Thinking it through" / clean action summary) */}
        <span
          className={`truncate text-[13.5px] font-medium tracking-[-0.01em] ${
            allCompleted
              ? 'text-[#e4e4e7]'
              : 'agent-shimmer-text text-white'
          }`}
        >
          {resolvedTitle}
        </span>

        {/* Completed X steps counter */}
        <span className="shrink-0 text-[12.5px] text-[#8e8ea0]">
          {completedLabel}
        </span>

        {/* Small minimize / expand chevron button */}
        <span className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#8e8ea0] transition-colors group-hover/header:bg-white/[0.06] group-hover/header:text-white">
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
              expanded ? 'rotate-180' : ''
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {/* Unboxed Step-by-Step Vertical Timeline ("padi padi aayi Gemini ne pole") */}
      <div
        className={`grid transition-all duration-250 ease-out ${
          expanded
            ? 'mt-1.5 grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="relative ml-3.5 space-y-2.5 border-l border-white/[0.12] pl-4 pt-1 pb-1">
            {steps.map((step, index) => {
              const isDone = step.status === 'completed';
              const isRunning = step.status === 'running';
              const isWaiting = step.status === 'waiting_approval';
              const isFailed = step.status === 'failed';

              return (
                <div
                  key={step.id}
                  style={{ animationDelay: `${index * 45}ms` }}
                  className="agent-step-item relative flex items-start gap-2.5 text-[13px]"
                >
                  {/* Step Timeline Node (White Checkmark for completed steps) */}
                  <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center">
                    {isDone ? (
                      <svg
                        className="h-3.5 w-3.5 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isWaiting ? (
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                    ) : isRunning ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-[1.8px] border-white border-t-transparent" />
                    ) : isFailed ? (
                      <span className="h-2 w-2 rounded-full bg-rose-400" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div
                      className={`leading-snug transition-colors ${
                        isDone
                          ? 'text-[#e4e4e7]'
                          : isRunning || isWaiting
                            ? 'font-medium text-white'
                            : 'text-[#7c7c88]'
                      }`}
                    >
                      {step.title}
                    </div>
                    {step.detail ? (
                      <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a96]">
                        {step.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="my-3.5 overflow-hidden rounded-xl border border-white/[0.08] bg-[#121215] shadow-lg">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#18181c] px-4 py-2 text-xs text-[#a1a1aa]">
        <span className="font-mono lowercase tracking-wide text-[#a1a1aa]">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[#a1a1aa] transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          {copied ? (
            <>
              <svg
                className="h-3.5 w-3.5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-white">Copied</span>
            </>
          ) : (
            <>
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13.5px] leading-relaxed text-[#e4e4e7]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function GeneratedImageCard({ alt, src }: { alt: string; src: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#141418] shadow-xl">
      <div className="relative min-h-[220px] w-full max-w-[520px] bg-[#18181c]">
        {!loaded ? (
          <div className="flex h-[280px] w-full items-center justify-center text-xs text-[#8a8a8f]">
            Rendering image…
          </div>
        ) : null}
        <img
          src={src}
          alt={alt || 'Generated image'}
          onLoad={() => setLoaded(true)}
          className={`max-h-[480px] w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#111114] px-3.5 py-2 text-xs text-[#a1a1aa]">
        <span className="truncate pr-2">{alt || 'Generated by VOID'}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          download="void-generated-image.png"
          className="shrink-0 rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#e4e4e7] transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          Open / Download
        </a>
      </div>
    </div>
  );
}

/**
 * Safely parses standalone image lines (`![alt](src)`) using fast string indexing
 * instead of regex so multi-megabyte base64 data URLs never cause browser freezes or crashes.
 */
function parseStandaloneImageLine(
  trimmedLine: string,
): { alt: string; src: string } | null {
  if (!trimmedLine.startsWith('![') || !trimmedLine.endsWith(')')) {
    return null;
  }
  const midIdx = trimmedLine.indexOf('](');
  if (midIdx < 2) return null;
  const alt = trimmedLine.slice(2, midIdx);
  const src = trimmedLine.slice(midIdx + 2, -1).trim();
  if (!src) return null;
  return { alt, src };
}

function renderInlineMarkdown(text: string): ReactNode[] {
  // Fast path if line contains a huge base64 image
  if (text.length > 4000 && text.includes('![') && text.includes('](')) {
    const startIdx = text.indexOf('![');
    const midIdx = text.indexOf('](', startIdx);
    const endIdx = midIdx > startIdx ? text.indexOf(')', midIdx + 2) : -1;
    if (startIdx >= 0 && midIdx > startIdx && endIdx > midIdx) {
      const before = text.slice(0, startIdx);
      const alt = text.slice(startIdx + 2, midIdx);
      const src = text.slice(midIdx + 2, endIdx);
      const after = text.slice(endIdx + 1);
      return [
        ...(before ? renderInlineMarkdown(before) : []),
        <GeneratedImageCard key="fast-inline-img" alt={alt} src={src} />,
        ...(after ? renderInlineMarkdown(after) : []),
      ];
    }
  }

  const tokens: ReactNode[] = [];
  const regex =
    /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    const raw = match[0];
    if (raw.startsWith('![')) {
      const parsedImg = parseStandaloneImageLine(raw);
      if (parsedImg) {
        tokens.push(
          <GeneratedImageCard
            key={`img-${key++}`}
            alt={parsedImg.alt}
            src={parsedImg.src}
          />,
        );
      } else {
        tokens.push(raw);
      }
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push(
        <code
          key={`inline-${key++}`}
          className="rounded-md border border-white/[0.08] bg-[#1c1c22] px-1.5 py-0.5 font-mono text-[13.5px] text-[#d8b4fe]"
        >
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push(
        <strong key={`bold-${key++}`} className="font-semibold text-white">
          {raw.slice(2, -2)}
        </strong>,
      );
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push(
        <em key={`italic-${key++}`} className="italic text-[#f4f4f5]">
          {raw.slice(1, -1)}
        </em>,
      );
    } else if (raw.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
      if (linkMatch) {
        tokens.push(
          <a
            key={`link-${key++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#b39dff] underline decoration-[#b39dff]/40 underline-offset-4 transition-colors hover:text-[#d0c2ff]"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        tokens.push(raw);
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

function renderTextBlocks(segment: string, blockKeyPrefix: string): ReactNode[] {
  const lines = segment.split('\n');
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Standalone markdown image line (crash-safe for huge base64 strings)
    const standaloneImg = parseStandaloneImageLine(trimmed);
    if (standaloneImg) {
      elements.push(
        <GeneratedImageCard
          key={`${blockKeyPrefix}-img-${i}`}
          alt={standaloneImg.alt}
          src={standaloneImg.src}
        />,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3
          key={`${blockKeyPrefix}-h3-${i}`}
          className="mt-5 mb-2 text-[16.5px] font-semibold tracking-tight text-white first:mt-0"
        >
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2
          key={`${blockKeyPrefix}-h2-${i}`}
          className="mt-6 mb-2.5 text-[18.5px] font-semibold tracking-tight text-white first:mt-0"
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1
          key={`${blockKeyPrefix}-h1-${i}`}
          className="mt-6 mb-3 text-[21px] font-semibold tracking-tight text-white first:mt-0"
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      elements.push(
        <blockquote
          key={`${blockKeyPrefix}-quote-${i}`}
          className="my-3 border-l-2 border-white/40 pl-4 italic text-[#d4d4d8]"
        >
          {renderInlineMarkdown(quoteLines.join(' '))}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      elements.push(
        <ul
          key={`${blockKeyPrefix}-ul-${i}`}
          className="my-2.5 list-disc space-y-1.5 pl-5 text-[#ececf1] marker:text-[#a1a1aa]"
        >
          {items.map((item, idx) => (
            <li key={idx} className="leading-[1.72] pl-1">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      elements.push(
        <ol
          key={`${blockKeyPrefix}-ol-${i}`}
          className="my-2.5 list-decimal space-y-1.5 pl-5 text-[#ececf1] marker:font-medium marker:text-[#a1a1aa]"
        >
          {items.map((item, idx) => (
            <li key={idx} className="leading-[1.72] pl-1">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('> ') &&
      !parseStandaloneImageLine(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }

    elements.push(
      <p
        key={`${blockKeyPrefix}-p-${i}`}
        className="my-3 leading-[1.75] text-[#ececf1] first:mt-0 last:mb-0"
      >
        {paraLines.map((pLine, idx) => (
          <span key={idx}>
            {idx > 0 ? <br /> : null}
            {renderInlineMarkdown(pLine)}
          </span>
        ))}
      </p>,
    );
  }

  return elements;
}

export default function AiMessage({
  text,
  isStreaming = false,
  ttsVoice = 'coral',
  ttsModel = 'gpt-4o-mini-tts',
  ttsSpeed = 1.0,
  autoRead = false,
  shouldAutoRead = false,
  agentSteps,
  agentTaskTitle,
  pendingCommand,
  onTerminalDecision,
}: AiMessageProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackIdRef = useRef(0);
  const objectUrlsRef = useRef<string[]>([]);
  const wasStreamingRef = useRef(isStreaming);
  const hasAutoReadRef = useRef(false);

  const stopSpeech = useCallback(() => {
    playbackIdRef.current += 1;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {
        // Ignore
      }
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    setSpeaking(false);
  }, []);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [stopSpeech]);

  const startSpeakingText = useCallback(
    async (rawTextToSpeak: string) => {
      if (activeStopSpeechCallback) {
        activeStopSpeechCallback();
      }
      activeStopSpeechCallback = stopSpeech;

      const chunks = splitTextIntoSpeechChunks(rawTextToSpeak);
      if (chunks.length === 0) return;

      const currentPlaybackId = ++playbackIdRef.current;
      setSpeaking(true);

      const fetchAudioSegment = async (chunk: {
        text: string;
        tl: string;
      }): Promise<{ url: string; provider: string } | null> => {
        try {
          const res = await authenticatedFetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: chunk.text,
              tl: chunk.tl,
              voice: ttsVoice,
              model: ttsModel,
              speed: ttsSpeed,
            }),
          });
          if (!res.ok) return null;
          const provider = res.headers.get('X-TTS-Provider') || 'voidai-tts';
          const blob = await res.blob();
          if (blob.size === 0) return null;
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          return { url, provider };
        } catch {
          return null;
        }
      };

      const speakWithBrowserFallback = (chunk: {
        text: string;
        bcp47: string;
      }): Promise<void> =>
        new Promise((resolve) => {
          if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
            resolve();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(chunk.text);
          utterance.lang = chunk.bcp47;
          utterance.rate = 1.08 * ttsSpeed;
          const voices = window.speechSynthesis.getVoices();
          const langPrefix = chunk.bcp47.split('-')[0].toLowerCase();
          const matchingVoice =
            voices.find(
              (v) =>
                v.lang.toLowerCase().startsWith(langPrefix) &&
                /google|natural|siri|ava|samantha|lekha|veena/i.test(v.name),
            ) || voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
          if (matchingVoice) {
            utterance.voice = matchingVoice;
          }
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });

      let nextSegmentPromise = fetchAudioSegment(chunks[0]);

      for (let i = 0; i < chunks.length; i += 1) {
        if (playbackIdRef.current !== currentPlaybackId) return;

        const currentSegmentPromise = nextSegmentPromise;
        nextSegmentPromise =
          i + 1 < chunks.length
            ? fetchAudioSegment(chunks[i + 1])
            : Promise.resolve(null);

        const segment = currentSegmentPromise ? await currentSegmentPromise : null;
        if (playbackIdRef.current !== currentPlaybackId) return;

        if (segment?.url) {
          const playedSuccessfully = await new Promise<boolean>((resolve) => {
            const audio = new Audio(segment.url);
            audio.preservesPitch = true;
            const baseRate =
              segment.provider === 'voidai-tts' ||
              segment.provider === 'elevenlabs-omniroute' ||
              segment.provider === 'deepgram-flux'
                ? 1.0
                : chunks[i].tl.startsWith('en')
                  ? 1.15
                  : 1.1;
            audio.playbackRate = baseRate * ttsSpeed;
            audioRef.current = audio;
            audio.onended = () => resolve(true);
            audio.onerror = () => resolve(false);
            audio.play().catch(() => resolve(false));
          });
          if (!playedSuccessfully && playbackIdRef.current === currentPlaybackId) {
            await speakWithBrowserFallback(chunks[i]);
          }
        } else {
          await speakWithBrowserFallback(chunks[i]);
        }
      }

      if (playbackIdRef.current === currentPlaybackId) {
        stopSpeech();
        if (activeStopSpeechCallback === stopSpeech) {
          activeStopSpeechCallback = null;
        }
      }
    },
    [stopSpeech, ttsModel, ttsSpeed, ttsVoice],
  );

  const toggleSpeak = async () => {
    if (speaking) {
      stopSpeech();
      if (activeStopSpeechCallback === stopSpeech) {
        activeStopSpeechCallback = null;
      }
      return;
    }
    await startSpeakingText(text);
  };

  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      return;
    }
    if (
      !isStreaming &&
      (shouldAutoRead || (wasStreamingRef.current && autoRead)) &&
      !hasAutoReadRef.current &&
      text.trim().length > 0
    ) {
      wasStreamingRef.current = false;
      hasAutoReadRef.current = true;
      void startSpeakingText(text);
    }
  }, [isStreaming, autoRead, shouldAutoRead, text, startSpeakingText]);

  // Split by fenced code blocks ```lang ... ```
  const blocks: ReactNode[] = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIdx = 0;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const prose = text.slice(lastIndex, match.index);
      blocks.push(...renderTextBlocks(prose, `prose-${partIdx++}`));
    }

    const lang = match[1] || 'code';
    const codeContent = match[2].replace(/\n$/, '');
    blocks.push(
      <CodeBlock key={`code-${partIdx++}`} language={lang} code={codeContent} />,
    );

    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    const openFenceIndex = remaining.indexOf('```');
    if (openFenceIndex !== -1) {
      const beforeFence = remaining.slice(0, openFenceIndex);
      if (beforeFence.trim()) {
        blocks.push(...renderTextBlocks(beforeFence, `prose-${partIdx++}`));
      }
      const afterFence = remaining.slice(openFenceIndex + 3);
      const firstNewline = afterFence.indexOf('\n');
      const lang =
        firstNewline !== -1 ? afterFence.slice(0, firstNewline).trim() : 'code';
      const codeContent =
        firstNewline !== -1 ? afterFence.slice(firstNewline + 1) : '';
      blocks.push(
        <CodeBlock
          key={`streaming-code-${partIdx++}`}
          language={lang}
          code={codeContent}
        />,
      );
    } else {
      blocks.push(...renderTextBlocks(remaining, `prose-${partIdx++}`));
    }
  }

  const copyFullResponse = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      // Ignore clipboard errors
    }
  };

  const isWaitingApproval =
    pendingCommand?.status === 'pending' ||
    pendingCommand?.status === 'running';

  return (
    <div className="ai-message group flex w-full flex-col items-start">
      {agentSteps && agentSteps.length > 0 ? (
        <AgentExecutionTimeline
          steps={agentSteps}
          taskTitle={agentTaskTitle}
          isStreaming={isStreaming}
          isWaitingApproval={Boolean(isWaitingApproval)}
        />
      ) : null}

      {pendingCommand ? (
        <TerminalApprovalCard
          pendingCommand={pendingCommand}
          disabled={isStreaming && pendingCommand.status !== 'pending'}
          onDecision={(action, finalCommand) => {
            onTerminalDecision?.(action, finalCommand);
          }}
        />
      ) : null}

      {text.trim().length > 0 || isStreaming ? (
        <div className="w-full max-w-[92%] text-[15.25px] tracking-[-0.011em] text-[#ececf1] antialiased">
          {blocks}
          {isStreaming ? (
            <span
              className="ml-1 inline-block h-[15px] w-[7px] translate-y-[2px] animate-pulse rounded-[2px] bg-white"
              aria-hidden="true"
            />
          ) : null}
        </div>
      ) : null}

      {!isStreaming && text.trim().length > 0 ? (
        <div className="mt-2 flex items-center gap-1 opacity-85 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            onClick={toggleSpeak}
            title={speaking ? 'Stop listening' : 'Listen to response'}
            aria-label={speaking ? 'Stop listening' : 'Listen to response'}
            aria-pressed={speaking}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
              speaking
                ? 'bg-white/15 text-white'
                : 'text-[#8e8ea0] hover:bg-white/[0.06] hover:text-[#e4e4e7]'
            }`}
          >
            {speaking ? (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path
                    d="M15.54 8.46a5 5 0 0 1 0 7.07"
                    className="animate-pulse"
                  />
                  <path
                    d="M19.07 4.93a10 10 0 0 1 0 14.14"
                    className="animate-pulse"
                  />
                </svg>
                <span className="font-medium">Stop</span>
              </>
            ) : (
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={copyFullResponse}
            title="Copy response"
            aria-label="Copy response"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#8e8ea0] transition-colors hover:bg-white/[0.06] hover:text-[#e4e4e7]"
          >
            {copiedAll ? (
              <>
                <svg
                  className="h-3.5 w-3.5 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-white">Copied</span>
              </>
            ) : (
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
