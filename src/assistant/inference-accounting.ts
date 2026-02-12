export interface InferenceAccountingResult {
  backendInvocations: number;
  llamaSpawns: number;
  llamaEvidenceExcerpts: string[];
  callCounts: Record<string, number>;
}

/**
 * Parse backend/Tauri process logs for LLAMA_CLI_EVIDENCE and invocation counts.
 * Expects logs in format: LLAMA_CLI_EVIDENCE: ... or similar markers.
 */
export function parseInferenceEvidence(logText: string): InferenceAccountingResult {
  const lines = logText.split('\n');
  let llamaSpawns = 0;
  const excerpts: string[] = [];
  const callCounts: Record<string, number> = {};

  for (const line of lines) {
    if (line.includes('LLAMA_CLI_EVIDENCE: full argv follows') || line.includes('Failed to spawn llama-cli')) {
      llamaSpawns++;
      if (excerpts.length < 5) {
        excerpts.push(line.trim().slice(0, 300));
      }
    }
  }
  if (llamaSpawns === 0 && lines.some((l) => l.includes('LLAMA_CLI_EVIDENCE'))) {
    llamaSpawns = 1;
  }
  const sendMsgLines = lines.filter((l) => l.includes('send_message') || l.includes('intelligent_chat') || l.includes('reason'));
  callCounts['send_message'] = sendMsgLines.length > 0 ? sendMsgLines.length : llamaSpawns;

  return {
    backendInvocations: llamaSpawns > 0 ? llamaSpawns : (callCounts['send_message'] || 0),
    llamaSpawns,
    llamaEvidenceExcerpts: excerpts,
    callCounts,
  };
}
