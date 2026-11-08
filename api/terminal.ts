import {
  authenticateApiRequest,
  authenticationErrorResponse,
} from '../src/lib/server/supabase-auth.js';
import { createVercelHandler } from '../src/lib/server/vercel.js';
import {
  executeApprovedTerminalCommand,
  resolveConnectedFolderPath,
} from '../src/lib/tools/terminal_executor.js';

interface TerminalRequestBody {
  action?: 'allow' | 'deny' | 'skip';
  command?: string;
  cwd?: string;
  connectedFolders?: string[];
}

async function post(req: Request): Promise<Response> {
  try {
    await authenticateApiRequest(req);
    const body = (await req.json()) as TerminalRequestBody;
    const action = body.action ?? 'deny';
    const command = String(body.command ?? '').trim();
    const connectedFolders = Array.isArray(body.connectedFolders)
      ? body.connectedFolders
      : [];
    const resolvedCwd = resolveConnectedFolderPath(connectedFolders, body.cwd);

    if (!command) {
      return Response.json(
        { error: 'Terminal command is required.' },
        { status: 400 },
      );
    }

    // Human-in-the-loop gate: NEVER execute unless action is explicitly 'allow'
    if (action === 'deny') {
      return Response.json({
        ok: false,
        status: 'denied',
        command,
        cwd: resolvedCwd,
        output: 'Command execution rejected by user.',
        exitCode: null,
      });
    }

    if (action === 'skip') {
      return Response.json({
        ok: true,
        status: 'skipped',
        command,
        cwd: resolvedCwd,
        output: 'Command skipped by user.',
        exitCode: null,
      });
    }

    if (action !== 'allow') {
      return Response.json(
        { error: 'Invalid terminal action. Must be allow, deny, or skip.' },
        { status: 400 },
      );
    }

    const result = await executeApprovedTerminalCommand({
      command,
      cwd: resolvedCwd,
      connectedFolders,
    });

    return Response.json({
      ok: result.ok,
      status: result.ok ? 'completed' : 'failed',
      command: result.command,
      cwd: result.cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  } catch (error) {
    const authResponse = authenticationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Terminal execution failed',
      },
      { status: 500 },
    );
  }
}

export default createVercelHandler(post, ['POST']);
