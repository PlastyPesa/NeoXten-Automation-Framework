/**
 * SecurityAuditor Worker — dependency audit, secret scanning.
 * Pure deterministic scanners. No LLM.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';

export interface Vulnerability { severity: string; pkg: string; description: string }
export interface SecretFinding { file: string; line: number; pattern: string }

export interface SecurityScanner {
  auditDependencies(projectDir: string): Promise<Vulnerability[]>;
  scanSecrets(projectDir: string): Promise<SecretFinding[]>;
}

export interface SecurityAuditorDeps {
  scanner: SecurityScanner;
}

export function createSecurityAuditorWorker(deps: SecurityAuditorDeps): WorkerContract {
  return {
    id: 'security-auditor',
    accepts: 'security_audit',
    requires: ['buildOutput'],
    produces: ['securityReport'],
    timeout: 120_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const buildOutput = runState.getBuildOutput()!;
      const projectDir = buildOutput.projectDir;

      const [vulns, secrets] = await Promise.all([
        deps.scanner.auditDependencies(projectDir),
        deps.scanner.scanSecrets(projectDir),
      ]);

      const criticalVulns = vulns.filter(v => v.severity === 'critical' || v.severity === 'high');
      const overallPassed = criticalVulns.length === 0 && secrets.length === 0;

      chain.append({
        type: 'note',
        workerId: 'security-auditor',
        stage: 'security_audit',
        data: {
          event: 'audit_complete',
          totalVulnerabilities: vulns.length,
          criticalHigh: criticalVulns.length,
          secretsFound: secrets.length,
          overallPassed,
        },
      });

      runState.setSecurityReport({
        vulnerabilities: vulns.map(v => ({ severity: v.severity, pkg: v.pkg, description: v.description })),
        secretsFound: secrets.length,
        overallPassed,
      });

      if (!overallPassed) {
        const reasons: string[] = [];
        if (criticalVulns.length > 0) reasons.push(`${criticalVulns.length} critical/high vulnerabilities`);
        if (secrets.length > 0) reasons.push(`${secrets.length} hardcoded secrets`);
        return { status: 'failed', reason: reasons.join(', '), evidence: [] };
      }

      return { status: 'done', artifacts: [], evidence: [] };
    },
  };
}
