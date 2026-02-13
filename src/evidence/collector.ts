/**
 * EvidenceCollector — accumulates proof throughout a session.
 *
 * Every action, observation, console error, and screenshot is recorded
 * as a timeline entry. The verdict is built from accumulated evidence,
 * not computed once at the end.
 */
import type { PageSnapshot } from '../observer/snapshot.js';
import type { ActionResult } from '../actions/types.js';

/* ------------------------------------------------------------------ */
/*  Timeline entry types                                               */
/* ------------------------------------------------------------------ */

export type TimelineEntryType =
  | 'action'
  | 'observation'
  | 'screenshot'
  | 'console_error'
  | 'note'
  | 'gate_result'
  | 'stage_start'
  | 'stage_end';

export interface TimelineEntry {
  type: TimelineEntryType;
  timestamp: string;
  label: string;
  data?: unknown;
  durationMs?: number;
}

/* ------------------------------------------------------------------ */
/*  Evidence summary (for verdict building)                            */
/* ------------------------------------------------------------------ */

export interface EvidenceSummary {
  timeline: TimelineEntry[];
  screenshots: Array<{ path: string; label: string; timestamp: string }>;
  consoleErrors: string[];
  actionResults: ActionResult[];
  notes: string[];
  totalActions: number;
  failedActions: number;
  totalDurationMs: number;
}

/* ------------------------------------------------------------------ */
/*  EvidenceCollector                                                   */
/* ------------------------------------------------------------------ */

export class EvidenceCollector {
  private timeline: TimelineEntry[] = [];
  private screenshots: Array<{ path: string; label: string; timestamp: string }> = [];
  private consoleErrors: string[] = [];
  private actionResults: ActionResult[] = [];
  private notes: string[] = [];
  private startTime = Date.now();

  /* ---- Recording methods ---- */

  addAction(result: ActionResult): void {
    this.actionResults.push(result);
    this.timeline.push({
      type: 'action',
      timestamp: new Date().toISOString(),
      label: `${result.action.type}${result.success ? '' : ' [FAILED]'}`,
      data: {
        action: result.action,
        success: result.success,
        error: result.error,
      },
      durationMs: result.durationMs,
    });
  }

  addObservation(snapshot: PageSnapshot, label?: string): void {
    this.timeline.push({
      type: 'observation',
      timestamp: snapshot.timestamp,
      label: label ?? `observe @ ${snapshot.url}`,
      data: {
        url: snapshot.url,
        title: snapshot.title,
        buttons: snapshot.buttons.length,
        inputs: snapshot.inputs.length,
        hasSpinner: snapshot.hasSpinner,
        hasModal: snapshot.hasModal,
        hasErrorDialog: snapshot.hasErrorDialog,
        consoleErrors: snapshot.consoleErrors.length,
        visibleTextLength: snapshot.visibleText.length,
      },
    });
  }

  addScreenshot(path: string, label: string): void {
    const ts = new Date().toISOString();
    this.screenshots.push({ path, label, timestamp: ts });
    this.timeline.push({
      type: 'screenshot',
      timestamp: ts,
      label,
      data: { path },
    });
  }

  addConsoleError(error: string): void {
    this.consoleErrors.push(error);
    this.timeline.push({
      type: 'console_error',
      timestamp: new Date().toISOString(),
      label: error.slice(0, 120),
    });
  }

  addNote(note: string): void {
    this.notes.push(note);
    this.timeline.push({
      type: 'note',
      timestamp: new Date().toISOString(),
      label: note,
    });
  }

  addGateResult(name: string, passed: boolean, measured: number, threshold: number): void {
    this.timeline.push({
      type: 'gate_result',
      timestamp: new Date().toISOString(),
      label: `gate:${name} ${passed ? 'PASS' : 'FAIL'} (${measured}/${threshold})`,
      data: { name, passed, measured, threshold },
    });
  }

  stageStart(name: string): void {
    this.timeline.push({
      type: 'stage_start',
      timestamp: new Date().toISOString(),
      label: name,
    });
  }

  stageEnd(name: string, durationMs: number): void {
    this.timeline.push({
      type: 'stage_end',
      timestamp: new Date().toISOString(),
      label: name,
      durationMs,
    });
  }

  /* ---- Queries ---- */

  getTimeline(): TimelineEntry[] {
    return [...this.timeline];
  }

  getScreenshots(): Array<{ path: string; label: string; timestamp: string }> {
    return [...this.screenshots];
  }

  getFailedActions(): ActionResult[] {
    return this.actionResults.filter((r) => !r.success);
  }

  /** Build an evidence summary for verdict construction. */
  summarize(): EvidenceSummary {
    return {
      timeline: [...this.timeline],
      screenshots: [...this.screenshots],
      consoleErrors: [...this.consoleErrors],
      actionResults: [...this.actionResults],
      notes: [...this.notes],
      totalActions: this.actionResults.length,
      failedActions: this.actionResults.filter((r) => !r.success).length,
      totalDurationMs: Date.now() - this.startTime,
    };
  }
}
