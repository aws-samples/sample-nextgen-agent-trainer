import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {DynamoDBDocumentClient, GetCommand, PutCommand} from "@aws-sdk/lib-dynamodb";
import { DEFAULT_REGION } from "./consts";
import { logger } from "./logger";

interface Demographics {
    age: number;
    gender: string;
    location: string;
}

interface Behavior {
    communicationStyle: string;
    emotionalState: string;
}

interface Objectives {
    primary: string[];
    secondary?: string[];
}

interface Scenario {
    scenarioId: string;
    personaName: string;
    scenarioName: string;
    voiceId: string;
    demographics: Demographics;
    behavior: Behavior;
    customerObjectives: Objectives;
    agentObjectives: Objectives;
    prompt: string;
    businessName?: string;
    createdAt?: string;
    updatedAt?: string;
}

interface CreateScenarioResponse {
    id: string;
    system_prompt: string;
}

interface GetScenarioResponse {
    scenario: Scenario;
    system_prompt: string;
}

class ScenarioService {
    private ddbClient: DynamoDBClient;
    private docClient: DynamoDBDocumentClient;
    private tableName: string;

    constructor() {
        if (!process.env.SCENARIOS_TABLE_NAME) {
            throw new Error("SCENARIOS_TABLE_NAME environment variable is required");
        }
        
        this.ddbClient = new DynamoDBClient({
            region: DEFAULT_REGION
        });
        this.docClient = DynamoDBDocumentClient.from(this.ddbClient);
        this.tableName = process.env.SCENARIOS_TABLE_NAME;
    }

    async create(request: Scenario, businessName: string, scenarioId: string): Promise<CreateScenarioResponse> {
        const scenario = request;

        try {
            const now = new Date().toISOString();
            const item = {
                PK: `BUSINESS#${businessName}`,
                SK: `SCENARIO#${scenarioId}`,
                ...scenario,
                businessName,
                scenarioId,
                createdAt: scenario.createdAt ?? now,
                updatedAt: now
            };

            const response = await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: item
            }));
            logger.debug("DDB put item response:", response);

            const systemPrompt = this.generatePrompt(item);

            return {
                id: scenarioId,
                system_prompt: systemPrompt
            };
        } catch (error) {
            logger.error('Error creating scenario:', error);
            throw error;
        }
    }

    async get(businessName: string, scenarioId: string): Promise<GetScenarioResponse | null> {
        try {
            const response = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: `BUSINESS#${businessName}`,
                    SK: `SCENARIO#${scenarioId}`
                }
            }));
            logger.debug("DDB get item response:", response);

            const item = response.Item as Scenario;
            const systemPrompt = (item != undefined) ? this.generatePrompt(item) : "";

            return {
                scenario: item,
                system_prompt: systemPrompt
            }
        } catch (error) {
            logger.error('Error getting scenario:', error);
            throw error;
        }
    }

    generatePrompt(data: Scenario): string {
        return data.prompt;
    }
}

export {ScenarioService, CreateScenarioResponse}