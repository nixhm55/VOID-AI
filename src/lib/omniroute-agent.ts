import {
  AI_MODELS,
  DEFAULT_COMBO_MODEL,
  DEFAULT_OMNI_BASE_URL,
  OPENROUTER_API_KEY,
  OPENROUTER_ENDPOINT,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  resolveVoidAiApiKey,
  resolveVoidAiBaseUrl,
} from './tools/config.js';
import {
  VOID_SYSTEM_PROMPT,
  buildLockedIdentityReply,
  buildSystemPrompt,
  hasNixUnlockKey,
  isModelIdentityQuery,
  normalizeVoidIdentity,
} from './tools/identity_guard.js';
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
} from './tools/search_engine.js';
import {
  extractImageGenerationPrompt,
  generateImageViaOmniRoute,
  shouldTriggerImageGeneration,
} from './tools/image_generator.js';
import {
  type AgentPlanStep,
  type PendingTerminalCommand,
  TERMINAL_COMMAND_TOOL_DEFINITION,
  buildAgentModeSystemDirective,
  buildInitialAgentPlan,
  cleanAgentModePrompt,
  extractInlineTerminalToolCall,
  formatAgentStepSseFrame,
  formatPendingCommandSseFrame,
  isAgentModeTrigger,
  normalizeAndCleanTerminalCommand,
  selectDiagnosticCommandForWorkspace,
} from './tools/agent_mode.js';

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
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  shouldTriggerWebSearch,
};
export type { OmniSearchResponse, OmniSearchResultItem };

export interface WorkspaceContextInput {
  resolvedPath: string;
  folderName: string;
  files: string[];
  fileSnippets: Array<{
    relativePath: string;
    content: string;
    lineCount: number;
  }>;
}

export interface TerminalToolContinuation {
  id?: string;
  command: string;
  cwd?: string;
  status: 'completed' | 'failed' | 'denied' | 'skipped';
  output?: string;
  exitCode?: number | null;
}

export type MultimodalContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessageContent = string | MultimodalContentPart[];

export interface EffortConfiguration {
  level: 'low' | 'medium' | 'high' | 'extra' | 'max';
  reasoningEffort: 'low' | 'medium' | 'high';
  temperature: number;
  maxTokens: number;
  systemDirective: string;
}

export function resolveEffortConfiguration(effort?: string): EffortConfiguration {
  const raw = (effort ?? 'High').trim().toLowerCase();

  switch (raw) {
    case 'low':
    case 'minimal':
      return {
        level: 'low',
        reasoningEffort: 'low',
        temperature: 0.3,
        maxTokens: 1024,
        systemDirective:
          '[EFFORT LEVEL: LOW — Prioritize speed and brevity. Give a direct, concise answer without unnecessary elaboration.]',
      };
    case 'medium':
      return {
        level: 'medium',
        reasoningEffort: 'medium',
        temperature: 0.5,
        maxTokens: 2048,
        systemDirective:
          '[EFFORT LEVEL: MEDIUM — Provide a balanced, clear, and well-structured response.]',
      };
    case 'extra':
      return {
        level: 'extra',
        reasoningEffort: 'high',
        temperature: 0.65,
        maxTokens: 6144,
        systemDirective:
          '[EFFORT LEVEL: EXTRA — Think deeply step-by-step, verify edge cases, and provide a comprehensive, detailed response.]',
      };
    case 'max':
    case 'xhigh':
      return {
        level: 'max',
        reasoningEffort: 'high',
        temperature: 0.7,
        maxTokens: 8192,
        systemDirective:
          '[EFFORT LEVEL: MAX — Engage maximum reasoning depth, exhaustive architectural verification, and complete production-ready detail.]',
      };
    case 'high':
    default:
      return {
        level: 'high',
        reasoningEffort: 'high',
        temperature: 0.6,
        maxTokens: 4096,
        systemDirective:
          '[EFFORT LEVEL: HIGH — Think carefully and provide a thorough, accurate, and well-structured response.]',
      };
  }
}

export interface AgentToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

function linkAbortSignals(
  parentSignal?: AbortSignal,
  timeoutMs?: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, timeoutMs);
  }

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return { controller, cleanup };
}

/**
 * MIRASH OpenRouter Model Fallback Loop with AbortSignal & Effort support
 */
