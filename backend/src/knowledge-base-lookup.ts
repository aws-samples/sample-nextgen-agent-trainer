import {BedrockAgentRuntimeClient, RetrieveCommand} from "@aws-sdk/client-bedrock-agent-runtime";
import * as dotenv from 'dotenv';
import {DEFAULT_REGION, KNOWLEDGE_BASE_ID} from "./consts";
import {logger} from './logger';

interface RetrievalResult {
    // Add specific properties based on your actual response structure
    [key: string]: any;
}

interface SearchKnowledgeBaseParams {
    query: string;
    businessName?: string;
}

function getKnowledgeBaseId(): string {
    // Load environment variables from .env file
    dotenv.config();

    // Get the knowledge base ID from environment variable
    const knowledgeBaseId = KNOWLEDGE_BASE_ID;

    if (!knowledgeBaseId) {
        throw new Error("KNOWLEDGE_BASE_ID not found - Knowledge Base may not be configured");
    }

    return knowledgeBaseId;
}

const searchKnowledgeBase = async (params: SearchKnowledgeBaseParams): Promise<RetrievalResult[]> => {
    // Check if Knowledge Base is configured
    if (!KNOWLEDGE_BASE_ID) {
        logger.warn("[KB] Knowledge Base not configured (KNOWLEDGE_BASE_ID not set) — skipping KB lookup");
        return [];
    }

    const knowledgeBaseId = getKnowledgeBaseId();
    logger.log(`[KB] Knowledge Base activated — id: ${knowledgeBaseId}`);

    try {
        const bedrockAgent = new BedrockAgentRuntimeClient({
            region: DEFAULT_REGION
        });

        // Build vertical filter if businessName provided and DATA_BUCKET_NAME is set
        const dataBucket = process.env.DATA_BUCKET_NAME;
        const verticalFilter = params.businessName && dataBucket
            ? {
                startsWith: {
                    key: 'x-amz-bedrock-kb-source-uri',
                    value: `s3://${dataBucket}/kb/${params.businessName}/`
                }
              }
            : undefined;

        if (params.businessName) {
            if (verticalFilter) {
                logger.log(`[KB] Applying vertical filter — business: ${params.businessName}, prefix: s3://${dataBucket}/kb/${params.businessName}/`);
            } else {
                logger.warn(`[KB] businessName provided (${params.businessName}) but DATA_BUCKET_NAME not set — querying without vertical filter`);
            }
        } else {
            logger.log('[KB] No businessName provided — querying across all verticals');
        }

        // Retrieve from your KB using the query
        const commandParams: any = {
            knowledgeBaseId: knowledgeBaseId,
            retrievalQuery: {text: params.query},
            retrievalConfiguration: {
                vectorSearchConfiguration: {
                    numberOfResults: 1,
                    ...(verticalFilter && { filter: verticalFilter })
                }
            }
        };

        logger.log(`[KB] Query: "${params.query.substring(0, 80)}${params.query.length > 80 ? '...' : ''}"`);

        const command = new RetrieveCommand(commandParams);
        const response = await bedrockAgent.send(command);

        // Format the results
        const results: RetrievalResult[] = [];

        if (response.retrievalResults) {
            for (const item of response.retrievalResults) {
                results.push(item);
            }
        }

        logger.log(`[KB] Retrieved ${results.length} result(s)${results.length > 0 ? `, top score: ${results[0].score?.toFixed(3)}` : ''}`);
        if (results.length > 0) {
            results.forEach((r, i) => {
                logger.log(`[KB]   [${i + 1}] score=${r.score?.toFixed(3)} source=${r.location?.s3Location?.uri || r.location?.uri || 'unknown'}`);
            });
        }

        return results;
    } catch (error) {
        logger.error('[KB] Error during retrieval:', error);
        throw error;
    }
}

export { searchKnowledgeBase, getKnowledgeBaseId, RetrievalResult };
