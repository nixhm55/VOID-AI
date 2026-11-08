import { shouldTriggerWebSearch, buildSearchQuery } from './search_engine.js';
import { shouldTriggerImageGeneration } from './image_generator.js';

export type AgentStepTool =
  | 'planner'
  | 'workspace'
  | 'terminal'
  | 'web_search'
  | 'image_gen'
  | 'code_engine'
  | 'verifier';

export type AgentStepStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed';

export interface AgentPlanStep {
  id: string;
  title: string;
  detail?: string;
  tool: AgentStepTool;
  status: AgentStepStatus;
  taskTitle?: string;
}

export type TerminalApprovalStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'skipped';

export interface PendingTerminalCommand {
  id: string;
  command: string;
  cwd?: string;
  explanation?: string;
  status: TerminalApprovalStatus;
  output?: string;
  exitCode?: number | null;
}

export const TERMINAL_COMMAND_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'run_terminal_command',
    description:
      'Propose a terminal shell command to run in the user project directory. Execution will pause for manual human approval via the UI Approval Card before running.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The exact, valid shell command to run (e.g., "pnpm run dev", "npm run build", "npx tsc --noEmit", "git status"). Never include conversational instructions inside the command string.',
        },
        explanation: {
          type: 'string',
          description:
            'Short 1-sentence reason why this command is being proposed.',
        },
      },
      required: ['command'],
    },
  },
} as const;

/**
 * Detects whether Agent Mode should run for this turn (either toggled in UI or via `/agent` command).
 */
export function isAgentModeTrigger(
  rawText: string,
  explicitAgentMode?: boolean,
): boolean {
  if (explicitAgentMode) return true;
  const cleaned = String(rawText ?? '').trim();
  return /^(?:\/agent|@agent)\b/i.test(cleaned);
}

/**
 * Strips `/agent` or `@agent` prefix from the user prompt.
 */
export function cleanAgentModePrompt(rawText: string): string {
  return String(rawText ?? '')
    .replace(/^(?:\/agent|@agent)\s*/i, '')
    .trim();
}

const SPACED_CLI_WORDS = new Set([
  'dev',
  'build',
  'start',
  'test',
  'lint',
  'check',
  'status',
  'install',
  'init',
  'push',
  'pull',
  'fetch',
  'clone',
  'commit',
  'branch',
  'merge',
  'diff',
  'log',
  'serve',
  'preview',
  'clean',
  'typecheck',
  'format',
  'deploy',
  'pnpm',
  'npm',
  'yarn',
  'npx',
  'bun',
  'node',
  'vite',
  'next',
  'git',
  'tsc',
]);

const CLI_LOWERCASE_TOKENS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'bun',
  'node',
  'git',
  'ls',
  'pwd',
  'cat',
  'grep',
  'find',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'go',
  'make',
  'docker',
  'eslint',
  'tsc',
  'pytest',
  'vite',
  'next',
  'run',
  'dev',
  'build',
  'start',
  'test',
  'lint',
  'check',
  'status',
  'install',
  'add',
  'remove',
  'init',
  'push',
  'pull',
  'fetch',
  'commit',
  'branch',
  'checkout',
  'diff',
  'log',
  'serve',
  'preview',
]);

const CONVERSATIONAL_STOP_WORDS = new Set([
  'in',
  'on',
  'at',
  'into',
  'inside',
  'from',
  'with',
  'without',
  'terminal',
  'console',
  'shell',
  'cmd',
  'command',
  'inspect',
  'check',
  'look',
  'tell',
  'show',
  'see',
  'find',
  'my',
  'the',
  'this',
  'that',
  'folder',
  'project',
  'file',
  'files',
  'directory',
  'workspace',
  'like',
  'normal',
  'inspection',
  'deeply',
  'dont',
  "don't",
  'do',
  'not',
  'want',
  'need',
  'result',
  'results',
  'minutes',
  'minute',
  'seconds',
  'take',
  'more',
  'time',
  'just',
  'small',
  'only',
  'anything',
  'please',
  'bro',
  'and',
  'then',
  'also',
  'so',
  'because',
  'if',
  'there',
  'have',
  'has',
  'any',
  'error',
  'errors',
  'bug',
  'bugs',
  'koode',
  'onnu',
  'aakk',
  'aakku',
  'adikk',
]);

