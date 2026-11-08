import { exec, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeAndCleanTerminalCommand } from './agent_mode.js';

export interface TerminalExecutionResult {
  ok: boolean;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  output: string;
  exitCode: number | null;
  durationMs: number;
}

export interface WorkspaceInspectionSummary {
  resolvedPath: string;
  folderName: string;
  files: string[];
  fileSnippets: Array<{
    relativePath: string;
    content: string;
    lineCount: number;
  }>;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.vercel',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.html',
  '.md',
  '.py',
  '.sh',
  '.yml',
  '.yaml',
  '.toml',
  '.sql',
  '.env.example',
]);

/**
 * Builds an enriched PATH so commands like `pnpm`, `npm`, `node`, `npx`, `git`, `python3`
 * always resolve cleanly even when launched from a GUI/Vite server process on macOS.
 */
function buildEnrichedShellPath(cwd: string): string {
  const home = os.homedir();
  const extraDirs = [
    path.join(cwd, 'node_modules', '.bin'),
    path.join(process.cwd(), 'node_modules', '.bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.pnpm-global', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
  ];

  // Also include latest nvm node bin if present
  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir).sort();
      if (versions.length > 0) {
        extraDirs.unshift(
          path.join(nvmDir, versions[versions.length - 1], 'bin'),
        );
      }
    }
  } catch {
    // Ignore
  }

  const currentPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  return [...extraDirs, currentPath].join(path.delimiter);
}

/**
 * Resolves a connected folder name (e.g. "VOID DOWNLOADER", "AI") or path
 * to a real directory on the local filesystem.
 */
export function resolveConnectedFolderPath(
  connectedFolders?: string[],
  requestedCwd?: string,
): string {
  const fallbackCwd = process.cwd();

  const candidatesToTry: string[] = [];
  if (requestedCwd && requestedCwd.trim()) {
    candidatesToTry.push(requestedCwd.trim());
  }
  if (Array.isArray(connectedFolders)) {
    for (const folder of connectedFolders) {
      if (folder && folder.trim()) {
        candidatesToTry.push(folder.trim());
      }
    }
  }

  if (candidatesToTry.length === 0) {
    return fallbackCwd;
  }

  const homeDir = os.homedir();
  const searchRoots = [
    fallbackCwd,
    path.dirname(fallbackCwd),
    path.dirname(path.dirname(fallbackCwd)),
    path.join(homeDir, 'Works'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Downloads'),
    homeDir,
  ];

  for (const rawCandidate of candidatesToTry) {
    const resolvedDirect = path.isAbsolute(rawCandidate)
      ? rawCandidate
      : path.resolve(fallbackCwd, rawCandidate);
    try {
      if (
        fs.existsSync(resolvedDirect) &&
        fs.statSync(resolvedDirect).isDirectory()
      ) {
        return resolvedDirect;
      }
    } catch {
      // Ignore permission errors
    }

    if (
      path.basename(fallbackCwd).toLowerCase() === rawCandidate.toLowerCase()
    ) {
      return fallbackCwd;
    }

    const found = findDirectoryByName(searchRoots, rawCandidate, 3);
    if (found) {
      return found;
    }
  }

  return fallbackCwd;
}

function findDirectoryByName(
  roots: string[],
  targetName: string,
  maxDepth: number,
): string | null {
  const normalizedTarget = targetName.trim().toLowerCase();
  const visited = new Set<string>();

  const searchDir = (currentDir: string, depth: number): string | null => {
    if (depth > maxDepth) return null;
    let realCurrent: string;
    try {
      realCurrent = fs.realpathSync(currentDir);
    } catch {
      return null;
    }
    if (visited.has(realCurrent)) return null;
    visited.add(realCurrent);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(realCurrent, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      if (entry.name.toLowerCase() === normalizedTarget) {
        return path.join(realCurrent, entry.name);
      }
    }

    if (depth < maxDepth) {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        const match = searchDir(path.join(realCurrent, entry.name), depth + 1);
        if (match) return match;
      }
    }

    return null;
  };

  for (const root of roots) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
        if (path.basename(root).toLowerCase() === normalizedTarget) {
          return root;
        }
        const res = searchDir(root, 1);
        if (res) return res;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Collects a lightweight file tree & key source file snippets from the connected project folder
 * so Agent Mode can genuinely inspect files, find errors, and understand the project structure.
 */
export function inspectConnectedWorkspace(
  connectedFolders?: string[],
  userPrompt = '',
): WorkspaceInspectionSummary {
  const resolvedPath = resolveConnectedFolderPath(connectedFolders);
  const folderName =
    (connectedFolders && connectedFolders[0]) || path.basename(resolvedPath);

  const files: string[] = [];
  const candidateFiles: Array<{
    fullPath: string;
    relativePath: string;
    score: number;
    size: number;
  }> = [];

  const promptLower = userPrompt.toLowerCase();

  const walk = (dir: string, relPrefix = '', depth = 0) => {
    if (depth > 3 || files.length >= 80) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= 80) break;
      if (entry.name === '.DS_Store') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) {
          files.push(`${relPath}/`);
          walk(fullPath, relPath, depth + 1);
        }
      } else if (entry.isFile()) {
        files.push(relPath);
        const ext = path.extname(entry.name).toLowerCase();
        if (
          TEXT_EXTENSIONS.has(ext) ||
          entry.name === 'package.json' ||
          entry.name === 'README.md'
        ) {
          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            stat = null;
          }
          if (stat && stat.size > 0 && stat.size <= 64_000) {
            let score = 1;
            const nameLower = entry.name.toLowerCase();
            if (promptLower.includes(nameLower)) score += 10;
            if (
              nameLower === 'package.json' ||
              nameLower.startsWith('app.') ||
              nameLower.startsWith('main.') ||
              nameLower.startsWith('index.') ||
              nameLower.startsWith('server.')
            ) {
              score += 5;
            }
            if (depth === 0 || depth === 1) score += 2;
            candidateFiles.push({
              fullPath,
              relativePath: relPath,
              score,
              size: stat.size,
            });
          }
        }
      }
    }
  };

  walk(resolvedPath);

  candidateFiles.sort((a, b) => b.score - a.score);
  const fileSnippets: WorkspaceInspectionSummary['fileSnippets'] = [];
  let totalChars = 0;
  const MAX_TOTAL_CHARS = 12_000;

  for (const item of candidateFiles.slice(0, 7)) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    try {
      const raw = fs.readFileSync(item.fullPath, 'utf-8');
      const lines = raw.split('\n');
      const snippet = raw.slice(0, Math.min(raw.length, 2800));
      totalChars += snippet.length;
      fileSnippets.push({
        relativePath: item.relativePath,
        content: snippet,
        lineCount: lines.length,
      });
    } catch {
      // Ignore unreadable files
    }
  }

  return {
    resolvedPath,
    folderName,
    files,
    fileSnippets,
  };
}

