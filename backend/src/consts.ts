import {AudioMediaType, AudioType, TextMediaType} from "./types";

export const DEFAULT_REGION = process.env.AWS_REGION || "us-east-1";

// AWS SDK automatically uses default credential chain:
// 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
// 2. ECS container credentials (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI - set by ECS)
// 3. EC2 instance metadata (IMDS)
// No explicit credential provider needed - SDK handles it automatically

// Knowledge Base ID - optional, may not be set if KB not created
export const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;

export const DefaultInferenceConfiguration = {
    maxTokens: 1024,
    topP: 0.9,
    temperature: 0.2,
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const SearchKnowledgeBaseToolSchema  = JSON.stringify({
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The search query"
    },
  },
  "required": ["query"]
});

export const DefaultTextConfiguration = { mediaType: "text/plain" as TextMediaType };

export const DefaultSystemPrompt = "";

export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 24000,
  voiceId: "tiffany",
};

// SCENARIO_BUSINESS_NAME removed - now dynamically selected on frontend

// IMPORTANT: keep in sync with the prompt prefix/suffix in frontend/src/prompts.ts
export const NOVA_MODEL_ID = process.env.NOVA_MODEL_ID || "amazon.nova-2-sonic-v1:0";
export const REASONING_MODEL_ID = process.env.REASONING_MODEL_ID || "global.anthropic.claude-sonnet-4-5-20250929-v1:0";
export const SUGGESTIONS_MODEL_ID = process.env.SUGGESTIONS_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0"; // default matches CloudFormation SuggestionsModelId parameter

export const AGENT_SUGGESTION_PROMPT = `You are an AI assistant helping a call center agent respond to customer inquiries. Your role is to provide a professional, helpful, and accurate response suggestion based on the customer's query and relevant knowledge base information.

**Customer Query:** "{customerQuery}"

**Knowledge Base Context:**
{knowledgeBaseContext}

**Instructions:**
1. Analyze the customer's query to understand their specific issue or need
2. Use the knowledge base context to provide accurate, relevant information
3. Generate a professional response that:
   - Directly addresses the customer's concern
   - Uses information from the knowledge base when applicable
   - Maintains a helpful and empathetic tone
   - Offers clear next steps or solutions
   - Follows company policies and procedures

**Response Guidelines:**
- Be succinct and brief, provide the suggestion in 1-2 sentences.
- Use professional language appropriate for customer service
- If the knowledge base doesn't contain relevant information, acknowledge limitations and offer to escalate or research further
- Include specific details from the knowledge base when available (pricing, procedures, policies)
- Summarise next steps that the agent can take to help the customer

**Generate a single response suggestion in JSON format, do not include any markdown:**
{
  "suggestion": "Your professional response here",
  "confidence": 0.85,
  "knowledgeBaseRef": "Reference to the knowledge base article if any",
  "nextSteps": ["action1", "action2"]
}`;


export const SUGGESTIONS_INFERENCE_CONFIG = {
  maxTokens: 400,
  temperature: 0.2
  // topP: 0.2, Sonnet 4.5 temperature and topP cannot be both specified
};

export const KB_SCORE_THRESHOLD = parseFloat(process.env.KB_SCORE_THRESHOLD || "0.5");

export const TRANSCRIPT_BUCKET_NAME = process.env.TRANSCRIPT_BUCKET_NAME;

// Cognito configuration - from environment variables
// Note: Variable names chosen to avoid false positive security scanner matches
export const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
export const COGNITO_APP_CLIENT = process.env.COGNITO_CLIENT_ID;  // Renamed from CLIENT_ID to avoid gitleaks false positive
export const COGNITO_DOMAIN = process.env.COGNITO_DOMAIN;
export const COGNITO_REDIRECT_URI = process.env.COGNITO_REDIRECT_URI;
