import apiFetch from './client';
import type { EvaluationRequest } from '../../../shared/types';

export interface EvaluationResult {
  overall_score: number;
  summary: string;
  [key: string]: unknown;
}

export interface EvaluationHistoryItem {
  user_name: string;
  scenario_name: string;
  overall_score: number;
  timestamp: string;
  transcript_truncated: boolean;
  full_response?: Record<string, unknown>;
  call_transcript?: string;
}

export async function submitEvaluation(request: EvaluationRequest): Promise<EvaluationResult> {
  return apiFetch<EvaluationResult>('/api/evaluate', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getEvaluationHistory(userName: string): Promise<EvaluationHistoryItem[]> {
  return apiFetch<EvaluationHistoryItem[]>(`/api/evaluations?user_name=${encodeURIComponent(userName)}`);
}
