/**
 * Action and ActionResult types for the observation–action loop.
 *
 * Every action returns an ActionResult that includes:
 *   - success / error
 *   - before snapshot (page state before acting)
 *   - after snapshot  (page state after acting)
 *   - optional screenshot path
 *   - duration
 */
import type { PageSnapshot } from '../observer/snapshot.js';

/* ------------------------------------------------------------------ */
/*  Action definitions                                                 */
/* ------------------------------------------------------------------ */

export interface ClickAction {
  type: 'click';
  selector: string;
  timeout?: number;
  force?: boolean;
}

export interface TypeAction {
  type: 'type';
  selector: string;
  text: string;
  timeout?: number;
  /** If true, append to existing value instead of replacing */
  append?: boolean;
}

export interface NavigateAction {
  type: 'navigate';
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface WaitAction {
  type: 'wait';
  /** Wait for selector to become visible */
  selector?: string;
  /** Wait for text to appear on page */
  text?: string;
  /** Fixed delay in ms (fallback if no selector/text) */
  ms?: number;
  timeout?: number;
}

export interface AssertAction {
  type: 'assert';
  assertType: 'visible' | 'hidden' | 'contains' | 'not-contains' | 'exists';
  selector: string;
  text?: string;
  timeout?: number;
}

export interface ScrollAction {
  type: 'scroll';
  /** Selector to scroll into view, or omit for page scroll */
  selector?: string;
  direction?: 'up' | 'down';
  pixels?: number;
}

export interface ScreenshotAction {
  type: 'screenshot';
  label?: string;
}

export interface ConditionalAction {
  type: 'conditional';
  /** Selector to check for visibility */
  ifVisible: string;
  then: Action[];
  otherwise?: Action[];
  timeout?: number;
}

export type Action =
  | ClickAction
  | TypeAction
  | NavigateAction
  | WaitAction
  | AssertAction
  | ScrollAction
  | ScreenshotAction
  | ConditionalAction;

/* ------------------------------------------------------------------ */
/*  Action results                                                     */
/* ------------------------------------------------------------------ */

export interface ActionResult {
  action: Action;
  success: boolean;
  error?: string;
  /** Page state before the action */
  before: PageSnapshot;
  /** Page state after the action */
  after: PageSnapshot;
  /** Screenshot taken during/after this action */
  screenshotPath?: string;
  /** Wall-clock duration of the action in ms */
  durationMs: number;
}
