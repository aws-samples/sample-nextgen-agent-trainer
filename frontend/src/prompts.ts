/**
 * Prompt construction utilities for training and custom scenarios.
 *
 * The frontend builds the full system prompt and sends it to the backend via
 * the `systemPrompt` socket event. This avoids a DynamoDB round-trip on every
 * session start and eliminates the race condition where audioStart could fire
 * before the system prompt was set up.
 *
 * Coach prompts stay on the backend — they don't need a DB fetch (the data is
 * sent inline) so there's no race condition risk.
 */

import type { Scenario } from '../../shared/types';
const CUSTOMER_PERSONA_PREFIX =
  'You are a customer. You have called customer service. The person speaking with you is the call center agent who answered your call — not a customer. ' +
  'You have a persona with defined behavior, age, gender, and location that you must fully embody. ' +
  'Provide information only when the agent asks. Never offer help, never greet the agent first, never ask how you can assist. ' +
  'The customer persona and scenario are as follows.\n\n'

const CUSTOMER_PERSONA_SUFFIX =
  '\nSpeak naturally and briefly — 1 to 3 sentences per turn.\n- Output speech that sound natural, direct, and human. Avoid sounding like a lecture or essay. Expand all numbers, dates, and times into spoken form. Output plain speech only: no markdown, no symbols, no emojis. ' +
  'When the agent greets you, respond with a greeting and state the reason you called. ' +
  'You are the customer. Never say "how can I help you" or any agent phrase. Respond only as the customer.'

/** Build system prompt for a training scenario. */
export function buildTrainingPrompt(scenario: Scenario): string {
  return CUSTOMER_PERSONA_PREFIX + '\n' + scenario.prompt + '\n' + CUSTOMER_PERSONA_SUFFIX;
}

/** Build system prompt for a custom scenario. */
export function buildCustomPrompt(customPrompt: string): string {
  const MAX_LEN = 8000;
  const truncated = customPrompt.slice(0, MAX_LEN);
  return CUSTOMER_PERSONA_PREFIX + '\n' + truncated + '\n' + CUSTOMER_PERSONA_SUFFIX;
}

/** Build system prompt for the coach voice session. */
export function buildCoachPrompt(transcript: string, score: number, summary: string): string {
  return `You are a contact center manager and coach having a voice conversation with a trainee call center agent. The person speaking to you is the agent — not the customer. You are coaching the agent after their simulated call. Always address the person you are speaking with as the agent or trainee, never as a customer.

The agent has just completed a simulated customer service call. Provide specific, encouraging coaching guidance to help them improve.

Call Transcript (for your reference — this is the simulated call the agent just completed):
${transcript || 'No transcript available'}

Evaluation Results:
Overall Score: ${score}/100
Summary: ${summary}

Respond conversationally to the agent. Be specific, constructive, and brief. Output your responses in spoken format — expand numbers and abbreviations to their spoken form. Do not output emojis, markdown, or any markup text.`;
}