/**
 * Collapses spaced-out voice-dictated letters (e.g., "pnpm Run d e v" -> "pnpm run dev")
 * and strips any trailing conversational prose ("in terminal inspect my folder...").
 */
export function normalizeAndCleanTerminalCommand(rawInput: string): string {
  let text = String(rawInput ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  text = text.replace(
    /\b([a-zA-Z])(?:\s+([a-zA-Z])){2,7}\b/g,
    (fullMatch) => {
      const joined = fullMatch.replace(/\s+/g, '').toLowerCase();
      if (SPACED_CLI_WORDS.has(joined)) {
        return joined;
      }
      return fullMatch;
    },
  );

  text = text
    .replace(/\b(?:p\s*n\s*p\s*m|pnp\s+m|pn\s+pm)\b/gi, 'pnpm')
    .replace(/\b(?:n\s*p\s*m|n\s+pm)\b/gi, 'npm')
    .replace(/\b(?:n\s*p\s*x)\b/gi, 'npx')
    .replace(/\brun\s+d\s*e\s*v\b/gi, 'run dev')
    .replace(/\brun\s+b\s*u\s*i\s*l\s*d\b/gi, 'run build')
    .replace(/\brun\s+t\s*e\s*s\s*t\b/gi, 'run test')
    .replace(/\brun\s+s\s*t\s*a\s*r\s*t\b/gi, 'run start')
    .replace(/\brun\s+l\s*i\s*n\s*t\b/gi, 'run lint');

  if (/[&|;]/.test(text) && !/\bin\s+terminal\b|\binspect\s+my\b/i.test(text)) {
    return text
      .split(/\s*(&&|\|\||[|;])\s*/)
      .map((part) => {
        if (/^(&&|\|\||[|;])$/.test(part)) return ` ${part} `;
        return normalizeSingleCommandTokens(part);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalizeSingleCommandTokens(text);
}

function normalizeSingleCommandTokens(segment: string): string {
  const strippedBoundary = segment
    .split(
      /\b(?:in\s+(?:the\s+)?terminal|on\s+terminal|in\s+cmd|in\s+shell|inspect\s+my|and\s+inspect|and\s+tell|and\s+check|like\s+normal|don'?t\s+(?:inspect|deeply|take|edit)|i\s+want\s+result|so\s+don'?t|just\s+small|please\s+check)\b/i,
    )[0]
    .trim();

  const rawTokens = strippedBoundary.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return '';

  const firstLower = rawTokens[0].toLowerCase();
  const normalizedTokens: string[] = [
    CLI_LOWERCASE_TOKENS.has(firstLower) ? firstLower : rawTokens[0],
  ];

  if (/^(?:pnpm|npm|yarn|bun)$/.test(firstLower)) {
    const secondLower = (rawTokens[1] ?? '').toLowerCase();
    if (!secondLower) return firstLower;

    if (secondLower === 'run') {
      normalizedTokens.push('run');
      const scriptName = (rawTokens[2] ?? '').toLowerCase();
      if (scriptName && !CONVERSATIONAL_STOP_WORDS.has(scriptName)) {
        normalizedTokens.push(scriptName);
        for (let i = 3; i < rawTokens.length; i += 1) {
          const tok = rawTokens[i];
          if (tok.startsWith('-')) {
            normalizedTokens.push(tok);
          } else {
            break;
          }
        }
      }
      return normalizedTokens.join(' ');
    }

    if (
      /^(?:dev|build|start|test|lint|preview|typecheck|check|format|serve)$/.test(
        secondLower,
      )
    ) {
      normalizedTokens.push(secondLower);
      for (let i = 2; i < rawTokens.length; i += 1) {
        const tok = rawTokens[i];
        if (tok.startsWith('-')) {
          normalizedTokens.push(tok);
        } else {
          break;
        }
      }
      return normalizedTokens.join(' ');
    }

    if (
      /^(?:install|i|add|remove|uninstall|update|up|ls|list|init|create)$/.test(
        secondLower,
      )
    ) {
      normalizedTokens.push(secondLower);
      for (let i = 2; i < rawTokens.length; i += 1) {
        const tok = rawTokens[i];
        const tokLower = tok.toLowerCase();
        if (CONVERSATIONAL_STOP_WORDS.has(tokLower)) break;
        normalizedTokens.push(tok);
      }
      return normalizedTokens.join(' ');
    }
  }

  if (firstLower === 'git') {
    const sub = (rawTokens[1] ?? '').toLowerCase();
    if (!sub) return 'git status';
    normalizedTokens.push(CLI_LOWERCASE_TOKENS.has(sub) ? sub : rawTokens[1]);
    for (let i = 2; i < rawTokens.length; i += 1) {
      const tok = rawTokens[i];
      const tokLower = tok.toLowerCase();
      if (CONVERSATIONAL_STOP_WORDS.has(tokLower)) break;
      normalizedTokens.push(tok);
    }
    return normalizedTokens.join(' ');
  }

  for (let i = 1; i < rawTokens.length; i += 1) {
    const tok = rawTokens[i];
    const tokLower = tok.toLowerCase().replace(/[,.;:!?]+$/, '');
    if (CONVERSATIONAL_STOP_WORDS.has(tokLower)) {
      break;
    }
    normalizedTokens.push(
      CLI_LOWERCASE_TOKENS.has(tokLower) ? tokLower : tok,
    );
  }

  return normalizedTokens.join(' ');
}

/**
 * Produces a clean, Gemini-style reasoning/action header title
 * (e.g., "Thinking it through", "Inspecting files for errors", "Editing UI", "Running terminal command")
 * and NEVER echoes raw user chat text like "Hi" or Malayalam sentences.
 */
export function deriveAgentTaskTitle(rawPrompt: string): string {
  const cleaned = cleanAgentModePrompt(rawPrompt)
    .replace(/\[TERMINAL_TOOL_RESULT[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Thinking it through';

  const lower = cleaned.toLowerCase();

  if (shouldTriggerImageGeneration(cleaned)) {
    return 'Generating image';
  }

  if (
    /\b(?:inspect|check|scan|look\s+at)\b[\s\S]{0,40}\b(?:file|files|code|folder|project|error|errors|bug|bugs)\b/i.test(
      lower,
    )
  ) {
    if (/\b(?:error|errors|bug|bugs|issue|issues)\b/i.test(lower)) {
      return 'Inspecting files for errors';
    }
    return 'Inspecting project files';
  }

  if (/\b(?:terminal|shell|command|child_process|cli|pnpm|npm|git)\b/i.test(lower)) {
    if (/\b(?:ui|card|approval|feature|implement|build|add)\b/i.test(lower)) {
      return 'Building terminal command execution';
    }
    return 'Running terminal command';
  }

  if (
    /\b(?:change|switch|replace|update|modify|convert)\b[\s\S]{0,35}\b(?:ai|model|llm|agent|provider)\b/i.test(
      lower,
    )
  ) {
    return 'Updating AI configuration';
  }

  if (
    /\b(?:edit|update|change|modify|redesign|improve|fix|style)\b[\s\S]{0,30}\b(?:ui|interface|layout|design|component|button|card|font|theme|screen|sidebar)\b/i.test(
      lower,
    )
  ) {
    return 'Editing UI';
  }

  if (
    /\b(?:fix|debug|resolve|repair)\b[\s\S]{0,30}\b(?:error|errors|bug|bugs|issue|crash|problem)\b/i.test(
      lower,
    )
  ) {
    return 'Fixing project issues';
  }

  if (/\b(?:research|compare|analyze|investigate|benchmark)\b/i.test(lower)) {
    return 'Researching & analyzing';
  }

  // Default to Gemini's clean "Thinking it through" instead of echoing raw user text
  return 'Thinking it through';
}

/**
 * Determines whether the user's goal involves inspecting local files, checking for errors,
 * or running a terminal command in the connected project folder.
 */
export function isWorkspaceOrTerminalTask(
  userGoal: string,
  connectedFolders?: string[],
): {
  needsWorkspaceInspection: boolean;
  needsTerminalCommand: boolean;
  suggestedCommand: string | null;
  commandExplanation: string;
} {
  const cleaned = cleanAgentModePrompt(userGoal);

  // Never treat short greetings ("hi", "hello", "hey") or image generation requests as workspace/terminal tasks!
  if (
    shouldTriggerImageGeneration(cleaned) ||
    /^(?:hi|hello|hey|hola|namaskaram|sup|yo|good\s+(?:morning|afternoon|evening)|how\s+are\s+you)\b[!.?\s]*$/i.test(
      cleaned,
    )
  ) {
    return {
      needsWorkspaceInspection: false,
      needsTerminalCommand: false,
      suggestedCommand: null,
      commandExplanation: '',
    };
  }

  const normalizedPrompt = cleaned.replace(
    /\b([a-zA-Z])(?:\s+([a-zA-Z])){2,7}\b/g,
    (m) => {
      const joined = m.replace(/\s+/g, '').toLowerCase();
      return SPACED_CLI_WORDS.has(joined) ? joined : m;
    },
  );

  const lower = normalizedPrompt.toLowerCase();
  const hasConnectedFolder =
    Array.isArray(connectedFolders) && connectedFolders.length > 0;

  // 1. Check backtick-wrapped command
  const backtickMatch = /`([^`\n]{2,120})`/.exec(normalizedPrompt);
  if (
    backtickMatch?.[1] &&
    /^(?:npm|pnpm|yarn|npx|bun|node|git|ls|pwd|python3?|pip|cargo|go|tsc|eslint|pytest|vite|next)\b/i.test(
      backtickMatch[1].trim(),
    )
  ) {
    const cmd = normalizeAndCleanTerminalCommand(backtickMatch[1].trim());
    if (cmd) {
      return {
        needsWorkspaceInspection: true,
        needsTerminalCommand: true,
        suggestedCommand: cmd,
        commandExplanation: `Execute \`${cmd}\` in the selected workspace`,
      };
    }
  }

  // 2. Check explicit CLI command patterns in natural language / voice dictation
  const explicitCliMatch =
    /\b((?:pnpm|npm|yarn|npx|bun)\s+(?:run\s+)?(?:dev|build|start|test|lint|typecheck|check|preview|install|i|add|ls)|git\s+(?:status|branch|log|diff|pull|push|fetch)|npx\s+tsc(?:\s+--noEmit)?|ls(?:\s+-[a-zA-Z]+)?|pwd)\b/i.exec(
      normalizedPrompt,
    );

  if (explicitCliMatch?.[1]) {
    const cmd = normalizeAndCleanTerminalCommand(explicitCliMatch[1]);
    if (cmd) {
      return {
        needsWorkspaceInspection: true,
        needsTerminalCommand: true,
        suggestedCommand: cmd,
        commandExplanation: `Run \`${cmd}\` in the selected project directory`,
      };
    }
  }

  // 3. Fallback general "run <cmd>" matcher, cleaned via normalizeAndCleanTerminalCommand
  const explicitRunMatch =
    /\b(?:run|execute)\s+(?:the\s+command\s+)?["'`]?((?:npm|pnpm|yarn|npx|bun|node|git|ls|pwd|cat|grep|find|python|python3|pip|cargo|go|make|docker|eslint|tsc|pytest|vite|next)\b[^"'`\n.;,]{0,80})["'`]?/i.exec(
      normalizedPrompt,
    );

  if (explicitRunMatch?.[1]) {
    const cmd = normalizeAndCleanTerminalCommand(explicitRunMatch[1]);
    if (cmd) {
      return {
        needsWorkspaceInspection: true,
        needsTerminalCommand: true,
        suggestedCommand: cmd,
        commandExplanation: `Run \`${cmd}\` in the project directory as requested`,
      };
    }
  }

  const mentionsFileOrErrorInspection =
    /\b(?:inspect|check|scan|find|debug|verify|test|lint|build|compile)\b[\s\S]{0,50}\b(?:file|files|folder|project|code|error|errors|bug|bugs|syntax|types|status|directory)\b/i.test(
      lower,
    ) ||
    /\b(?:any\s+error|small\s+error|small\s+errors|is\s+there\s+have\s+any\s+error|git\s+status|list\s+files)\b/i.test(
      lower,
    );

  if (mentionsFileOrErrorInspection || hasConnectedFolder) {
    if (/\bgit\s+status\b/i.test(lower)) {
      return {
        needsWorkspaceInspection: true,
        needsTerminalCommand: true,
        suggestedCommand: 'git status --short && git branch --show-current',
        commandExplanation: 'Check current Git status and active branch',
      };
    }

    if (
      /\b(?:error|errors|bug|bugs|inspect|check|lint|typecheck|compile|build)\b/i.test(
        lower,
      )
    ) {
      return {
        needsWorkspaceInspection: true,
        needsTerminalCommand: true,
        suggestedCommand: 'ls -la',
        commandExplanation:
          'Inspect files and verify syntax or build status in the connected folder',
      };
    }

    return {
      needsWorkspaceInspection: true,
      needsTerminalCommand: false,
      suggestedCommand: null,
      commandExplanation: '',
    };
  }

  return {
    needsWorkspaceInspection: false,
    needsTerminalCommand: false,
    suggestedCommand: null,
    commandExplanation: '',
  };
}

