import {
  AI_MODELS,
  DEFAULT_COMBO_MODEL,
  DEFAULT_OMNI_BASE_URL,
  OPENROUTER_API_KEY,
  OPENROUTER_ENDPOINT,
} from './tools/config';
import {
  VOID_SYSTEM_PROMPT,
  buildLockedIdentityReply,
  buildSystemPrompt,
  hasNixUnlockKey,
  isModelIdentityQuery,
  normalizeVoidIdentity,
} from './tools/identity_guard';
import {
  type OmniSearchResponse,
  type OmniSearchResultItem,
  WEB_SEARCH_TOOL_DEFINITION,
  buildSearchQuery,
  executeOmniRouteSearch,
  extractInlineWebSearchQuery,
  formatSearchResultsForAgent,
  isRealtimeRefusalResponse,
  shouldTriggerWebSearch,
} from './tools/search_engine';

export {
  AI_MODELS,
  DEFAULT_COMBO_MODEL,
  DEFAULT_OMNI_BASE_URL,
  OPENROUTER_API_KEY,
  OPENROUTER_ENDPOINT,
  VOID_SYSTEM_PROMPT,
  buildLockedIdentityReply,
  buildSearchQuery,
  buildSystemPrompt,
  executeOmniRouteSearch,
  formatSearchResultsForAgent,
  hasNixUnlockKey,
  isModelIdentityQuery,
  isRealtimeRefusalResponse,
  normalizeVoidIdentity,
  shouldTriggerWebSearch,
};
export type { OmniSearchResponse, OmniSearchResultItem };

function normalizeReasoningEffort(effort?: string): string | undefined {
  const value = effort?.trim().toLowerCase();
  if (!value) return undefined;
  const uiEffortMap: Record<string, string> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    extra: 'xhigh',
    max: 'xhigh',
  };
  if (value in uiEffortMap) return uiEffortMap[value];
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)
    ? value
    : undefined;
}

export interface AgentToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * MIRASH OpenRouter Model Fallback Loop
 */
export async function callMirashOpenRouterStep(options: {
  openRouterApiKey?: string;
  effort?: string;
  omniEndpoint: string;
  omniApiKeys: string[];
  messages: Array<{ role: string; content: string }>;
  onTextDelta?: (delta: string) => void;
}): Promise<{
  ok: boolean;
  status: number;
  errorText: string;
  contentText: string;
  toolCalls: AgentToolCall[];
  usedModel?: string;
}> {
  const {
    openRouterApiKey = OPENROUTER_API_KEY,
    effort,
    omniEndpoint,
    omniApiKeys,
    messages,
    onTextDelta,
  } = options;

  let lastStatus = 502;
  let lastErrorText = '';

  const orderedCandidateModels = [...AI_MODELS, 'openrouter/free'];

  for (const model of orderedCandidateModels) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterApiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'MIRASH AI',
        },
        body: JSON.stringify({
          model,
          messages,
          ...(normalizeReasoningEffort(effort)
            ? { reasoning: { effort: normalizeReasoningEffort(effort) } }
            : {}),
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok || !res.body) {
        lastStatus = res.status;
        lastErrorText = await res.text().catch(() => res.statusText);
        continue;
      }

      const parsed = await consumeUpstreamStream(res.body, onTextDelta);
      if (parsed.contentText.trim().length > 0 || parsed.toolCalls.length > 0) {
        return {
          ok: true,
          status: 200,
          errorText: '',
          contentText: parsed.contentText,
          toolCalls: parsed.toolCalls,
          usedModel: parsed.detectedModel || model,
        };
      }

      lastErrorText = `Model ${model} returned an empty response.`;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErrorText =
        err instanceof Error ? err.message : `Model ${model} failed`;
    }
  }

  if (omniApiKeys.length > 0) {
    const omniFallback = await callOmniRouteChatStep({
      endpoint: omniEndpoint,
      apiKeys: omniApiKeys,
      model: DEFAULT_COMBO_MODEL,
      messages,
      effort,
      onTextDelta,
    });
    if (omniFallback.ok) {
      return {
        ...omniFallback,
        usedModel: omniFallback.usedModel || DEFAULT_COMBO_MODEL,
      };
    }
  }

  return {
    ok: false,
    status: lastStatus,
    errorText: lastErrorText,
    contentText: '',
    toolCalls: [],
  };
}