/**
 * Executes a user-approved terminal command inside the resolved project directory.
 * - Normalizes any accidental voice-dictation typos or trailing prose before running.
 * - Handles long-running dev server commands (`pnpm run dev`, `npm run dev`, `vite`, `next dev`)
 *   with a bounded startup probe so they never hang the chat flow.
 */
export function executeApprovedTerminalCommand(options: {
  command: string;
  cwd?: string;
  connectedFolders?: string[];
  timeoutMs?: number;
}): Promise<TerminalExecutionResult> {
  const {
    command: rawCommand,
    cwd,
    connectedFolders,
    timeoutMs = 18_000,
  } = options;

  const resolvedCwd = resolveConnectedFolderPath(connectedFolders, cwd);
  const cleanedCommand =
    normalizeAndCleanTerminalCommand(rawCommand) || rawCommand.trim();
  const enrichedPath = buildEnrichedShellPath(resolvedCwd);
  const startedAt = Date.now();

  const isDevServerCommand =
    /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b|\b(?:vite|next)\s+dev\b/i.test(
      cleanedCommand,
    );

  // For dev server commands (like `pnpm run dev` / `npm run dev`), run a 3.5s startup verification probe
  // so we capture whether the server starts cleanly or throws a startup error without hanging forever!
  if (isDevServerCommand) {
    return new Promise((resolve) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let settled = false;

      const child = spawn(cleanedCommand, {
        cwd: resolvedCwd,
        shell: true,
        detached: true,
        env: {
          ...process.env,
          PATH: enrichedPath,
          FORCE_COLOR: '0',
          CI: 'true',
        },
      });

      const finish = (timedOutAfterReady: boolean, exitCode: number | null) => {
        if (settled) return;
        settled = true;
        try {
          if (child.pid) {
            process.kill(-child.pid, 'SIGTERM');
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore
          }
        }

        const durationMs = Date.now() - startedAt;
        const cleanStdout = stdoutBuf.trimEnd();
        const cleanStderr = stderrBuf.trimEnd();
        const combined = [cleanStdout, cleanStderr]
          .filter(Boolean)
          .join('\n')
          .trim();

        const hasFatalError =
          /\b(?:ERR_|error|Error:|failed|Cannot find|command not found|ELIFECYCLE)\b/.test(
            combined,
          ) && !/\b0 errors\b/i.test(combined);

        const ok = timedOutAfterReady ? !hasFatalError : exitCode === 0;

        resolve({
          ok,
          command: cleanedCommand,
          cwd: resolvedCwd,
          stdout: cleanStdout,
          stderr: cleanStderr,
          output:
            combined ||
            (ok
              ? `Dev server command "${cleanedCommand}" verified cleanly with no startup errors.`
              : `Command "${cleanedCommand}" exited with code ${exitCode ?? 1}.`),
          exitCode: ok ? 0 : exitCode ?? 1,
          durationMs,
        });
      };

      const probeTimer = setTimeout(() => {
        finish(true, 0);
      }, 3800);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8');
        if (
          /Local:\s+http|ready in \d+|listening on|started server on/i.test(
            stdoutBuf,
          )
        ) {
          clearTimeout(probeTimer);
          finish(true, 0);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        clearTimeout(probeTimer);
        stderrBuf += `\n${err.message}`;
        finish(false, 1);
      });

      child.on('close', (code) => {
        clearTimeout(probeTimer);
        finish(false, code ?? 0);
      });
    });
  }

  return new Promise((resolve) => {
    exec(
      cleanedCommand,
      {
        cwd: resolvedCwd,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: enrichedPath,
          FORCE_COLOR: '0',
          CI: 'true',
        },
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const cleanStdout = String(stdout ?? '').trimEnd();
        const cleanStderr = String(stderr ?? '').trimEnd();
        const combined = [cleanStdout, cleanStderr]
          .filter(Boolean)
          .join('\n')
          .trim();

        const exitCode =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code ?? 1)
            : error
              ? 1
              : 0;

        resolve({
          ok: !error,
          command: cleanedCommand,
          cwd: resolvedCwd,
          stdout: cleanStdout,
          stderr: cleanStderr,
          output:
            combined ||
            (error
              ? error.message || 'Command failed with no output.'
              : 'Command completed successfully (no output).'),
          exitCode,
          durationMs,
        });
      },
    );
  });
}
