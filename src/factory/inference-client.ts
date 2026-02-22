/**
 * InferenceClient — abstract interface for LLM inference.
 *
 * Workers that need LLM reasoning (Planner, Builder) receive an
 * InferenceClient via dependency injection. The client is untrusted:
 * outputs are treated as suggestions, never as authority.
 *
 * Every call is logged with prompt hash, response hash, model, and tokens
 * for Evidence Chain traceability.
 */

import { createHash } from 'node:crypto';

export interface InferenceRequest {
  role: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface InferenceResponse {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface InferenceCallRecord {
  promptHash: string;
  responseHash: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  role: string;
}

export interface InferenceClient {
  complete(request: InferenceRequest): Promise<InferenceResponse>;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export function buildCallRecord(
  request: InferenceRequest,
  response: InferenceResponse,
): InferenceCallRecord {
  return {
    promptHash: hashText(request.prompt),
    responseHash: hashText(response.text),
    model: response.model,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    durationMs: response.durationMs,
    role: request.role,
  };
}
