import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createHash } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { DEFAULT_REGION, REASONING_MODEL_ID } from "./consts";
import { logger } from "./logger";

const MAX_TOKENS = 5000;

const SCORING_RUBRIC = {
    contact_center_call_scoring: {
        total_score: 100,
        criteria: [
            {
                name: "Greeting & Introduction",
                description: "Was the agent's greeting polite, professional, and clear? Did they verify the customer's details appropriately?",
                weight: 5
            },
            {
                name: "Active Listening",
                description: "Did the agent demonstrate attentive listening, acknowledge concerns, and avoid interrupting?",
                weight: 8
            },
            {
                name: "Empathy & Tone",
                description: "Did the agent use a friendly, empathetic tone and adapt their style to the customer's mood?",
                weight: 10
            },
            {
                name: "Clarity of Communication",
                description: "Did the agent communicate clearly, avoid jargon, and confirm customer understanding?",
                weight: 8
            },
            {
                name: "Probing & Clarification",
                description: "Did the agent ask relevant questions to fully understand the issue?",
                weight: 5
            },
            {
                name: "Product/Process Knowledge",
                description: "Did the agent demonstrate accurate knowledge of products, processes, and policies?",
                weight: 10
            },
            {
                name: "Ownership & Accountability",
                description: "Did the agent take responsibility for the issue and reassure the customer?",
                weight: 7
            },
            {
                name: "Problem Resolution",
                description: "Was the customer's issue effectively resolved within the call or with a clear follow-up plan?",
                weight: 15
            },
            {
                name: "Compliance & Policy Adherence",
                description: "Did the agent follow all compliance, security, and data privacy requirements?",
                weight: 10
            },
            {
                name: "Efficiency & Call Control",
                description: "Did the agent handle the call efficiently, staying focused without rushing?",
                weight: 7
            },
            {
                name: "Closing",
                description: "Was the call closed politely with confirmation that the customer was satisfied?",
                weight: 5
            },
            {
                name: "Scenario_Objectives",
                description: "Scenario-specific objectives such as upselling, retention, survey capture, complaint de-escalation, or compliance for a campaign.",
                weight: 10
            }
        ]
    }
};

const PROMPT_TEMPLATE = `You are an expert contact center quality assurance evaluator. Score this call transcript based on the rubric and scenario objectives.

SCORING RUBRIC:
{scoring_rubric}

PRIMARY OBJECTIVES (Agent should achieve these):
{primary_objectives}

SECONDARY OBJECTIVES (Nice to have):
{secondary_objectives}

CALL TRANSCRIPT:
{call_transcript}

INSTRUCTIONS:
1. Evaluate each general criterion (score 1-5: 1=Poor, 5=Excellent). Use the exact criterion name as the key.
2. Return the general criteria result in the same order as specified in the SCORING_RUBRIC.
3. Score EACH primary objective individually - use the exact objective text as the key
4. Score EACH secondary objective individually - use the exact objective text as the key
5. Calculate weighted total score (0-100)
6. Provide brief justifications for each score
7. Assess customer sentiment at the start, during, and at the end of the call (Negative/Neutral/Positive)

RESPONSE FORMAT (JSON only, use exact objective text as keys):
{
  "general_objectives": {
    "<exact criterion text 1>": {"score": X, "justification": "brief"},
    "<exact criterion text 2>": {"score": X, "justification": "brief"},
  },
  "scenario_objectives_primary": {
    "<exact objective text 1>": {"score": X, "justification": "brief"},
    "<exact objective text 2>": {"score": X, "justification": "brief"},
    "summary": "detailed summary of primary objectives performance"
  },
  "scenario_objectives_secondary": {
    "<exact objective text 1>": {"score": X, "justification": "brief"},
    "summary": "detailed summary of secondary objectives performance"
  },
  "customer_sentiment": {
    "start": {"sentiment": "Negative|Neutral|Positive", "justification": "brief"},
    "mid_call": {"sentiment": "Negative|Neutral|Positive", "justification": "brief"},
    "end": {"sentiment": "Negative|Neutral|Positive", "justification": "brief"}
  },
  "overall_score": X,
  "summary": "overall assessment of agent performance"
}`;

interface EvaluationRequest {
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

class EvaluationService {
    private bedrockClient: BedrockRuntimeClient;
    private dynamoClient: DynamoDBClient;
    private tableName: string;

