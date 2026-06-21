import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SCENARIOS_TABLE = process.env.SCENARIOS_TABLE_NAME || "nextgen-scenarios";

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

export async function getScenariosByBusiness(businessName: string): Promise<Scenario[]> {
  const command = new QueryCommand({
    TableName: SCENARIOS_TABLE,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: {
      ":pk": `BUSINESS#${businessName}`,
    },
  });

  const response = await docClient.send(command);
  return (response.Items || []) as Scenario[];
}

export async function getScenario(businessName: string, scenarioId: string): Promise<Scenario | null> {
  const command = new GetCommand({
    TableName: SCENARIOS_TABLE,
    Key: {
      PK: `BUSINESS#${businessName}`,
      SK: `SCENARIO#${scenarioId}`,
    },
  });

  const response = await docClient.send(command);
  return (response.Item as Scenario) || null;
}


export async function getAvailableBusinesses(): Promise<string[]> {
  const command = new ScanCommand({
    TableName: SCENARIOS_TABLE,
    ProjectionExpression: "businessName",
  });

  const response = await docClient.send(command);
  const businesses = [...new Set((response.Items || []).map(item => item.businessName as string))];
  return businesses.sort();
}
