import {
  streamChatCompletion,
  type StreamChatMessage,
} from './chat-stream';

export interface SpeculativeSnapshot {
  draftText: string;
  normalizedDraft: string;
  replyText: string;
  complete: boolean;
  updatedAt: number;
}

interface ActivePreThinkRun {
  normalizedDraft: string;
  draftText: string;
  controller: AbortController;
  promise: Promise<string>;
  partialText: string;
}

/**
 * Invisible Background Speculative Pre-Thinking Engine
 *
 * Schedule while user is actively typing/dictating:
 * - Cycles 1, 2, 3:
 *     Think for up to 3 seconds (3000ms), then pause for 2 seconds (2000ms).
 * - Cycle 4+ (after 3 cycles):
 *     Pause for 5 seconds (5000ms), then think for up to 3 seconds (3000ms).
 *
 * Completely invisible in the UI — never triggers any visible loader or state while typing.
 * Evolves its speculative synthesis as the draft changes (e.g. "hi" -> "hi i am nisam" -> "hi i am nisam are you fine")
 * so outdated partial replies are superseded by the latest text.
 */
export class SpeculativePreThinkEngine {
  private currentDraft = '';
  private currentModel = 'void-combo';
  private currentHistory: StreamChatMessage[] = [];

  private cycleCount = 0;
  private isLoopRunning = false;
  private loopTimer: number | null = null;
  private lastAnalyzedNormalized = '';

  private snapshots = new Map<string, SpeculativeSnapshot>();
  private rollingContextNotes: string[] = [];
  private activeRun: ActivePreThinkRun | null = null;

  public updateDraft(options: {
    draft: string;
    model?: string;
    effort?: string;
    agentMode?: boolean;
    history: StreamChatMessage[];
  }): void {
    const { draft, model = 'void-combo', agentMode = false, history } = options;

    // Do not pre-think in Agent Mode (to avoid triggering terminal commands while typing)
    if (agentMode) {
      this.reset();
      return;
    }

    const trimmed = draft.trim();
    this.currentDraft = trimmed;
    this.currentModel = model;
    this.currentHistory = history;

    if (!trimmed) {
      this.reset();
      return;
    }

    // Start the background duty-cycle loop immediately on the very first character typed
    if (!this.isLoopRunning) {
      this.isLoopRunning = true;
      this.cycleCount = 0;
      this.scheduleNextCycle(0);
    }
  }