    constructor() {
        this.bedrockClient = new BedrockRuntimeClient({ region: DEFAULT_REGION });
        this.dynamoClient = new DynamoDBClient({ region: DEFAULT_REGION });
        this.tableName = process.env.EVALUATIONS_TABLE_NAME || `nextgen-agent-trainer-${process.env.Environment || 'dev'}-evaluations`;
    }

    async evaluate(request: EvaluationRequest) {
        const transcriptHash = this.computeTranscriptHash(
            request.call_transcript,
            request.scenario_objectives || {}
        );

        const cached = await this.getCachedEvaluation(transcriptHash);
        
        if (cached) {
            logger.log('Cache hit for transcript hash:', transcriptHash);
            return {
                ...cached.full_response,
                user_name: request.user_name,
                scenario_name: request.scenario_name,
                timestamp: cached.timestamp
            };
        }

        const scoreResult = await this.scoreWithBedrock(
            request.call_transcript,
            request.scenario_objectives || {}
        );

        await this.saveToDatabase(request, scoreResult, transcriptHash);

        return {
            ...scoreResult,
            user_name: request.user_name,
            scenario_name: request.scenario_name,
            timestamp: new Date().toISOString()
        };
    }

    private computeTranscriptHash(transcript: string, objectives: any): string {
        const content = transcript + JSON.stringify(objectives);
        return createHash('sha256').update(content, 'utf-8').digest('hex');
    }

    prepareTranscript(transcript: string): TranscriptPayload {
        const originalSize = Buffer.byteLength(transcript, 'utf-8');

        if (originalSize <= 350_000) {
            return {
                call_transcript: transcript,
                transcript_size_bytes: originalSize,
                transcript_truncated: false,
                transcript_compressed: false,
            };
        }

        const compressed = gzipSync(Buffer.from(transcript, 'utf-8')).toString('base64');
        const compressedSize = Buffer.byteLength(compressed, 'utf-8');

        if (compressedSize + 50_000 < 400_000) {
            return {
                call_transcript: compressed,
                transcript_size_bytes: originalSize,
                transcript_truncated: false,
                transcript_compressed: true,
            };
        }

        // Truncate original transcript to fit within limits
        const maxTranscriptBytes = 300_000;
        const truncated = transcript.substring(0, maxTranscriptBytes);
        return {
            call_transcript: truncated,
            transcript_size_bytes: originalSize,
            transcript_truncated: true,
            transcript_compressed: false,
        };
    }

    decompressTranscript(record: any): string {
        if (record.transcript_compressed && record.call_transcript) {
            try {
                const buffer = Buffer.from(record.call_transcript, 'base64');
                return gunzipSync(buffer).toString('utf-8');
            } catch (error) {
                logger.error('Failed to decompress transcript:', error);
                return record.call_transcript;
            }
        }
        return record.call_transcript || '';
    }

    async getEvaluationsByUser(userName: string, limit?: number): Promise<any[]> {
        try {
            const params: any = {
                TableName: this.tableName,
                IndexName: 'user_name-timestamp-index',
                KeyConditionExpression: 'user_name = :userName',
                ExpressionAttributeValues: marshall({
                    ':userName': userName
                }),
                ScanIndexForward: false
            };

            if (limit && limit > 0) {
                params.Limit = limit;
            }

            const response = await this.dynamoClient.send(new QueryCommand(params));

            if (!response.Items || response.Items.length === 0) {
                return [];
            }

            return response.Items.map(item => {
                const record = unmarshall(item);
                record.call_transcript = this.decompressTranscript(record);
                return record;
            });
        } catch (error) {
            logger.error('Failed to query evaluations by user:', error);
            throw error;
        }
    }


    private async getCachedEvaluation(transcriptHash: string): Promise<any | null> {
        try {
            const response = await this.dynamoClient.send(new QueryCommand({
                TableName: this.tableName,
                IndexName: 'transcript_hash-index',
                KeyConditionExpression: 'transcript_hash = :hash',
                ExpressionAttributeValues: marshall({
                    ':hash': transcriptHash
                }),
                Limit: 1
            }));

            if (response.Items && response.Items.length > 0) {
                return unmarshall(response.Items[0]);
            }

            return null;
        } catch (error) {
            logger.error('Failed to query cache:', error);
            return null;
        }
    }

