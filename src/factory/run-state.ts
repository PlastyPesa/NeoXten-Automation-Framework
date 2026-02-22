/**
 * RunState — typed, stage-aware shared state for a Factory Run.
 *
 * Workers read from and write to specific slots. Persists to disk
 * after every mutation. Enforces pipeline ordering: later-stage
 * output cannot be written before earlier-stage output exists.
 *
 * Serializable to JSON. No functions, no circular refs.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { stableStringify } from './evidence-chain.js';
import type { RunStage } from './evidence-chain.js';
import type { FactorySpec } from './spec/schema.js';

/* ------------------------------------------------------------------ */
/*  Worker output types                                                */
/* ------------------------------------------------------------------ */

export interface WorkUnitPlan {
  id: string;
  featureIds: string[];
  description: string;
  dependencies: string[];
}

export interface Plan {
  workUnits: WorkUnitPlan[];
  techStack: Record<string, string>;
  fileStructure: string[];
}

export interface WorkUnit extends WorkUnitPlan {
  status: 'pending' | 'building' | 'done' | 'failed';
  outputFiles: string[];
}

export interface BuildOutput {
  projectDir: string;
  buildCommand: string;
  exitCode: number;
  outputFiles: string[];
}

export interface TestResult {
  journeyId: string;
  verdict: 'PASS' | 'FAIL';
  durationMs: number;
  screenshotPaths: string[];
  failureReason?: string;
}

export interface UIInspectionResult {
  layoutViolations: number;
  contrastChecks: Array<{ element: string; ratio: number; threshold: number; passed: boolean }>;
  accessibilityChecks: Array<{ rule: string; passed: boolean }>;
  overallPassed: boolean;
}

export interface SecurityReport {
  vulnerabilities: Array<{ severity: string; pkg: string; description: string }>;
  secretsFound: number;
  overallPassed: boolean;
}

export interface ReleaseArtifact {
  platform: string;
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface StateGateResult {
  gateId: string;
  passed: boolean;
  timestamp: string;
  checks: Array<{ name: string; passed: boolean; measured: number; threshold: number }>;
}

export interface ConsequenceHit {
  recordId: string;
  pattern: string;
  confidence: number;
  stage: string;
}

export interface StageTimestamp {
  start: string;
  end?: string;
}

/* ------------------------------------------------------------------ */
/*  Serializable state shape                                           */
/* ------------------------------------------------------------------ */

export interface RunStateData {
  runId: string;
  specHash: string;
  spec: FactorySpec;
  evidenceChainPath: string;
  status: 'running' | 'shipped' | 'aborted';
  currentStage: RunStage;
  plan: Plan | null;
  workUnits: WorkUnit[];
  buildOutput: BuildOutput | null;
  testResults: TestResult[];
  uiInspection: UIInspectionResult | null;
  securityReport: SecurityReport | null;
  releaseArtifacts: ReleaseArtifact[];
  gateResults: StateGateResult[];
  consequenceHits: ConsequenceHit[];
  timestamps: Record<string, StageTimestamp>;
}

/* ------------------------------------------------------------------ */
/*  RunState                                                           */
/* ------------------------------------------------------------------ */

export class RunState {
  readonly runId: string;
  readonly specHash: string;
  readonly spec: FactorySpec;
  readonly evidenceChainPath: string;

  private _status: RunStateData['status'] = 'running';
  private _currentStage: RunStage = 'initializing';
  private _plan: Plan | null = null;
  private _workUnits: WorkUnit[] = [];
  private _buildOutput: BuildOutput | null = null;
  private _testResults: TestResult[] = [];
  private _uiInspection: UIInspectionResult | null = null;
  private _securityReport: SecurityReport | null = null;
  private _releaseArtifacts: ReleaseArtifact[] = [];
  private _gateResults: StateGateResult[] = [];
  private _consequenceHits: ConsequenceHit[] = [];
  private _timestamps: Record<string, StageTimestamp> = {};

  private readonly persistPath: string;

  constructor(init: {
    runId: string;
    spec: FactorySpec;
    evidenceChainPath: string;
    persistDir: string;
  }) {
    this.runId = init.runId;
    this.spec = init.spec;
    this.specHash = createHash('sha256')
      .update(stableStringify(init.spec), 'utf-8')
      .digest('hex');
    this.evidenceChainPath = init.evidenceChainPath;
    this.persistPath = join(init.persistDir, 'run-state.json');
  }

  /* ---- Status ---- */

  get status(): RunStateData['status'] { return this._status; }

  setStatus(status: RunStateData['status']): void {
    this._status = status;
    this.persist();
  }

  /* ---- Current stage ---- */

  get currentStage(): RunStage { return this._currentStage; }

  setCurrentStage(stage: RunStage): void {
    this._currentStage = stage;
    this.persist();
  }

  /* ---- Plan (from Planner) ---- */

  getPlan(): Plan | null { return this._plan; }

  setPlan(plan: Plan): void {
    this._plan = plan;
    this._workUnits = plan.workUnits.map(wu => ({
      ...wu,
      status: 'pending' as const,
      outputFiles: [],
    }));
    this.persist();
  }