  private scheduleNextCycle(delayMs: number): void {
    if (this.loopTimer !== null) {
      window.clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    if (!this.isLoopRunning || !this.currentDraft) {
      this.isLoopRunning = false;
      return;
    }

    this.loopTimer = window.setTimeout(() => {
      this.loopTimer = null;
      void this.executeSingleThinkWindow();
    }, delayMs);
  }

  private async executeSingleThinkWindow(): Promise<void> {
    if (!this.isLoopRunning || !this.currentDraft) {
      this.isLoopRunning = false;
      return;
    }

    const draftSnapshot = this.currentDraft;
    const normalized = draftSnapshot.toLowerCase().replace(/\s+/g, ' ').trim();

    // If the draft hasn't changed since the last completed analysis, wait quietly without wasting tokens
    if (
      normalized === this.lastAnalyzedNormalized &&
      this.snapshots.get(normalized)?.complete
    ) {
      const idlePauseMs = this.cycleCount < 3 ? 2000 : 5000;
      this.scheduleNextCycle(idlePauseMs);
      return;
    }

    this.cycleCount += 1;
    this.lastAnalyzedNormalized = normalized;

    // Abort any older active pre-think run
    if (this.activeRun && this.activeRun.normalizedDraft !== normalized) {
      this.activeRun.controller.abort();
      this.activeRun = null;
    }

    const controller = new AbortController();
    // Each active thinking window runs for at most 3 seconds (3000ms) to conserve tokens
    const windowTimeout = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, 3000);

    const priorNotes =
      this.rollingContextNotes.length > 0
        ? `[BACKGROUND PRE-ANALYSIS FROM EARLIER TYPING: ${this.rollingContextNotes.slice(-2).join(' | ')}]\n`
        : '';

    const messagesForPreThink: StreamChatMessage[] = [
      ...this.currentHistory,
      {
        role: 'user',
        content: priorNotes
          ? `${priorNotes}Current user message: ${draftSnapshot}`
          : draftSnapshot,
      },
    ];

    let accumulated = '';
    const runPromise = (async () => {
      try {
        await streamChatCompletion({
          messages: messagesForPreThink,
          model: this.currentModel,
          effort: 'Low',
          agentMode: false,
          moderationEnabled: false,
          signal: controller.signal,
          onChunk: (_delta, fullText) => {
            accumulated = fullText;
            if (this.activeRun && this.activeRun.normalizedDraft === normalized) {
              this.activeRun.partialText = fullText;
            }
            this.snapshots.set(normalized, {
              draftText: draftSnapshot,
              normalizedDraft: normalized,
              replyText: fullText,
              complete: false,
              updatedAt: Date.now(),
            });
          },
        });

        if (accumulated.trim().length > 0) {
          this.snapshots.set(normalized, {
            draftText: draftSnapshot,
            normalizedDraft: normalized,
            replyText: accumulated,
            complete: !controller.signal.aborted,
            updatedAt: Date.now(),
          });

          const compactNote = `For "${draftSnapshot.slice(0, 60)}": ${accumulated
            .replace(/\s+/g, ' ')
            .slice(0, 140)}`;
          this.rollingContextNotes.push(compactNote);
          if (this.rollingContextNotes.length > 4) {
            this.rollingContextNotes.shift();
          }
        }
      } catch {
        // Ignore aborts or network hiccups in invisible background pre-think
      } finally {
        window.clearTimeout(windowTimeout);
      }
      return accumulated;
    })();

    this.activeRun = {
      normalizedDraft: normalized,
      draftText: draftSnapshot,
      controller,
      promise: runPromise,
      partialText: '',
    };

    await runPromise;

    if (!this.isLoopRunning || !this.currentDraft) {
      this.isLoopRunning = false;
      return;
    }

    // Pause schedule:
    // - First 3 cycles: 2-second pause (2000ms) after each 3-second think window
    // - 4th cycle onwards (after 3 cycles): 5-second pause (5000ms) after each 3-second think window
    const pauseDurationMs = this.cycleCount < 3 ? 2000 : 5000;
    this.scheduleNextCycle(pauseDurationMs);
  }

  /**
   * Called at the exact moment the user presses Send.
   * Stops background timers and returns any matching pre-computed reply or rolling context.
   */
  public consumeForSend(finalUserText: string): {
    exactReply: string | null;
    partialReply: string | null;
    rollingContextHint: string | null;
  } {
    if (this.loopTimer !== null) {
      window.clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.isLoopRunning = false;

    const normalizedFinal = finalUserText
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (this.activeRun) {
      this.activeRun.controller.abort();
      this.activeRun = null;
    }

    const exactSnap = this.snapshots.get(normalizedFinal);
    const rollingHint =
      this.rollingContextNotes.length > 0
        ? this.rollingContextNotes.slice(-2).join(' | ')
        : null;

    this.currentDraft = '';
    this.cycleCount = 0;
    this.lastAnalyzedNormalized = '';
    this.snapshots.clear();
    this.rollingContextNotes = [];

    if (exactSnap && exactSnap.complete && exactSnap.replyText.trim().length > 0) {
      return {
        exactReply: exactSnap.replyText,
        partialReply: null,
        rollingContextHint: rollingHint,
      };
    }

    if (exactSnap && exactSnap.replyText.trim().length > 40) {
      return {
        exactReply: null,
        partialReply: exactSnap.replyText,
        rollingContextHint: rollingHint,
      };
    }

    return {
      exactReply: null,
      partialReply: null,
      rollingContextHint: rollingHint,
    };
  }

  public reset(): void {
    if (this.loopTimer !== null) {
      window.clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.activeRun) {
      this.activeRun.controller.abort();
      this.activeRun = null;
    }
    this.isLoopRunning = false;
    this.currentDraft = '';
    this.cycleCount = 0;
    this.lastAnalyzedNormalized = '';
    this.snapshots.clear();
    this.rollingContextNotes = [];
  }
}
