import apiFetch from './client';
import type { Scenario } from '../../../shared/types';

export async function getBusinesses(): Promise<string[]> {
  const data = await apiFetch<{ businesses: string[] }>('/api/scenarios/businesses');
  return data.businesses ?? [];
}

export async function getScenarios(business: string): Promise<Scenario[]> {
  const data = await apiFetch<{ scenarios: Scenario[] }>(
    `/api/scenarios?business=${encodeURIComponent(business)}`
  );
  return data.scenarios ?? [];
}

export async function createScenario(payload: Record<string, unknown>): Promise<{ scenarioId: string }> {
  return apiFetch<{ scenarioId: string }>('/api/create-persona', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