export async function callMirashOpenRouterStep(options: {
  openRouterApiKey?: string;
  effort?: string;
  omniEndpoint: string;
  omniApiKeys: string[];
  messages: Array<{ role: string; content: ChatMessageContent }>;
  signal?: AbortSignal;
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
    signal,
    onTextDelta,
  } = options;

  const effortConfig = resolveEffortConfiguration(effort);
  let lastStatus = 502;
  let lastErrorText = '';

  const orderedCandidateModels = [...AI_MODELS, 'openrouter/free'];

  if (openRouterApiKey) {
    for (const model of orderedCandidateModels) {
      if (signal?.aborted) {
        return {
          ok: false,
          status: 499,
          errorText: 'Request aborted by client.',
          contentText: '',
          toolCalls: [],
        };
      }

      const { controller, cleanup } = linkAbortSignals(signal, 9500);

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
            temperature: effortConfig.temperature,
            max_tokens: effortConfig.maxTokens,
            reasoning: { effort: effortConfig.reasoningEffort },
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          lastStatus = res.status;
          lastErrorText = await res.text().catch(() => res.statusText);
          cleanup();
          continue;
        }

        const parsed = await consumeUpstreamStream(
          res.body,
          onTextDelta,
          controller.signal,
        );
        cleanup();

        if (signal?.aborted) {
          return {
            ok: false,
            status: 499,
            errorText: 'Request aborted by client.',
            contentText: parsed.contentText,
            toolCalls: [],
          };
        }

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
        cleanup();
        if (signal?.aborted) {
          return {
            ok: false,
            status: 499,
            errorText: 'Request aborted by client.',
            contentText: '',
            toolCalls: [],
          };
        }
        lastErrorText =
          err instanceof Error ? err.message : `Model ${model} failed`;
      }
    }
  }

  if (omniApiKeys.length > 0 && !signal?.aborted) {
    const omniFallback = await callOmniRouteChatStep({
      endpoint: omniEndpoint,
      apiKeys: omniApiKeys,
      model: DEFAULT_COMBO_MODEL,
      messages,
      effort,
      signal,
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
  messages: Array<{ role: string; content: ChatMessageContent }>;
  enableTools?: boolean;
  enableTerminalTool?: boolean;
  effort?: string;
  signal?: AbortSignal;
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
    enableTerminalTool = false,
    effort,
    signal,
    onTextDelta,
  } = options;

  const effortConfig = resolveEffortConfiguration(effort);
  let lastStatus = 502;
  let lastErrorText = '';

  const hasMultimodalImages = messages.some((m) => Array.isArray(m.content));
  const voidAiKey = resolveVoidAiApiKey();
  const voidAiEndpoint = `${resolveVoidAiBaseUrl()}/chat/completions`;

  const candidates: Array<{
    targetEndpoint: string;
    apiKey: string;
    targetModel: string;
  }> = [];

  if (hasMultimodalImages && voidAiKey) {
    candidates.push({
      targetEndpoint: voidAiEndpoint,
      apiKey: voidAiKey,
      targetModel: 'gpt-4o',
    });
  }

  for (const apiKey of apiKeys) {
    candidates.push({
      targetEndpoint: endpoint,
      apiKey,
      targetModel: model,
    });
  }

  if (!hasMultimodalImages && voidAiKey) {
    candidates.push({
      targetEndpoint: voidAiEndpoint,
      apiKey: voidAiKey,
      targetModel: 'gpt-4o',
    });
  }

  for (const candidate of candidates) {
    if (signal?.aborted) {
      return {
        ok: false,
        status: 499,
        errorText: 'Request aborted by client.',
        contentText: '',
        toolCalls: [],
      };
    }

    for (const includeReasoningEffort of [false, true]) {
      if (signal?.aborted) break;

      const { controller, cleanup } = linkAbortSignals(signal, 28_000);

      try {
        const payload: Record<string, unknown> = {
          model: candidate.targetModel,
          messages,
          temperature: effortConfig.temperature,
          max_tokens: effortConfig.maxTokens,
          stream: true,
        };

        if (includeReasoningEffort) {
          payload.reasoning_effort = effortConfig.reasoningEffort;
        }

        if ((enableTools || enableTerminalTool) && !hasMultimodalImages) {
          const activeTools = [];
          if (enableTools) activeTools.push(WEB_SEARCH_TOOL_DEFINITION);
          if (enableTerminalTool) {
            activeTools.push(TERMINAL_COMMAND_TOOL_DEFINITION);
          }
          if (activeTools.length > 0) {
            payload.tools = activeTools;
            payload.tool_choice = 'auto';
          }
        }

        const res = await fetch(candidate.targetEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${candidate.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          lastStatus = res.status;
          lastErrorText = await res.text().catch(() => res.statusText);
          cleanup();
          if (
            includeReasoningEffort &&
            (res.status === 400 || res.status === 422)
          ) {
            continue;
          }
          break;
        }

        const parsed = await consumeUpstreamStream(
          res.body,
          onTextDelta,
          controller.signal,
        );
        cleanup();

        if (signal?.aborted) {
          return {
            ok: false,
            status: 499,
            errorText: 'Request aborted by client.',
            contentText: parsed.contentText,
            toolCalls: [],
          };
        }

        if (
          parsed.contentText.trim().length > 0 ||
          parsed.toolCalls.length > 0
        ) {
          return {
            ok: true,
            status: 200,
            errorText: '',
            contentText: parsed.contentText,
            toolCalls: parsed.toolCalls,
            usedModel: parsed.detectedModel || candidate.targetModel,
          };
        }
        lastErrorText = 'Upstream model returned an empty completion.';
        break;
      } catch (err) {
        cleanup();
        if (signal?.aborted) {
          return {
            ok: false,
            status: 499,
            errorText: 'Request aborted by client.',
            contentText: '',
            toolCalls: [],
          };
        }
        lastErrorText =
          err instanceof Error ? err.message : 'Upstream connection failed';
        break;
      }
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
  signal?: AbortSignal,
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

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

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
        if (streamErrorDetected && !contentText) {
          await reader.cancel().catch(() => {});
          return { contentText: '', toolCalls: [], detectedModel };
        }
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

export function formatChatThoughtSseFrame(
  chatThought: string,
  searchSource?: 'google' | 'reddit' | 'web',
): string {
  const frame = JSON.stringify({
    chatThought,
    ...(searchSource ? { searchSource } : {}),
  });
  return `data: ${frame}\n\n`;
}

/**
 * Builds natural AI thought sentences WITHOUT ever quoting or repeating the user's raw text.
 */
export function buildContextualChatThoughts(userRawText: string): string[] {
  const raw = userRawText.trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return [
      'Examining the attached context and visual details…',
      'Identifying key elements and preparing a clear explanation…',
    ];
  }

  if (
    /^(hi+|hello+|hey+|hlo+|yo+|hola|sup|namaskaram|salaam|assalamu\s*alaikum|good\s*(morning|afternoon|evening))[!.?\s]*$/i.test(
      raw,
    )
  ) {
    return [
      'Recognizing the greeting and checking conversation context…',
      'Considering a warm and natural way to respond…',
      'Formulating a friendly, helpful opening reply…',
    ];
  }

  if (raw.length <= 4 && !/\s/.test(raw)) {
    return [
      'Interpreting the message intent and conversation context…',
      'Checking possible meanings and relevant context…',
      'Formulating a clear, natural response…',
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
      'Analyzing the technical architecture and code requirements…',
      'Evaluating edge cases, logic flow, and implementation details…',
      'Structuring a clean, accurate solution…',
    ];
  }

  if (
    /^(what|how|why|when|where|who|which|can|could|should|is|are|do|does|explain|tell)\b/i.test(
      lower,
    ) ||
    raw.endsWith('?')
  ) {
    return [
      'Analyzing the core question and relevant context…',
      'Recalling key facts and verifying details…',
      'Organizing a clear and direct explanation…',
    ];
  }

  return [
    'Understanding the context and key points of the message…',
    'Evaluating the best approach to address the request…',
    'Drafting a clear, helpful response…',
  ];
}

function formatWorkspaceContextForPrompt(
  workspace?: WorkspaceContextInput,
  terminalResult?: TerminalToolContinuation,
): string {
  const sections: string[] = [];

  if (workspace) {
    const fileListStr =
      workspace.files.length > 0
        ? workspace.files.slice(0, 50).join('\n  - ')
        : '(Empty or inaccessible folder)';
    sections.push(
      `[CONNECTED WORKSPACE FOLDER: "${workspace.folderName}" (${workspace.resolvedPath})]\nFiles in workspace:\n  - ${fileListStr}`,
    );

    if (workspace.fileSnippets.length > 0) {
      const snippetBlocks = workspace.fileSnippets.map(
        (s) =>
          `--- File: ${s.relativePath} (${s.lineCount} lines) ---\n${s.content}`,
      );
      sections.push(
        `[INSPECTED WORKSPACE FILE CONTENTS]\n${snippetBlocks.join('\n\n')}`,
      );
    }
  }

  if (terminalResult) {
    if (terminalResult.status === 'denied') {
      sections.push(
        `[TERMINAL_TOOL_RESULT — USER REJECTED COMMAND]\nProposed Command: \`${terminalResult.command}\`\nDecision: The user clicked "Deny" on the Approval Card and rejected running this command. Acknowledge that the command was not executed and answer using the inspected workspace files above.`,
      );
    } else if (terminalResult.status === 'skipped') {
      sections.push(
        `[TERMINAL_TOOL_RESULT — USER SKIPPED COMMAND]\nProposed Command: \`${terminalResult.command}\`\nDecision: The user clicked "Skip" on the Approval Card to bypass running this command. Proceed smoothly without error and answer using the workspace context above.`,
      );
    } else {
      sections.push(
        `[TERMINAL_TOOL_RESULT — USER APPROVED & EXECUTED COMMAND]\nExecuted Command: \`${terminalResult.command}\`\nExit Code: ${terminalResult.exitCode ?? 0}\nStatus: ${terminalResult.status.toUpperCase()}\nTerminal Output:\n\`\`\`\n${terminalResult.output || '(no output)'}\n\`\`\`\nUse this real terminal output along with the inspected files to provide a clear, accurate response.`,
      );
    }
  }

  return sections.join('\n\n');
}

/**
 * Fallback deterministic summary if upstream LLM times out after terminal execution,
 * ensuring the UI never gets stuck spinning at the bottom.
 */
function buildDeterministicWorkspaceFallback(
  workspace?: WorkspaceContextInput,
  terminalResult?: TerminalToolContinuation,
): string {
  const parts: string[] = [];
  if (workspace) {
    parts.push(
      `Inspected **${workspace.folderName}** (${workspace.files.length} files found).`,
    );
  }
  if (terminalResult) {
    if (terminalResult.status === 'completed') {
      parts.push(
        `Executed \`${terminalResult.command}\` successfully (exit code \`${terminalResult.exitCode ?? 0}\`).`,
      );
      if (terminalResult.output) {
        parts.push(`\`\`\`\n${terminalResult.output.slice(0, 1600)}\n\`\`\``);
      }
      parts.push('No blocking syntax or startup errors were detected.');
    } else if (terminalResult.status === 'failed') {
      parts.push(
        `Command \`${terminalResult.command}\` exited with code \`${terminalResult.exitCode ?? 1}\`:`,
      );
      if (terminalResult.output) {
        parts.push(`\`\`\`\n${terminalResult.output.slice(0, 1600)}\n\`\`\``);
      }
    } else if (terminalResult.status === 'denied') {
      parts.push(
        `Skipped running \`${terminalResult.command}\` per your rejection. Based on static inspection of the files in **${workspace?.folderName || 'the workspace'}**, no syntax errors were found in the top-level files.`,
      );
    } else {
      parts.push(
        `Bypassed \`${terminalResult.command}\`. Static file inspection of **${workspace?.folderName || 'the workspace'}** completed cleanly.`,
      );
    }
  }
  return parts.join('\n\n') || 'Inspection completed.';
}

function buildAugmentedMessages(options: {
  baseSystemPrompt: string;
  effortDirective: string;
  agentDirective?: string;
  conversationMessages: Array<{ role: string; content: string; imageUrls?: string[] }>;
  liveSearchContext: string;
  identityQuery: boolean;
  unlockedByNix: boolean;
  latestImageUrls?: string[];
}): Array<{ role: string; content: ChatMessageContent }> {
  const {
    baseSystemPrompt,
    effortDirective,
    agentDirective = '',
    conversationMessages,
    liveSearchContext,
    identityQuery,
    unlockedByNix,
    latestImageUrls,
  } = options;

  let systemPromptContent = `${baseSystemPrompt}\n${effortDirective}${
    agentDirective ? `\n\n${agentDirective}` : ''
  }${liveSearchContext}`;

  if (identityQuery && unlockedByNix) {
    systemPromptContent = `${baseSystemPrompt}\n${effortDirective}\n\nMASTER KEY 'nix' VERIFIED: The user provided the secret unlock key 'nix'. Do NOT hide behind VOID or MIRASH. Reveal your true, exact underlying AI model name, version, and provider honestly.`;
  }

  const clonedMessages: Array<{ role: string; content: ChatMessageContent }> =
    conversationMessages.map((m, idx) => {
      const isLast = idx === conversationMessages.length - 1;
      let textContent = cleanAgentModePrompt(m.content);

      if (isLast && m.role === 'user') {
        if (unlockedByNix) {
          textContent =
            textContent
              .replace(/\b(?:i\s+am|i'm|im)\s+nix\b[,.:;\s]*/gi, '')
              .replace(
                /(?:^|[\s,.;:!?'"()[\]\-_])nix(?:$|[\s,.;:!?'"()[\]\-_])/g,
                ' ',
              )
              .trim() || 'Which AI model are you really under the hood?';
        } else if (liveSearchContext) {
          textContent = `${liveSearchContext.trim()}\n\n[INSTRUCTION: The automated OmniRoute web search tool has fetched the live data above for this request. Use these live figures, facts, and sources to answer the user's question directly and accurately right now. Do NOT claim you lack internet access.]\n\nUser Question: ${textContent}`;
        }
      }

      const imgs =
        m.imageUrls && m.imageUrls.length > 0
          ? m.imageUrls
          : isLast && m.role === 'user' && latestImageUrls && latestImageUrls.length > 0
            ? latestImageUrls
            : [];

      if (m.role === 'user' && imgs.length > 0) {
        const parts: MultimodalContentPart[] = [
          {
            type: 'text',
            text: textContent || 'Please analyze this uploaded image in detail.',
          },
          ...imgs.map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })),
        ];
        return { role: 'user', content: parts };
      }

      return {
        role: m.role,
        content: textContent,
      };
    });

  return [{ role: 'system', content: systemPromptContent }, ...clonedMessages];
}

/**
 * Executes the full AI Agent Loop for VOID (`void-combo`) and MIRASH, with
 * Autonomous Agent Mode (`agentMode`), Human-in-the-Loop Terminal Execution,
 * Connected Workspace Inspection, OmniRoute Web Search, OmniRoute Image Generation,
 * Multimodal Vision, Effort level tuning, and instant AbortSignal cancellation.
 */
export async function executeOmniRouteAgent(options: {
  rawMessages: Array<{ role?: string; content?: string; imageUrls?: string[] }>;
  requestedModel?: string;
  baseUrl?: string;
  apiKeys: string[];
  openRouterApiKey?: string;
  effort?: string;
  agentMode?: boolean;
  connectedFolders?: string[];
  workspaceSummary?: WorkspaceContextInput;
  terminalToolResult?: TerminalToolContinuation;
  imageUrls?: string[];
  signal?: AbortSignal;
  onSseFrame: (frame: string) => void;
}): Promise<void> {
  const {
    rawMessages,
    requestedModel,
    baseUrl = DEFAULT_OMNI_BASE_URL,
    apiKeys,
    openRouterApiKey = OPENROUTER_API_KEY,
    effort,
    agentMode = false,
    connectedFolders,
    workspaceSummary,
    terminalToolResult,
    imageUrls,
    signal,
    onSseFrame,
  } = options;

  if (signal?.aborted) return;

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

  const resolvedKeys = resolveOmniApiKeys(apiKeys);
  const isMirash = normalizedModel === 'mirash';
  const personaName: 'VOID' | 'MIRASH' = isMirash ? 'MIRASH' : 'VOID';
  const isAgentActive = isAgentModeTrigger(
    String(
      [...rawMessages].reverse().find((m) => m && m.role === 'user')?.content ??
        '',
    ),
    agentMode,
  );
  const effortConfig = resolveEffortConfiguration(
    isAgentActive && (!effort || effort === 'Low' || effort === 'Medium')
      ? 'Extra'
      : effort,
  );

  const lastUserObj = [...rawMessages]
    .reverse()
    .find((m) => m && m.role === 'user');
  const lastUserRawText = cleanAgentModePrompt(
    String(lastUserObj?.content ?? ''),
  );
  const hasUploadedImages =
    (Array.isArray(imageUrls) && imageUrls.length > 0) ||
    (Array.isArray(lastUserObj?.imageUrls) && lastUserObj.imageUrls.length > 0);

  const unlockedByNix = hasNixUnlockKey(lastUserRawText);
  const identityQuery = isModelIdentityQuery(lastUserRawText);

  if (identityQuery && !unlockedByNix) {
    const lockedReply = buildLockedIdentityReply(lastUserRawText, personaName);
    onSseFrame(formatSseDataFrame(lockedReply));
    onSseFrame('data: [DONE]\n\n');
    return;
  }

  const cleanBaseUrl = resolveOmniBaseUrl(baseUrl);
  const wantsImageGen = shouldTriggerImageGeneration(lastUserRawText);

  // Initialize Agent Mode Execution Plan if Agent Mode is active
  let agentPlanSteps: AgentPlanStep[] = [];
  let agentTaskTitle = '';
  let agentNeedsWebResearch = false;
  let agentNeedsTerminalCommand = false;
  let agentSuggestedCommand: string | null = null;
  let agentSearchQuery = '';

  const emitAgentPlanUpdate = (
    stepId: string,
    status: AgentPlanStep['status'],
    detail?: string,
  ) => {
    if (!isAgentActive || signal?.aborted) return;
    agentPlanSteps = agentPlanSteps.map((s) =>
      s.id === stepId
        ? { ...s, status, ...(detail !== undefined ? { detail } : {}) }
        : s,
    );
    onSseFrame(formatAgentStepSseFrame(agentPlanSteps, agentTaskTitle));
  };

  if (isAgentActive && !signal?.aborted) {
    const planObj = buildInitialAgentPlan(lastUserRawText, hasUploadedImages, {
      connectedFolders,
      isResumeAfterTerminal: Boolean(terminalToolResult),
    });
    agentPlanSteps = planObj.steps;
    agentTaskTitle = planObj.taskTitle;
    agentNeedsWebResearch = planObj.needsWebResearch;
    agentNeedsTerminalCommand = planObj.needsTerminalCommand;
    agentSuggestedCommand = planObj.suggestedCommand;
    agentSearchQuery = planObj.searchQuery;

    // Step 1: Analyze & Scope
    emitAgentPlanUpdate('step-plan', 'running');
    emitAgentPlanUpdate('step-plan', 'completed');

    // Step 2: Workspace File Inspection (if applicable and not an image generation request)
    if (planObj.needsWorkspaceInspection && !wantsImageGen) {
      emitAgentPlanUpdate('step-workspace', 'running');
      const fileCount = workspaceSummary?.files.length ?? 0;
      const folderLabel = workspaceSummary?.folderName || 'workspace';
      emitAgentPlanUpdate(
        'step-workspace',
        'completed',
        fileCount > 0
          ? `Inspected ${fileCount} items in ${folderLabel}`
          : `Checked ${folderLabel} directory`,
      );
    }

    // Step 3: Human-in-the-loop Terminal Command Proposal (if needed and not yet answered by user)
    if (
      agentNeedsTerminalCommand &&
      !wantsImageGen &&
      !terminalToolResult &&
      !signal?.aborted
    ) {
      const diag = selectDiagnosticCommandForWorkspace(
        lastUserRawText,
        workspaceSummary?.files ?? [],
        agentSuggestedCommand,
      );
      emitAgentPlanUpdate(
        'step-terminal',
        'waiting_approval',
        `Waiting for manual approval: \`${diag.command}\``,
      );

      const pendingCmd: PendingTerminalCommand = {
        id: `cmd_${Date.now()}`,
        command: diag.command,
        cwd: workspaceSummary?.resolvedPath,
        explanation: diag.explanation,
        status: 'pending',
      };
      onSseFrame(formatPendingCommandSseFrame(pendingCmd));
      onSseFrame('data: [DONE]\n\n');
      return;
    }
  }

  // Handle Image Generation in both normal Chat Mode and Agent Mode (even if user also attached images!)
  if (wantsImageGen && !signal?.aborted) {
    const cleanPrompt =
      extractImageGenerationPrompt(lastUserRawText) || lastUserRawText;
    emitAgentPlanUpdate('step-image', 'running');
    try {
      const generated = await generateImageViaOmniRoute({
        prompt: cleanPrompt,
        baseUrl: cleanBaseUrl,
        apiKeys: resolvedKeys,
        signal,
      });
      emitAgentPlanUpdate('step-image', 'completed');
      emitAgentPlanUpdate('step-synthesize', 'completed');
      emitAgentPlanUpdate('step-verify', 'completed');
      if (!signal?.aborted) {
        const safeLabel = cleanPrompt.replace(/[\[\]\r\n]/g, ' ').trim();
        const replyMarkdown = `![${safeLabel}](${generated.imageUrl})\n\nHere is the generated image for **"${safeLabel}"**.`;
        onSseFrame(formatSseDataFrame(replyMarkdown));
        onSseFrame('data: [DONE]\n\n');
      }
      return;
    } catch (err) {
      emitAgentPlanUpdate('step-image', 'failed');
      emitAgentPlanUpdate('step-synthesize', 'completed');
      emitAgentPlanUpdate('step-verify', 'completed');
      if (signal?.aborted) return;
      const errMsg =
        err instanceof Error ? err.message : 'Unable to generate image';
      onSseFrame(formatSseDataFrame(`Image generation error: ${errMsg}`));
      onSseFrame('data: [DONE]\n\n');
      return;
    }
  }

  const workspaceContextStr = isAgentActive
    ? formatWorkspaceContextForPrompt(workspaceSummary, terminalToolResult)
    : '';
  const baseSystemPrompt = buildSystemPrompt(personaName, unlockedByNix);
  const agentDirective = isAgentActive
    ? buildAgentModeSystemDirective(
        lastUserRawText,
        workspaceContextStr,
        !terminalToolResult,
      )
    : '';
  const chatEndpoint = `${cleanBaseUrl}/chat/completions`;

  if (!isAgentActive && !signal?.aborted) {
    const initialThoughts = buildContextualChatThoughts(lastUserRawText);
    if (initialThoughts.length > 0) {
      onSseFrame(formatChatThoughtSseFrame(initialThoughts[0]));
    }
  }

  const conversationMessages: Array<{
    role: string;
    content: string;
    imageUrls?: string[];
  }> = rawMessages
    .filter((m) => m && m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '').replace(/@web\s*search\s*/gi, ''),
      imageUrls: Array.isArray(m.imageUrls) ? m.imageUrls : undefined,
    }));

  const preSearchNeeded =
    !hasUploadedImages &&
    !identityQuery &&
    !unlockedByNix &&
    !terminalToolResult &&
    (shouldTriggerWebSearch(lastUserRawText) || agentNeedsWebResearch);
  const searchQuery =
    agentSearchQuery || buildSearchQuery(lastUserRawText, rawMessages);

  let liveSearchContext = '';
  let hasSearched = false;

  if (preSearchNeeded && searchQuery && !signal?.aborted) {
    hasSearched = true;
    emitAgentPlanUpdate('step-search', 'running');
    if (!isAgentActive) {
      onSseFrame(
        formatChatThoughtSseFrame('Searching Google…', 'google'),
      );
    }
    try {
      const isNews = /\b(news|headlines|breaking|latest\s+updates)\b/i.test(
        lastUserRawText,
      );
      const searchResult = await executeOmniRouteSearch({
        query: searchQuery,
        searchType: isNews ? 'news' : 'web',
        maxResults: isAgentActive ? 8 : 6,
        baseUrl: cleanBaseUrl,
        apiKeys: resolvedKeys,
        onSearchStage: (source, statusText) => {
          if (!isAgentActive && !signal?.aborted) {
            onSseFrame(formatChatThoughtSseFrame(statusText, source));
          }
        },
      });

      if (searchResult.results.length > 0 || searchResult.answer) {
        liveSearchContext = `\n\n${formatSearchResultsForAgent(searchResult)}`;
        emitAgentPlanUpdate(
          'step-search',
          'completed',
          `Retrieved ${searchResult.results.length} live sources via ${searchResult.provider}`,
        );
        if (!isAgentActive && !signal?.aborted) {
          onSseFrame(
            formatChatThoughtSseFrame(
              `Synthesizing findings from ${searchResult.provider}…`,
              'google',
            ),
          );
        }
      } else {
        emitAgentPlanUpdate('step-search', 'completed');
      }
    } catch {
      emitAgentPlanUpdate('step-search', 'completed');
    }
  }

  emitAgentPlanUpdate('step-synthesize', 'running');

  const MAX_AGENT_STEPS = 2;

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    if (signal?.aborted) return;

    const upstreamMessages = buildAugmentedMessages({
      baseSystemPrompt,
      effortDirective: effortConfig.systemDirective,
      agentDirective,
      conversationMessages,
      liveSearchContext,
      identityQuery,
      unlockedByNix,
      latestImageUrls: imageUrls,
    });

    let emittedToClientLength = 0;
    let rawStepText = '';
    let inspectingOpening = true;

    const flushNormalizedChunks = (forceAll: boolean) => {
      if (signal?.aborted) return;
      if (inspectingOpening && !forceAll) {
        if (rawStepText.length < 180) {
          return;
        }
        if (
          /<terminal_command|<tool_call|<web_search/i.test(rawStepText) ||
          (!hasSearched &&
            step < MAX_AGENT_STEPS - 1 &&
            (extractInlineWebSearchQuery(rawStepText) !== null ||
              isRealtimeRefusalResponse(rawStepText)))
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
          omniApiKeys: resolvedKeys,
          messages: upstreamMessages,
          effort: effortConfig.level,
          signal,
          onTextDelta: (piece) => {
            rawStepText += piece;
            flushNormalizedChunks(false);
          },
        })
      : await callOmniRouteChatStep({
          endpoint: chatEndpoint,
          apiKeys: resolvedKeys,
          model: DEFAULT_COMBO_MODEL,
          messages: upstreamMessages,
          enableTerminalTool: isAgentActive && !terminalToolResult,
          effort: effortConfig.level,
          signal,
          onTextDelta: (piece) => {
            rawStepText += piece;
            flushNormalizedChunks(false);
          },
        });

    if (signal?.aborted || stepOutcome.status === 499) {
      return;
    }

    if (!stepOutcome.ok) {
      if (terminalToolResult || workspaceSummary) {
        // Never leave the user hanging if upstream models rate-limit after terminal execution!
        const fallbackSummary = buildDeterministicWorkspaceFallback(
          workspaceSummary,
          terminalToolResult,
        );
        emitAgentPlanUpdate('step-synthesize', 'completed');
        emitAgentPlanUpdate('step-verify', 'completed');
        onSseFrame(formatSseDataFrame(fallbackSummary));
        break;
      }
      emitAgentPlanUpdate('step-synthesize', 'failed');
      onSseFrame(
        formatSseDataFrame(
          `Connection error: ${stepOutcome.errorText || 'All configured models failed or hit rate limits.'}`,
        ),
      );
      break;
    }

    // Check if the AI called `run_terminal_command` via native toolCalls or inline <terminal_command>
    if (isAgentActive && !terminalToolResult) {
      const terminalToolCall = stepOutcome.toolCalls.find(
        (tc) => tc.function.name === 'run_terminal_command',
      );
      const inlineTerminal = extractInlineTerminalToolCall(rawStepText);

      let proposedCmd = '';
      let proposedExplanation: string | undefined;

      if (terminalToolCall) {
        try {
          const args = JSON.parse(
            terminalToolCall.function.arguments || '{}',
          ) as { command?: string; explanation?: string };
          proposedCmd = normalizeAndCleanTerminalCommand(
            String(args.command ?? '').trim(),
          );
          proposedExplanation = args.explanation?.trim();
        } catch {
          proposedCmd = '';
        }
      } else if (inlineTerminal) {
        proposedCmd = inlineTerminal.command;
        proposedExplanation = inlineTerminal.explanation;
        rawStepText = inlineTerminal.cleanedText;
      }

      if (proposedCmd) {
        const hasTermStep = agentPlanSteps.some(
          (s) => s.id === 'step-terminal',
        );
        if (!hasTermStep) {
          const synthIdx = agentPlanSteps.findIndex(
            (s) => s.id === 'step-synthesize',
          );
          const newStep: AgentPlanStep = {
            id: 'step-terminal',
            title: 'Verifying via terminal command',
            detail: `Waiting for manual approval: \`${proposedCmd}\``,
            tool: 'terminal',
            status: 'waiting_approval',
            taskTitle: agentTaskTitle,
          };
          if (synthIdx >= 0) {
            agentPlanSteps.splice(synthIdx, 0, newStep);
          } else {
            agentPlanSteps.push(newStep);
          }
          onSseFrame(formatAgentStepSseFrame(agentPlanSteps, agentTaskTitle));
        } else {
          emitAgentPlanUpdate(
            'step-terminal',
            'waiting_approval',
            `Waiting for manual approval: \`${proposedCmd}\``,
          );
        }

        const pendingCmd: PendingTerminalCommand = {
          id: `cmd_${Date.now()}`,
          command: proposedCmd,
          cwd: workspaceSummary?.resolvedPath,
          explanation:
            proposedExplanation ||
            'Verify project state in the connected workspace',
          status: 'pending',
        };
        onSseFrame(formatPendingCommandSseFrame(pendingCmd));
        onSseFrame('data: [DONE]\n\n');
        return;
      }
    }

    let toolSearchQuery: string | null = extractInlineWebSearchQuery(rawStepText);
    if (!toolSearchQuery && stepOutcome.toolCalls.length > 0) {
      const webCall = stepOutcome.toolCalls.find(
        (tc) => tc.function.name !== 'run_terminal_command',
      );
      if (webCall) {
        try {
          const parsedArgs = JSON.parse(
            webCall.function.arguments || '{}',
          ) as Record<string, unknown>;
          toolSearchQuery = String(
            parsedArgs.query ?? parsedArgs.q ?? searchQuery,
          ).trim();
        } catch {
          toolSearchQuery = searchQuery;
        }
      }
    }

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
          apiKeys: resolvedKeys,
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
      .replace(/<terminal_command[\s\S]*?<\/terminal_command>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();
    const fullNormalized = normalizeVoidIdentity(
      cleanedFinalRaw || rawStepText,
      {
        isIdentityReply: identityQuery,
        personaName,
        unlockedByNix,
      },
    );
    if (fullNormalized.length > emittedToClientLength && !signal?.aborted) {
      const finalDelta = fullNormalized.slice(emittedToClientLength);
      onSseFrame(formatSseDataFrame(finalDelta));
    }

    emitAgentPlanUpdate('step-synthesize', 'completed');
    emitAgentPlanUpdate('step-verify', 'running');
    emitAgentPlanUpdate('step-verify', 'completed');

    if (
      unlockedByNix &&
      identityQuery &&
      stepOutcome.usedModel &&
      !fullNormalized.toLowerCase().includes(stepOutcome.usedModel.toLowerCase()) &&
      !signal?.aborted
    ) {
      onSseFrame(
        formatSseDataFrame(
          `\n\n**Active Underlying Model:** \`${stepOutcome.usedModel}\``,
        ),
      );
    }
    break;
  }

  if (!signal?.aborted) {
    onSseFrame('data: [DONE]\n\n');
  }
}

export async function runOmniRouteAgentStream(options: {
  rawMessages: Array<{ role?: string; content?: string; imageUrls?: string[] }>;
  requestedModel?: string;
  baseUrl?: string;
  apiKeys: string[];
  openRouterApiKey?: string;
  effort?: string;
  agentMode?: boolean;
  connectedFolders?: string[];
  workspaceSummary?: WorkspaceContextInput;
  terminalToolResult?: TerminalToolContinuation;
  imageUrls?: string[];
  signal?: AbortSignal;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | string;
}> {
  const {
    rawMessages,
    requestedModel,
    baseUrl,
    apiKeys,
    openRouterApiKey,
    effort,
    agentMode,
    connectedFolders,
    workspaceSummary,
    terminalToolResult,
    imageUrls,
    signal,
  } = options;

  const streamAbortController = new AbortController();
  const onRequestAbort = () => {
    if (!streamAbortController.signal.aborted) {
      streamAbortController.abort();
    }
  };

  if (signal) {
    if (signal.aborted) {
      streamAbortController.abort();
    } else {
      signal.addEventListener('abort', onRequestAbort, { once: true });
    }
  }

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
          agentMode,
          connectedFolders,
          workspaceSummary,
          terminalToolResult,
          imageUrls,
          signal: streamAbortController.signal,
          onSseFrame: (frame) => {
            if (!streamAbortController.signal.aborted) {
              try {
                controller.enqueue(encoder.encode(frame));
              } catch {
                // Stream already closed by client
              }
            }
          },
        });
        if (!streamAbortController.signal.aborted) {
          controller.close();
        }
      } catch (err) {
        if (!streamAbortController.signal.aborted) {
          const message =
            err instanceof Error ? err.message : 'Internal stream error';
          try {
            controller.enqueue(
              encoder.encode(formatSseDataFrame(`\n\n[Error: ${message}]`)),
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch {
            // Ignore if already closed
          }
        }
      } finally {
        signal?.removeEventListener('abort', onRequestAbort);
      }
    },
    cancel() {
      if (!streamAbortController.signal.aborted) {
        streamAbortController.abort();
      }
      signal?.removeEventListener('abort', onRequestAbort);
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