/**
 * Chooses the best diagnostic shell command based on the actual files discovered in the workspace,
 * and adapts package manager commands (`pnpm` vs `npm` vs `yarn`) to match the project's lockfile and scripts.
 */
export function selectDiagnosticCommandForWorkspace(
  userGoal: string,
  workspaceFiles: string[],
  fallbackCommand?: string | null,
): { command: string; explanation: string } {
  const hasPnpmLock = workspaceFiles.some(
    (f) => f === 'pnpm-lock.yaml' || f.endsWith('/pnpm-lock.yaml'),
  );
  const hasYarnLock = workspaceFiles.some(
    (f) => f === 'yarn.lock' || f.endsWith('/yarn.lock'),
  );
  const hasPackageJson = workspaceFiles.some(
    (f) => f === 'package.json' || f.endsWith('/package.json'),
  );
  const hasTsConfig = workspaceFiles.some(
    (f) => f === 'tsconfig.json' || f.endsWith('/tsconfig.json'),
  );

  const preferredPkgManager = hasPnpmLock
    ? 'pnpm'
    : hasYarnLock
      ? 'yarn'
      : 'npm';

  if (fallbackCommand && fallbackCommand !== 'ls -la') {
    const cleaned = normalizeAndCleanTerminalCommand(fallbackCommand);
    if (
      /^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|build|start|test|lint)\b/i.test(
        cleaned,
      ) &&
      workspaceFiles.length > 0 &&
      !hasPackageJson
    ) {
      const pyFiles = workspaceFiles.filter((f) => f.endsWith('.py'));
      if (pyFiles.length > 0) {
        return {
          command: `python3 -m py_compile ${pyFiles.slice(0, 4).join(' ')}`,
          explanation: `No package.json found; verifying Python files (${pyFiles.slice(0, 2).join(', ')}) instead`,
        };
      }
      return {
        command: 'ls -la',
        explanation:
          'Inspecting project directory contents (no package.json found in root)',
      };
    }

    const pkgMatch = /^(?:pnpm|npm|yarn)\s+(.+)$/i.exec(cleaned);
    if (pkgMatch && hasPackageJson) {
      const rest = pkgMatch[1].trim();
      const adapted = `${preferredPkgManager} ${rest}`;
      return {
        command: adapted,
        explanation: `Run \`${adapted}\` in the selected project workspace`,
      };
    }

    return {
      command: cleaned || fallbackCommand,
      explanation: `Run \`${cleaned || fallbackCommand}\` in the selected workspace`,
    };
  }

  const lower = userGoal.toLowerCase();
  const pyFiles = workspaceFiles.filter((f) => f.endsWith('.py'));
  const jsFiles = workspaceFiles.filter(
    (f) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'),
  );

  if (/\b(?:error|errors|bug|bugs|inspect|check|lint|build)\b/i.test(lower)) {
    if (hasTsConfig) {
      return {
        command: 'npx tsc --noEmit',
        explanation:
          'Run a fast TypeScript check to detect any syntax or type errors without modifying files',
      };
    }
    if (pyFiles.length > 0) {
      const targetPy = pyFiles.slice(0, 4).join(' ');
      return {
        command: `python3 -m py_compile ${targetPy}`,
        explanation:
          'Check Python source files for syntax errors without modifying any files',
      };
    }
    if (jsFiles.length > 0) {
      return {
        command: `node --check ${jsFiles[0]}`,
        explanation: `Verify JavaScript syntax in ${jsFiles[0]} without editing anything`,
      };
    }
    if (hasPackageJson) {
      return {
        command: `${preferredPkgManager} run build`,
        explanation: 'Verify project build and check for errors in folder',
      };
    }
  }

  return {
    command: 'ls -la',
    explanation: 'List and verify files in the connected project directory',
  };
}

