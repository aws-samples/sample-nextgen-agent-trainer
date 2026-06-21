import {RetrievalResult, searchKnowledgeBase} from "./knowledge-base-lookup";
import { logger } from './logger';

// Helper to get today's date in YYYY-MM-DD format
const getTodayDate = (): string => {
    return new Date().toISOString().split('T')[0];
};

// Helper function to extract request ID from tool use
function extractRequestId(toolUse: any): string {
    try {
        // Try to extract a request ID or session ID from the tool use
        if (toolUse && typeof toolUse === 'object') {
            if (toolUse.requestId) return toolUse.requestId;
            if (toolUse.sessionId) return toolUse.sessionId;
            if (toolUse.toolUseId) return toolUse.toolUseId.substring(0, 8);
        }
    } catch (e) {
        // Ignore extraction errors
    }
    return 'tool-call';
}

// Example usage for LLM integration
export const processToolCalls = async (toolName: string, toolInput: any): Promise<any> => {
    switch (toolName) {
        case 'searchKnowledgeBaseTool':
            return await searchKnowledgeBase(toolInput);

        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
};

// Example of handling a tool call from Amazon Nova Sonic
export const handleToolCall = async (toolUse: any): Promise<any> => {
    // Extract request ID if available for logging context
    const requestId = extractRequestId(toolUse);
    const toolLogger = logger.withSession(requestId);
    
    toolLogger.log(`Received tool call: ${JSON.stringify(toolUse)}`);
    const { toolName, content } = toolUse;

    // Parse the content string into a JavaScript object
    const contentObject = JSON.parse(content);
    toolLogger.log(`Parsed content: ${JSON.stringify(contentObject)}`);

    try {
        const result = await processToolCalls(toolName, contentObject);
        toolLogger.log(`Tool call result: ${JSON.stringify(result)}`);
        if (result != null) {
            return {
                toolResult: {
                    content: [{ result }],
                    status: "success"
                }
            };
        }
        else {
            return {
                toolResult: {
                    content: [{ status: "No results found" }],
                    status: "error"
                }
            };
        }
    } catch (error) {
        const toolResult = {
            toolResult: {
                content: [{ text: `Error processing tool call: ${error}` }],
                status: "error"
            }
        };
        toolLogger.log(`Returning tool result: ${JSON.stringify(toolResult)}`);
        return toolResult;
    }
};
