import type { Page } from '@playwright/test';
import type { FlowStep } from '../config/schema.js';

export interface StepResult {
  success: boolean;
  error?: string;
  screenshotPath?: string;
  /** Test state from getTestState (broadcast -> filesDir/test_state.json) */
  testState?: Record<string, unknown>;
}

export interface UIDriver {
  launch(): Promise<void>;
  getPage(): Page;
  executeStep(step: FlowStep): Promise<StepResult>;
  captureScreenshot(path: string): Promise<void>;
  captureTrace(path: string): Promise<void>;
  getConsoleLogs(): Array<{ type: string; text: string }>;
  getConsoleErrors(): string[];
  close(): Promise<void>;
  /** Optional: backend/Tauri process logs for inference accounting */
  getBackendLog?(): string;
}