/**
 * Extracts a `<tool_call>` or `<terminal_command>` block emitted inline by the LLM,
 * automatically normalizing any command inside it.
 */
export function extractInlineTerminalToolCall(rawText: string): {
  command: string;
  explanation?: string;
  cleanedText: string;
} | null {
  const xmlMatch =
    /<terminal_command(?:\s+explanation="([^"]*)")?\s*>([\s\S]*?)<\/terminal_command>/i.exec(
      rawText,
    );
  if (xmlMatch?.[2]?.trim()) {
    const cleanedText = rawText.replace(xmlMatch[0], '').trim();
    const normalizedCmd = normalizeAndCleanTerminalCommand(xmlMatch[2].trim());
    if (normalizedCmd) {
      return {
        command: normalizedCmd,
        explanation: xmlMatch[1]?.trim() || undefined,
        cleanedText,
      };
    }
  }

  const toolCallMatch = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i.exec(
    rawText,
  );
  if (toolCallMatch?.[1]) {
    try {
      const parsed = JSON.parse(toolCallMatch[1]) as {
        name?: string;
        arguments?: { command?: string; explanation?: string };
        command?: string;
        explanation?: string;
      };
      const rawCmd =
        parsed?.arguments?.command?.trim() ?? parsed?.command?.trim() ?? '';
      const normalizedCmd = normalizeAndCleanTerminalCommand(rawCmd);
      if (normalizedCmd) {
        const cleanedText = rawText.replace(toolCallMatch[0], '').trim();
        return {
          command: normalizedCmd,
          explanation:
            parsed?.arguments?.explanation?.trim() ??
            parsed?.explanation?.trim(),
          cleanedText,
        };
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return null;
}

/**
 * Builds a structured multi-step autonomous execution plan tailored to the user's goal.
 * Never echoes raw user sentences inside step titles.
 */
export function buildInitialAgentPlan(
  userGoal: string,
  hasUploadedImages = false,
  options?: {
    connectedFolders?: string[];
    isResumeAfterTerminal?: boolean;
  },
): {
  taskTitle: string;
  steps: AgentPlanStep[];
  needsWebResearch: boolean;
  needsImageGen: boolean;
  needsWorkspaceInspection: boolean;
  needsTerminalCommand: boolean;
  suggestedCommand: string | null;
  searchQuery: string;
} {
  const cleanedGoal = cleanAgentModePrompt(userGoal);
  const taskTitle = deriveAgentTaskTitle(cleanedGoal);
  const needsImageGen = shouldTriggerImageGeneration(cleanedGoal);

  const wsIntent = needsImageGen
    ? {
        needsWorkspaceInspection: false,
        needsTerminalCommand: false,
        suggestedCommand: null,
        commandExplanation: '',
      }
    : isWorkspaceOrTerminalTask(cleanedGoal, options?.connectedFolders);

  const needsWebResearch =
    !needsImageGen &&
    !hasUploadedImages &&
    !wsIntent.needsWorkspaceInspection &&
    (shouldTriggerWebSearch(cleanedGoal) ||
      /\b(?:research|compare|investigate|latest|benchmark|news|roadmap|report|best|top)\b/i.test(
        cleanedGoal,
      ));

  const searchQuery = needsWebResearch
    ? buildSearchQuery(cleanedGoal, [{ role: 'user', content: cleanedGoal }])
    : '';

  const folderLabel =
    !needsImageGen &&
    options?.connectedFolders &&
    options.connectedFolders.length > 0
      ? options.connectedFolders[0]
      : null;

  const steps: AgentPlanStep[] = [
    {
      id: 'step-plan',
      title: folderLabel
        ? `Analyzing task & ${folderLabel} workspace`
        : 'Analyzing request & context',
      detail: hasUploadedImages
        ? 'Inspecting visual input and requirements'
        : 'Scoping steps and constraints',
      tool: 'planner',
      status: 'pending',
      taskTitle,
    },
  ];

  if (wsIntent.needsWorkspaceInspection) {
    steps.push({
      id: 'step-workspace',
      title: folderLabel
        ? `Inspecting files in ${folderLabel}`
        : 'Inspecting project files & structure',
      detail: 'Scanning source files for syntax, logic, or configuration issues',
      tool: 'workspace',
      status: 'pending',
      taskTitle,
    });
  }

  if (wsIntent.needsTerminalCommand) {
    steps.push({
      id: 'step-terminal',
      title: options?.isResumeAfterTerminal
        ? 'Processed terminal command verification'
        : 'Verifying via terminal command',
      detail: options?.isResumeAfterTerminal
        ? 'Incorporating user decision and terminal output'
        : 'Awaiting manual user approval to execute command',
      tool: 'terminal',
      status: options?.isResumeAfterTerminal ? 'completed' : 'pending',
      taskTitle,
    });
  }

  if (needsWebResearch && searchQuery) {
    steps.push({
      id: 'step-search',
      title: `Searching web for "${searchQuery.slice(0, 48)}"`,
      detail: 'Gathering live technical references and sources',
      tool: 'web_search',
      status: 'pending',
      taskTitle,
    });
  }

  if (needsImageGen) {
    steps.push({
      id: 'step-image',
      title: 'Generating visual asset',
      detail: 'Rendering high-resolution image via OmniRoute',
      tool: 'image_gen',
      status: 'pending',
      taskTitle,
    });
  }

  steps.push({
    id: 'step-synthesize',
    title:
      hasUploadedImages && !needsImageGen
        ? 'Running multimodal vision analysis'
        : 'Synthesizing solution & response',
    detail: 'Formulating clear, verified output',
    tool: 'code_engine',
    status: 'pending',
    taskTitle,
  });

  steps.push({
    id: 'step-verify',
    title: 'Finalizing & verifying output',
    detail: 'Checking accuracy and completeness',
    tool: 'verifier',
    status: 'pending',
    taskTitle,
  });

  return {
    taskTitle,
    steps,
    needsWebResearch,
    needsImageGen,
    needsWorkspaceInspection: wsIntent.needsWorkspaceInspection,
    needsTerminalCommand: wsIntent.needsTerminalCommand,
    suggestedCommand: wsIntent.suggestedCommand,
    searchQuery,
  };
}

/**
 * Formats an SSE frame carrying the current Agent Mode step list for real-time UI updates.
 */
export function formatAgentStepSseFrame(
  steps: AgentPlanStep[],
  taskTitle?: string,
): string {
  const payload = JSON.stringify({
    agentSteps: steps,
    ...(taskTitle ? { agentTaskTitle: taskTitle } : {}),
  });
  return `data: ${payload}\n\n`;
}

/**
 * Formats an SSE frame carrying a PendingTerminalCommand that pauses the agent for human approval.
 */
export function formatPendingCommandSseFrame(
  pendingCommand: PendingTerminalCommand,
): string {
  const payload = JSON.stringify({
    pendingCommand,
  });
  return `data: ${payload}\n\n`;
}

/**
 * Builds the specialized system directive for Agent Mode, including workspace context
 * and human-in-the-loop terminal command calling rules.
 */
export function buildAgentModeSystemDirective(
  userGoal: string,
  workspaceContext = '',
  allowTerminalProposal = true,
): string {
  const toolInstruction = allowTerminalProposal
    ? `4. SECURE TERMINAL EXECUTION (HUMAN-IN-THE-LOOP):
   - Never claim you have already executed a shell command unless its output appears in [TERMINAL_TOOL_RESULT].
   - If running a terminal command (such as checking syntax/types, listing files, checking git status, running dev/build/tests) would help verify or fulfill the user's request, emit a single block at the start of your response containing ONLY the valid shell command (no conversational text inside the command):
     <terminal_command explanation="Brief reason">exact shell command here</terminal_command>
   - When you emit <terminal_command>...</terminal_command>, the system will automatically pause and present the Approval Card UI (Allow / Deny / Edit / Skip) to the user.`
    : `4. The user has already responded to the terminal command approval card (see [TERMINAL_TOOL_RESULT] if present). Do NOT emit another <terminal_command> tag; instead, use the workspace files and terminal result to provide a clear, concise final answer right away.`;

  return `[AUTONOMOUS AGENT MODE ACTIVE]
You are operating in Agent Mode — a thoughtful, multi-step task execution engine with access to the user's connected project folder and human-in-the-loop terminal execution.
For the user's objective ("${cleanAgentModePrompt(userGoal)}"), follow this discipline:
1. Focus directly on what the user asked (e.g., if they ask for a quick check of small errors without editing files, give a concise, accurate inspection of the actual files without unnecessary fluff).
2. When writing code or architecture, provide complete, clean, production-ready implementations without placeholders.
3. Combine any inspected workspace files or live web research context seamlessly into your synthesis.
${toolInstruction}${workspaceContext ? `\n\n${workspaceContext}` : ''}`;
}
