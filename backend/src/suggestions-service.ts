import {BedrockRuntimeClient, ConverseCommand} from "@aws-sdk/client-bedrock-runtime";
import {logger} from './logger';
import {searchKnowledgeBase} from './knowledge-base-lookup';
import {
    AGENT_SUGGESTION_PROMPT,
    DEFAULT_REGION, KB_SCORE_THRESHOLD, SUGGESTIONS_MODEL_ID, SUGGESTIONS_INFERENCE_CONFIG
} from "./consts";


interface AgentSuggestionRequest {
    customerQuery: string;
    useKnowledgeBase?: boolean;
    businessName?: string;
}

interface AgentSuggestionResponse {
    suggestion: string;
    confidence: number;
    knowledgeBaseRef: string;
    nextSteps: Array<string>;
}

const EMPTY_AGENT_SUGGESTION : AgentSuggestionResponse = {
    suggestion: '',
    confidence: 0,
    knowledgeBaseRef: '',
    nextSteps: []
}

class SuggestionsService {
    private bedrockClient: BedrockRuntimeClient;

    constructor() {
        this.bedrockClient = new BedrockRuntimeClient({
            region: DEFAULT_REGION
        });
    }

    async getAgentSuggestion(request: AgentSuggestionRequest): Promise<AgentSuggestionResponse> {
        try {
            let knowledgeBaseContext = '';
            let knowledgeUsed = false;
            let knowledgeBaseScore = 0;
            let knowledgeBaseRef = '';

            // Only attempt KB search if KB is configured and not explicitly disabled
            if (request.useKnowledgeBase !== false && process.env.KNOWLEDGE_BASE_ID) {
                try {
                    const kbResults = await searchKnowledgeBase({ query: request.customerQuery, businessName: request.businessName });
                    logger.log("kbResults:", kbResults);
                    if (kbResults && kbResults.length > 0) {
                        knowledgeBaseContext = kbResults
                            .map(result => result.content?.text || '')
                            .filter(text => text.length > 0)
                            .join('\n\n');
                        knowledgeUsed = true;
                        knowledgeBaseScore = kbResults[0].score;
                        knowledgeBaseRef = kbResults[0].location?.s3Location?.uri || kbResults[0].location?.uri || kbResults[0].location?.webLocation?.url || '';
                    }
                    logger.log("knowledgeBaseContext:", knowledgeBaseContext);
                } catch (error) {
                    logger.warn('Knowledge base search failed, proceeding without KB context:', error);
                }
            } else if (!process.env.KNOWLEDGE_BASE_ID) {
                logger.log('Knowledge Base not configured, proceeding without KB context');
            }

            if (knowledgeBaseScore < KB_SCORE_THRESHOLD && knowledgeUsed) {
                return EMPTY_AGENT_SUGGESTION;
            }

            const prompt = this.buildAgentSuggestionPrompt(request.customerQuery, knowledgeBaseContext);
            logger.debug('Prompt:', prompt);

            const command = new ConverseCommand({
                modelId: SUGGESTIONS_MODEL_ID,
                messages: [
                    {
                        role: "user",
                        content: [{ text: prompt }],
                    },
                ],
                inferenceConfig: SUGGESTIONS_INFERENCE_CONFIG,
            });

            const response = await this.bedrockClient.send(command);
            logger.debug("Model response:", response);

            const responseText = response.output?.message?.content?.[0]?.text || '';

            const result = this.parseAgentResponse(responseText, knowledgeUsed);
            result.knowledgeBaseRef = knowledgeBaseRef;
            logger.debug("result:", result);

            return result;
        } catch (error) {
            logger.error('Error getting agent suggestion:', error);
            throw error;
        }
    }

    private buildAgentSuggestionPrompt(customerQuery: string, knowledgeBaseContext: string): string {
        return AGENT_SUGGESTION_PROMPT
            .replace('{customerQuery}', customerQuery)
            .replace('{knowledgeBaseContext}', knowledgeBaseContext || 'No specific knowledge base information available for this query.');
    }

    private parseAgentResponse(responseText: string, knowledgeUsed: boolean): AgentSuggestionResponse {
        logger.log("responseText:", responseText);

        try {
            const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();
            const parsed = JSON.parse(cleaned);

            return {
                suggestion: parsed.suggestion || "",
                confidence: parsed.confidence || 0,
                knowledgeBaseRef: parsed.knowledgeBaseRef || "",
                nextSteps: parsed.nextSteps || []
            };
        } catch (error) {
            logger.error('Error parsing agent suggestion response:', error);
            return EMPTY_AGENT_SUGGESTION;
        }
    }
}

export { SuggestionsService, AgentSuggestionRequest, AgentSuggestionResponse };