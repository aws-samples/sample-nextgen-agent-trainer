// Shared TypeScript types used by both frontend and backend.

export interface Scenario {
  scenarioId: string;
  businessName: string;
  personaName: string;
  scenarioName: string;
  voiceId: string;
  demographics: {
    age: number;
    gender: string;
    location: string;
    accountPin?: string;
  };
  behavior: {
    communicationStyle: string;
    emotionalState: string;
  };
  customerObjectives: {
    primary: string[];
    secondary?: string[];
  };
  agentObjectives: {
    primary: string[];
    secondary?: string[];
  };
  prompt: string;
}

export interface EvaluationRequest {
  user_name: string;
  scenario_name: string;
  call_transcript: string;
  scenario_objectives?: {
    primary_objectives?: string[];
    secondary_objectives?: string[];
  };
}

export interface TranscriptPayload {
  call_transcript: string;
  transcript_size_bytes: number;
  transcript_truncated: boolean;
  transcript_compressed: boolean;
}
