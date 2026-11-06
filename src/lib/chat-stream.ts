import {
  hasNixUnlockKey,
  isModelIdentityQuery,
  normalizeVoidIdentity,
} from './omniroute-agent';
import { authenticatedFetch } from './api-fetch';

export { normalizeVoidIdentity };

export interface StreamChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  messages: StreamChatMessage[];
  model?: string;
  effort?: string;
  moderationEnabled?: boolean;
  signal?: AbortSignal;
  onChunk: (deltaText: string, fullText: string) => void;
}

export async function streamChatCompletion({
  messages,
  model = 'void-combo',
  effort = 'High',
  moderationEnabled = true,
  signal,
  onChunk,
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
    .find((m) => m.role === 'user' && m.content);
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
      moderationEnabled,
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

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return;

    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;

      try {
        const parsed = JSON.parse(dataStr);
        const delta: string | undefined =
          parsed?.choices?.[0]?.delta?.content ??
          parsed?.choices?.[0]?.message?.content ??
          parsed?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          emitDelta(delta);
        }
      } catch {
        emitDelta(dataStr);
      }
      return;
    }

    try {
      const parsed = JSON.parse(line);
      const content: string | undefined =
        parsed?.choices?.[0]?.message?.content ??
        parsed?.choices?.[0]?.delta?.content ??
        parsed?.content;
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