async function callOmniRouteChatStep(options: {
  endpoint: string;
  apiKeys: string[];
  model: string;
  messages: Array<{ role: string; content: string }>;
  enableTools?: boolean;
  effort?: string;
  onTextDelta?: (delta: string) => void;
}): Promise<{
  ok: boolean;
  status: number;
  errorText: string;
  contentText: string;
  toolCalls: AgentToolCall[];
  usedModel?: string;
}> {
  const {
    endpoint,
    apiKeys,
    model,
    messages,
    enableTools = false,
    effort,
    onTextDelta,
  } = options;

  let lastStatus = 502;
  let lastErrorText = '';

  for (const apiKey of apiKeys) {
    try {
      const payload: Record<string, unknown> = {
        model,
        messages,
        stream: true,
      };
      const normalizedEffort = normalizeReasoningEffort(effort);
      if (normalizedEffort) payload.reasoning_effort = normalizedEffort;
      if (enableTools) {
        payload.tools = [WEB_SEARCH_TOOL_DEFINITION];
        payload.tool_choice = 'auto';
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        lastStatus = res.status;
        lastErrorText = await res.text().catch(() => res.statusText);
        continue;
      }

      const parsed = await consumeUpstreamStream(res.body, onTextDelta);
      if (parsed.contentText.trim().length > 0 || parsed.toolCalls.length > 0) {
        return {
          ok: true,
          status: 200,
          errorText: '',
          contentText: parsed.contentText,
          toolCalls: parsed.toolCalls,
          usedModel: parsed.detectedModel || model,
        };
      }
      lastErrorText = 'Upstream model returned an empty completion.';
    } catch (err) {
      lastErrorText =
        err instanceof Error ? err.message : 'Upstream connection failed';
    }
  }

  return {
    ok: false,
    status: lastStatus,
    errorText: lastErrorText,
    contentText: '',
    toolCalls: [],
  };
}

async function consumeUpstreamStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta?: (delta: string) => void,
): Promise<{
  contentText: string;
  toolCalls: AgentToolCall[];
  detectedModel?: string;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let contentText = '';
  let detectedModel: string | undefined;
  let streamErrorDetected = false;
  const toolCallsByIndex = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  const handleParsedObject = (parsed: Record<string, unknown>) => {
    if (parsed.error) {
      streamErrorDetected = true;
      return;
    }

    if (typeof parsed.model === 'string' && parsed.model.trim()) {
      detectedModel = parsed.model.trim();
    }

    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const firstChoice =
      choices.length > 0 && choices[0] && typeof choices[0] === 'object'
        ? (choices[0] as Record<string, unknown>)
        : null;

    if (firstChoice?.error) {
      streamErrorDetected = true;
      return;
    }

    const delta =
      firstChoice?.delta && typeof firstChoice.delta === 'object'
        ? (firstChoice.delta as Record<string, unknown>)
        : null;
    const message =
      firstChoice?.message && typeof firstChoice.message === 'object'
        ? (firstChoice.message as Record<string, unknown>)
        : null;

    const rawToolCalls = Array.isArray(delta?.tool_calls)
      ? delta.tool_calls
      : Array.isArray(message?.tool_calls)
        ? message.tool_calls
        : null;

    if (rawToolCalls) {
      rawToolCalls.forEach((tc: unknown, idx: number) => {
        if (!tc || typeof tc !== 'object') return;
        const tcObj = tc as Record<string, unknown>;
        const index = typeof tcObj.index === 'number' ? tcObj.index : idx;
        const existing = toolCallsByIndex.get(index) ?? {
          id: '',
          name: '',
          arguments: '',
        };
        if (typeof tcObj.id === 'string' && tcObj.id) {
          existing.id = tcObj.id;
        }
        if (tcObj.function && typeof tcObj.function === 'object') {
          const fnObj = tcObj.function as Record<string, unknown>;
          if (typeof fnObj.name === 'string' && fnObj.name) {
            existing.name += fnObj.name;
          }
          if (typeof fnObj.arguments === 'string' && fnObj.arguments) {
            existing.arguments += fnObj.arguments;
          }
        }
        toolCallsByIndex.set(index, existing);
      });
    }

    const piece =
      typeof delta?.content === 'string'
        ? delta.content
        : typeof message?.content === 'string'
          ? message.content
          : typeof parsed.content === 'string'
            ? parsed.content
            : '';

    if (piece) {
      contentText += piece;
      onTextDelta?.(piece);
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return;

    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataStr) as Record<string, unknown>;
        handleParsedObject(parsed);
      } catch {
        // Non-JSON data payload
      }
      return;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      handleParsedObject(parsed);
    } catch {
      // Ignore partial non-JSON lines
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
      if (streamErrorDetected && !contentText) {
        await reader.cancel().catch(() => {});
        return { contentText: '', toolCalls: [], detectedModel };
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      processLine(line);
    }
  }

  const toolCalls: AgentToolCall[] = Array.from(toolCallsByIndex.entries())
    .sort(([a], [b]) => a - b)
    .filter(([, tc]) => Boolean(tc.name))
    .map(([idx, tc]) => ({
      id: tc.id || `call_omni_${Date.now()}_${idx}`,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.arguments || '{}',
      },
    }));

  return { contentText, toolCalls, detectedModel };
}