  /* ---- Work units (managed during Building) ---- */

  getWorkUnits(): WorkUnit[] { return this._workUnits; }

  updateWorkUnit(id: string, update: Partial<Pick<WorkUnit, 'status' | 'outputFiles'>>): void {
    const idx = this._workUnits.findIndex(wu => wu.id === id);
    if (idx === -1) throw new Error(`work unit '${id}' not found`);
    this._workUnits[idx] = { ...this._workUnits[idx], ...update };
    this.persist();
  }

  /* ---- Build output (from Assembler) — requires plan ---- */

  getBuildOutput(): BuildOutput | null { return this._buildOutput; }

  setBuildOutput(output: BuildOutput): void {
    if (this._plan === null) {
      throw new Error('cannot set buildOutput: plan is null');
    }
    this._buildOutput = output;
    this.persist();
  }

  /* ---- Test results (from Tester) — requires buildOutput ---- */

  getTestResults(): TestResult[] { return this._testResults; }

  addTestResult(result: TestResult): void {
    if (this._buildOutput === null) {
      throw new Error('cannot add testResult: buildOutput is null');
    }
    this._testResults.push(result);
    this.persist();
  }

  /* ---- UI inspection (from UIInspector) — requires testResults ---- */

  getUIInspection(): UIInspectionResult | null { return this._uiInspection; }

  setUIInspection(result: UIInspectionResult): void {
    if (this._testResults.length === 0) {
      throw new Error('cannot set uiInspection: testResults is empty');
    }
    this._uiInspection = result;
    this.persist();
  }

  /* ---- Security report (from SecurityAuditor) — requires buildOutput ---- */

  getSecurityReport(): SecurityReport | null { return this._securityReport; }

  setSecurityReport(report: SecurityReport): void {
    if (this._buildOutput === null) {
      throw new Error('cannot set securityReport: buildOutput is null');
    }
    this._securityReport = report;
    this.persist();
  }

  /* ---- Release artifacts (from ReleasePackager) — requires securityReport ---- */

  getReleaseArtifacts(): ReleaseArtifact[] { return this._releaseArtifacts; }

  addReleaseArtifact(artifact: ReleaseArtifact): void {
    if (this._securityReport === null) {
      throw new Error('cannot add releaseArtifact: securityReport is null');
    }
    this._releaseArtifacts.push(artifact);
    this.persist();
  }

  /* ---- Gate results (appendable at any stage) ---- */

  getGateResults(): StateGateResult[] { return this._gateResults; }

  getGateResult(gateId: string): StateGateResult | undefined {
    return this._gateResults.find(g => g.gateId === gateId);
  }

  addGateResult(result: StateGateResult): void {
    this._gateResults.push(result);
    this.persist();
  }

  /* ---- Consequence hits (appendable at any stage) ---- */

  getConsequenceHits(): ConsequenceHit[] { return this._consequenceHits; }

  addConsequenceHit(hit: ConsequenceHit): void {
    this._consequenceHits.push(hit);
    this.persist();
  }

  /* ---- Timestamps ---- */

  getTimestamps(): Record<string, StageTimestamp> { return this._timestamps; }

  stageStart(stage: string): void {
    this._timestamps[stage] = { start: new Date().toISOString() };
    this.persist();
  }

  stageEnd(stage: string): void {
    if (!this._timestamps[stage]) {
      this._timestamps[stage] = { start: new Date().toISOString() };
    }
    this._timestamps[stage].end = new Date().toISOString();
    this.persist();
  }

  /* ---- Serialization ---- */

  toJSON(): RunStateData {
    return {
      runId: this.runId,
      specHash: this.specHash,
      spec: this.spec,
      evidenceChainPath: this.evidenceChainPath,
      status: this._status,
      currentStage: this._currentStage,
      plan: this._plan,
      workUnits: this._workUnits,
      buildOutput: this._buildOutput,
      testResults: this._testResults,
      uiInspection: this._uiInspection,
      securityReport: this._securityReport,
      releaseArtifacts: this._releaseArtifacts,
      gateResults: this._gateResults,
      consequenceHits: this._consequenceHits,
      timestamps: this._timestamps,
    };
  }

  persist(): void {
    mkdirSync(dirname(this.persistPath), { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(this.toJSON(), null, 2), 'utf-8');
  }

  static load(filePath: string): RunState {
    const data: RunStateData = JSON.parse(readFileSync(filePath, 'utf-8'));
    const state = new RunState({
      runId: data.runId,
      spec: data.spec,
      evidenceChainPath: data.evidenceChainPath,
      persistDir: dirname(filePath),
    });
    state._status = data.status;
    state._currentStage = data.currentStage;
    state._plan = data.plan;
    state._workUnits = data.workUnits ?? [];
    state._buildOutput = data.buildOutput;
    state._testResults = data.testResults ?? [];
    state._uiInspection = data.uiInspection;
    state._securityReport = data.securityReport;
    state._releaseArtifacts = data.releaseArtifacts ?? [];
    state._gateResults = data.gateResults ?? [];
    state._consequenceHits = data.consequenceHits ?? [];
    state._timestamps = data.timestamps ?? {};
    return state;
  }
}