    private async scoreWithBedrock(transcript: string, objectives: any) {
        const primaryObjectives = objectives.primary_objectives || [];
        const secondaryObjectives = objectives.secondary_objectives || [];
        
        const primaryList = primaryObjectives.length > 0 
            ? primaryObjectives.map((obj: string, i: number) => `${i + 1}. ${obj}`).join('\n')
            : 'None specified';
        const secondaryList = secondaryObjectives.length > 0
            ? secondaryObjectives.map((obj: string, i: number) => `${i + 1}. ${obj}`).join('\n')
            : 'None specified';
        
        const prompt = PROMPT_TEMPLATE
            .replace('{scoring_rubric}', JSON.stringify(SCORING_RUBRIC, null, 2))
            .replace('{primary_objectives}', primaryList)
            .replace('{secondary_objectives}', secondaryList)
            .replace('{call_transcript}', transcript);

        try {
            const response = await this.bedrockClient.send(new ConverseCommand({
                modelId: REASONING_MODEL_ID,
                messages: [{ role: "user", content: [{ text: prompt }] }],
                inferenceConfig: { maxTokens: MAX_TOKENS }
            }));

            const content = response.output?.message?.content?.[0];
            if (!content || !('text' in content) || !content.text) {
                throw new Error('Invalid response from Bedrock');
            }

            let result;
            try {
                result = JSON.parse(content.text);
            } catch {
                const jsonMatch = content.text.match(/\{.*\}/s);
                if (jsonMatch) {
                    result = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('Failed to parse JSON from response');
                }
            }
            
            // Round overall_score to integer
            if (typeof result.overall_score === 'number') {
                result.overall_score = Math.round(result.overall_score);
            }
            
            return result;
        } catch (error) {
            logger.error('Bedrock evaluation failed, using defaults:', error);
            return this.getDefaultScore();
        }
    }

    private async saveToDatabase(request: EvaluationRequest, scoreResult: any, transcriptHash: string) {
        const timestamp = new Date().toISOString();
        const pk = `${request.user_name}#${request.scenario_name}#${timestamp}`;

        const transcriptPayload = this.prepareTranscript(request.call_transcript);

        try {
            await this.dynamoClient.send(new PutItemCommand({
                TableName: this.tableName,
                Item: marshall({
                    pk,
                    user_name: request.user_name,
                    scenario_name: request.scenario_name,
                    overall_score: scoreResult.overall_score,
                    timestamp,
                    transcript_hash: transcriptHash,
                    full_response: scoreResult,
                    call_transcript: transcriptPayload.call_transcript,
                    transcript_size_bytes: transcriptPayload.transcript_size_bytes,
                    transcript_truncated: transcriptPayload.transcript_truncated,
                    transcript_compressed: transcriptPayload.transcript_compressed,
                })
            }));
        } catch (error) {
            logger.error('Failed to save evaluation to DynamoDB:', error);
        }
    }

    private getDefaultScore() {
        return {
            general_objectives: {
                greeting_introduction: { score: 3, justification: "Default - Bedrock unavailable" },
                active_listening: { score: 3, justification: "Default - Bedrock unavailable" },
                empathy_tone: { score: 3, justification: "Default - Bedrock unavailable" },
                clarity_communication: { score: 3, justification: "Default - Bedrock unavailable" },
                probing_clarification: { score: 3, justification: "Default - Bedrock unavailable" },
                product_knowledge: { score: 3, justification: "Default - Bedrock unavailable" },
                ownership_accountability: { score: 3, justification: "Default - Bedrock unavailable" },
                problem_resolution: { score: 3, justification: "Default - Bedrock unavailable" },
                compliance_policy: { score: 3, justification: "Default - Bedrock unavailable" },
                efficiency_control: { score: 3, justification: "Default - Bedrock unavailable" },
                closing: { score: 3, justification: "Default - Bedrock unavailable" }
            },
            scenario_objectives_primary: {
                primary1: { score: 3, justification: "Default - Bedrock unavailable" },
                summary: "Default scoring - Bedrock unavailable"
            },
            scenario_objectives_secondary: {
                secondary1: { score: 3, justification: "Default - Bedrock unavailable" },
                summary: "Default scoring - Bedrock unavailable"
            },
            customer_sentiment: {
                start: { sentiment: "Neutral", justification: "Default - Bedrock unavailable" },
                mid_call: { sentiment: "Neutral", justification: "Default - Bedrock unavailable" },
                end: { sentiment: "Neutral", justification: "Default - Bedrock unavailable" }
            },
            overall_score: 60,
            summary: "Default scoring - Bedrock unavailable"
        };
    }
}

export const evaluationService = new EvaluationService();