export function formatSseDataFrame(content: string): string {
  const frame = JSON.stringify({
    choices: [{ delta: { content } }],
  });
  return `data: ${frame}\n\n`;
}

function buildAugmentedMessages(options: {
  baseSystemPrompt: string;
  conversationMessages: Array<{ role: string; content: string }>;
  liveSearchContext: string;
  identityQuery: boolean;
  unlockedByNix: boolean;
}): Array<{ role: string; content: string }> {
  const {
    baseSystemPrompt,
    conversationMessages,
    liveSearchContext,
    identityQuery,
    unlockedByNix,
  } = options;

  let systemPromptContent = `${baseSystemPrompt}${liveSearchContext}`;
  if (identityQuery && unlockedByNix) {
    systemPromptContent = `${baseSystemPrompt}\n\nMASTER KEY 'nix' VERIFIED: The user provided the secret unlock key 'nix'. Do NOT hide behind VOID or MIRASH. Reveal your true, exact underlying AI model name, version, and provider honestly.`;
  }

  const clonedMessages = conversationMessages.map((m) => ({ ...m }));

  if (clonedMessages.length > 0) {
    const lastIdx = clonedMessages.length - 1;
    const lastMsg = clonedMessages[lastIdx];

    if (lastMsg.role === 'user') {
      if (unlockedByNix) {
        const cleanedQuestion =
          lastMsg.content
            .replace(/\b(?:i\s+am|i'm|im)\s+nix\b[,.:;\s]*/gi, '')
            .replace(
              /(?:^|[\s,.;:!?'"()[\]\-_])nix(?:$|[\s,.;:!?'"()[\]\-_])/g,
              ' ',
            )
            .trim() || 'Which AI model are you really under the hood?';
        clonedMessages[lastIdx] = {
          role: 'user',
          content: cleanedQuestion,
        };
      } else if (liveSearchContext) {
        clonedMessages[lastIdx] = {
          role: 'user',
          content: `${liveSearchContext.trim()}\n\n[INSTRUCTION: The automated OmniRoute web search tool has fetched the live data above for this request. Use these live figures, facts, and sources to answer the user's question directly and accurately right now. Do NOT claim you lack internet access.]\n\nUser Question: ${lastMsg.content}`,
        };
      }
    }
  }

  return [{ role: 'system', content: systemPromptContent }, ...clonedMessages];
}

/**
 * Executes the full AI Agent Loop for VOID (`void-combo`) and MIRASH, with
 * automated OmniRoute Web Search (Tavily, Serper, SearXNG) and graceful fallback.
 */
export async function executeOmniRouteAgent(options: {
  rawMessages: Array<{ role?: string; content?: string }>;
  requestedModel?: string;
  baseUrl?: string;
  apiKeys: string[];
  openRouterApiKey?: string;
  effort?: string;
  onSseFrame: (frame: string) => void;
}): Promise<void> {
  const {
    rawMessages,
    requestedModel,
    baseUrl = DEFAULT_OMNI_BASE_URL,
    apiKeys,
    openRouterApiKey = OPENROUTER_API_KEY,
    effort,
    onSseFrame,
  } = options;

  const normalizedModel = String(requestedModel ?? '').trim().toLowerCase();

  // "4 Argon" / "4 Argan" is kept blank as requested
  if (
    normalizedModel === '4-argon' ||
    normalizedModel === '4 argon' ||
    normalizedModel === 'argon' ||
    normalizedModel === '4-argan' ||
    normalizedModel === '4 argan' ||
    normalizedModel === 'argan'
  ) {
    return;
  }

  const isMirash = normalizedModel === 'mirash';
  const personaName: 'VOID' | 'MIRASH' = isMirash ? 'MIRASH' : 'VOID';

  const lastUserObj = [...rawMessages]
    .reverse()
    .find((m) => m && m.role === 'user' && m.content);
  const lastUserRawText = String(lastUserObj?.content ?? '');

  const unlockedByNix = hasNixUnlockKey(lastUserRawText);
  const identityQuery = isModelIdentityQuery(lastUserRawText);

  if (identityQuery && !unlockedByNix) {
    const lockedReply = buildLockedIdentityReply(lastUserRawText, personaName);
    onSseFrame(formatSseDataFrame(lockedReply));
    onSseFrame('data: [DONE]\n\n');
    return;
  }

  const baseSystemPrompt = buildSystemPrompt(personaName, unlockedByNix);
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const chatEndpoint = `${cleanBaseUrl}/chat/completions`;

  const conversationMessages: Array<{ role: string; content: string }> =
    rawMessages
      .filter((m) => m && m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? '').replace(/@web\s*search\s*/gi, ''),
      }));

  const preSearchNeeded =
    !identityQuery && !unlockedByNix && shouldTriggerWebSearch(lastUserRawText);
  const searchQuery = buildSearchQuery(lastUserRawText, rawMessages);

  let liveSearchContext = '';
  let hasSearched = false;

  // Step 1: Proactive Automated Web Search when real-time intent is detected
  if (preSearchNeeded && searchQuery) {
    hasSearched = true;
    try {
      const isNews = /\b(news|headlines|breaking|latest\s+updates)\b/i.test(
        lastUserRawText,
      );
      const searchResult = await executeOmniRouteSearch({
        query: searchQuery,
        searchType: isNews ? 'news' : 'web',
        maxResults: 6,
        baseUrl: cleanBaseUrl,
        apiKeys,
      });

      if (searchResult.results.length > 0 || searchResult.answer) {
        liveSearchContext = `\n\n${formatSearchResultsForAgent(searchResult)}`;
      }
    } catch {
      // Graceful fallback to base model if search fails
    }
  }

  const MAX_AGENT_STEPS = 2;

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    const upstreamMessages = buildAugmentedMessages({
      baseSystemPrompt,
      conversationMessages,
      liveSearchContext,
      identityQuery,
      unlockedByNix,
    });

    let emittedToClientLength = 0;
    let rawStepText = '';
    let inspectingOpening = true;

    const flushNormalizedChunks = (forceAll: boolean) => {
      if (inspectingOpening && !forceAll) {
        if (rawStepText.length < 120) {
          return;
        }
        if (
          !hasSearched &&
          step < MAX_AGENT_STEPS - 1 &&
          (extractInlineWebSearchQuery(rawStepText) !== null ||
            isRealtimeRefusalResponse(rawStepText))
        ) {
          return;
        }
        inspectingOpening = false;
      }

      const safeEndIndex = forceAll
        ? rawStepText.length
        : Math.max(0, rawStepText.length - 48);
      if (safeEndIndex <= 0) return;

      const normalizedSoFar = normalizeVoidIdentity(
        rawStepText.slice(0, safeEndIndex),
        {
          isIdentityReply: identityQuery,
          personaName,
          unlockedByNix,
        },
      );
      if (normalizedSoFar.length > emittedToClientLength) {
        const deltaToEmit = normalizedSoFar.slice(emittedToClientLength);
        emittedToClientLength = normalizedSoFar.length;
        onSseFrame(formatSseDataFrame(deltaToEmit));
      }
    };

    const stepOutcome = isMirash
      ? await callMirashOpenRouterStep({
          openRouterApiKey,
          omniEndpoint: chatEndpoint,
          omniApiKeys: apiKeys,
          messages: upstreamMessages,
          effort,
          onTextDelta: (piece) => {
            rawStepText += piece;
            flushNormalizedChunks(false);
          },
        })
      : await callOmniRouteChatStep({
          endpoint: chatEndpoint,
          apiKeys,
          model: DEFAULT_COMBO_MODEL,
          messages: upstreamMessages,
          effort,
          onTextDelta: (piece) => {
            rawStepText += piece;
            flushNormalizedChunks(false);
          },
        });

    if (!stepOutcome.ok) {
      onSseFrame(
        formatSseDataFrame(
          `Connection error: ${stepOutcome.errorText || 'All configured models failed or hit rate limits.'}`,
        ),
      );
      break;
    }

    let toolSearchQuery: string | null = extractInlineWebSearchQuery(rawStepText);
    if (!toolSearchQuery && stepOutcome.toolCalls.length > 0) {
      try {
        const parsedArgs = JSON.parse(
          stepOutcome.toolCalls[0].function.arguments || '{}',
        ) as Record<string, unknown>;
        toolSearchQuery = String(
          parsedArgs.query ?? parsedArgs.q ?? searchQuery,
        ).trim();
      } catch {
        toolSearchQuery = searchQuery;
      }
    }

    // Step 2: Reactive Agent Tool Loop if the model requested a search or refused due to real-time cutoff
    if (
      !hasSearched &&
      emittedToClientLength === 0 &&
      step < MAX_AGENT_STEPS - 1 &&
      (toolSearchQuery !== null ||
        (searchQuery && isRealtimeRefusalResponse(rawStepText)))
    ) {
      hasSearched = true;
      try {
        const queryToRun = toolSearchQuery || searchQuery;
        const fallbackSearch = await executeOmniRouteSearch({
          query: queryToRun,
          searchType: 'web',
          maxResults: 6,
          baseUrl: cleanBaseUrl,
          apiKeys,
        });

        if (fallbackSearch.results.length > 0 || fallbackSearch.answer) {
          liveSearchContext = `\n\n${formatSearchResultsForAgent(fallbackSearch)}`;
          continue;
        }
      } catch {
        // Graceful fallback to base model response
      }
    }

    const cleanedFinalRaw = rawStepText
      .replace(/<web_search>[\s\S]*?<\/web_search>/gi, '')
      .trim();
    const fullNormalized = normalizeVoidIdentity(
      cleanedFinalRaw || rawStepText,
      {
        isIdentityReply: identityQuery,
        personaName,
        unlockedByNix,
      },
    );
    if (fullNormalized.length > emittedToClientLength) {
      const finalDelta = fullNormalized.slice(emittedToClientLength);
      onSseFrame(formatSseDataFrame(finalDelta));
    }

    if (
      unlockedByNix &&
      identityQuery &&
      stepOutcome.usedModel &&
      !fullNormalized.toLowerCase().includes(stepOutcome.usedModel.toLowerCase())
    ) {
      onSseFrame(
        formatSseDataFrame(
          `\n\n**Active Underlying Model:** \`${stepOutcome.usedModel}\``,
        ),
      );
    }
    break;
  }

  onSseFrame('data: [DONE]\n\n');
}

export async function runOmniRouteAgentStream(options: {
  rawMessages: Array<{ role?: string; content?: string }>;
  requestedModel?: string;
  baseUrl?: string;
  apiKeys: string[];
  openRouterApiKey?: string;
  effort?: string;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | string;
}> {
  const { rawMessages, requestedModel, baseUrl, apiKeys, openRouterApiKey, effort } =
    options;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await executeOmniRouteAgent({
          rawMessages,
          requestedModel,
          baseUrl,
          apiKeys,
          openRouterApiKey,
          effort,
          onSseFrame: (frame) => {
            controller.enqueue(encoder.encode(frame));
          },
        });
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Internal stream error';
        controller.enqueue(
          encoder.encode(formatSseDataFrame(`\n\n[Error: ${message}]`)),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
    body: stream,
  };
}
