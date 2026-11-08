import {
  type TerminalToolContinuation,
  hasNixUnlockKey,
  isModelIdentityQuery,
  normalizeVoidIdentity,
} from './omniroute-agent';
import { authenticatedFetch } from './api-fetch';
import type {
  AgentPlanStep,
  PendingTerminalCommand,
  VoidAiEmbeddingModel,
} from './tools/index';

export { normalizeVoidIdentity };
export type { TerminalToolContinuation };

export interface StreamChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  imageUrls?: string[];
}

export interface StreamChatOptions {
  messages: StreamChatMessage[];
  model?: string;
  effort?: string;
  agentMode?: boolean;
  connectedFolders?: string[];
  terminalToolResult?: TerminalToolContinuation;
  embeddingModel?: VoidAiEmbeddingModel;
  moderationEnabled?: boolean;
  imageUrls?: string[];
  signal?: AbortSignal;
  onChunk: (deltaText: string, fullText: string) => void;
  onAgentSteps?: (steps: AgentPlanStep[], taskTitle?: string) => void;
  onPendingCommand?: (pendingCommand: PendingTerminalCommand) => void;
  onChatThought?: (thoughtText: string, searchSource?: string) => void;
}

export async function streamChatCompletion({
  messages,
  model = 'void-combo',
  effort = 'High',
  agentMode = false,
  connectedFolders,
  terminalToolResult,
  embeddingModel = 'text-embedding-3-large',
  moderationEnabled = true,
  imageUrls,
  signal,
  onChunk,
  onAgentSteps,
  onPendingCommand,
  onChatThought,
}: StreamChatOptions): Promise<string> {
  const normalizedModel = model.trim().toLowerCase();

  // "4 Argon" is intentionally blank
  if (
    normalizedModel === '4-argon' ||
    normalizedModel === '4 argon' ||
    normalizedModel === 'argon' ||
    normalizedModel === '4-argan' ||
    normalizedModel === '4 argan' ||
    normalizedModel === 'argan'
  ) {
    return '';
  }

  const personaName: 'VOID' | 'MIRASH' =
    normalizedModel === 'mirash' ? 'MIRASH' : 'VOID';
  const lastUserMsg = [...messages]
    .reverse()
    .find((m) => m.role === 'user');
  const lastUserText = lastUserMsg?.content ?? '';
  const isIdentityReply = isModelIdentityQuery(lastUserText);
  const unlockedByNix = hasNixUnlockKey(lastUserText);

  const response = await authenticatedFetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      model: model || 'void-combo',
      effort: effort || 'High',
      agentMode,
      connectedFolders,
      terminalToolResult,
      embeddingModel,
      moderationEnabled,
      imageUrls,
    }),
    signal,
  });

  if (!response.ok) {
    let errMessage = `Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson?.error) {
        errMessage = errJson.details
          ? `${errJson.error} (${errJson.details})`
          : errJson.error;
      }
    } catch {
      const errText = await response.text().catch(() => '');
      if (errText) errMessage = errText;
    }
    throw new Error(errMessage);
  }

  if (!response.body) {
    throw new Error('ReadableStream not supported in this browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let rawFullText = '';
  let normalizedFullText = '';

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const emitDelta = (incomingDelta: string) => {
    if (!incomingDelta || signal?.aborted) return;
    rawFullText += incomingDelta;
    const nextNormalized = normalizeVoidIdentity(rawFullText, {
      isIdentityReply,
      personaName,
      unlockedByNix,
    });
    const delta = nextNormalized.slice(normalizedFullText.length);
    normalizedFullText = nextNormalized;
    onChunk(delta, normalizedFullText);
  };

  const handleParsedFrame = (parsed: Record<string, unknown>): boolean => {
    if (Array.isArray(parsed?.agentSteps)) {
      const taskTitle =
        typeof parsed.agentTaskTitle === 'string'
          ? parsed.agentTaskTitle
          : undefined;
      onAgentSteps?.(parsed.agentSteps as AgentPlanStep[], taskTitle);
      return true;
    }

    if (
      parsed?.pendingCommand &&
      typeof parsed.pendingCommand === 'object'
    ) {
      onPendingCommand?.(parsed.pendingCommand as PendingTerminalCommand);
      return true;
    }

    if (
      typeof parsed?.chatThought === 'string' &&
      parsed.chatThought.trim().length > 0
    ) {
      const searchSource =
        typeof parsed.searchSource === 'string'
          ? parsed.searchSource
          : undefined;
      onChatThought?.(parsed.chatThought.trim(), searchSource);
      return true;
    }

    return false;
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return;

    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;

      try {
        const parsed = JSON.parse(dataStr) as Record<string, unknown>;
        if (handleParsedFrame(parsed)) return;

        const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
        const firstChoice = choices[0] as Record<string, unknown> | undefined;
        const deltaObj = firstChoice?.delta as
          | Record<string, unknown>
          | undefined;
        const msgObj = firstChoice?.message as
          | Record<string, unknown>
          | undefined;

        const reasoningPiece: unknown =
          deltaObj?.reasoning_content ??
          deltaObj?.reasoning ??
          msgObj?.reasoning_content ??
          msgObj?.reasoning;
        if (
          typeof reasoningPiece === 'string' &&
          reasoningPiece.trim().length > 0
        ) {
          onChatThought?.(reasoningPiece.trim());
        }

        const delta: unknown =
          deltaObj?.content ?? msgObj?.content ?? parsed?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          emitDelta(delta);
        }
      } catch {
        emitDelta(dataStr);
      }
      return;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (handleParsedFrame(parsed)) return;

      const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
      const firstChoice = choices[0] as Record<string, unknown> | undefined;
      const deltaObj = firstChoice?.delta as
        | Record<string, unknown>
        | undefined;
      const msgObj = firstChoice?.message as
        | Record<string, unknown>
        | undefined;

      const content: unknown =
        msgObj?.content ?? deltaObj?.content ?? parsed?.content;
      if (typeof content === 'string' && content.length > 0) {
        emitDelta(content);
      }
    } catch {
      // Ignore partial non-JSON lines
    }
  };

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done || signal?.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (signal?.aborted) break;
        processLine(line);
      }
    }

    if (!signal?.aborted) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          processLine(line);
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
    }
  }

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return normalizedFullText;
}
