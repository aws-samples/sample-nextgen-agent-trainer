import { DEFAULT_REGION, TRANSCRIPT_BUCKET_NAME } from "./consts";
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { logger } from "./logger";
import { Buffer } from "node:buffer";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { evaluationService } from "./evaluation-service";

interface TranscriptRequest {
    agentId: string;
    messages: Array<string>;
    persona: string;
    scenario: string;
    primary_objectives: Array<string>;
    secondary_objectives: Array<string>;
}

interface TranscriptResponse {
    downloadUrl: string
}

class ConversationService {
    private s3Client: S3Client;

    constructor() {
        if (!TRANSCRIPT_BUCKET_NAME) {
            throw new Error("TRANSCRIPT_BUCKET_NAME environment variable is required");
        }
        
        this.s3Client = new S3Client({
            region: DEFAULT_REGION
        });
    }

    async evaluate(request: TranscriptRequest) {
        const transcript = request.messages
            .filter((item: any) => item.role === "USER" || item.role === "ASSISTANT")
            .map((item: any) => 
                item.role === "USER" 
                    ? `AGENT: ${item.message}` 
                    : `CUSTOMER: ${item.message}`
            )
            .join('\n');

        try {
            return await evaluationService.evaluate({
                user_name: request.agentId,
                scenario_name: `${request.persona} - ${request.scenario}`,
                call_transcript: transcript,
                scenario_objectives: {
                    primary_objectives: request.primary_objectives,
                    secondary_objectives: request.secondary_objectives
                }
            });
        } catch (error) {
            logger.error('Error evaluating conversation:', error);
            throw error;
        }
    }

    async saveTranscript(request: TranscriptRequest): Promise<TranscriptResponse> {
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '').replace('Z', '');
        const date = timestamp.substring(0, 8);

        const transcriptKey = `transcripts/${date}/${request.agentId}_${timestamp}.txt`;
        logger.debug(`Saving transcript to ${TRANSCRIPT_BUCKET_NAME}/${transcriptKey}`);

        /*
            each item in request.messages has the following format
            { role: "USER", message: "some text" }
            where role can be "USER", "ASSISTANT", "AI"
            create a transcript of the conversation between the USER and ASSISTANT, filter out AI, replace "USER" with "YOU" and "ASSISTANT" with "CUSTOMER" in the transcript
         */
        let transcript: string;
        transcript = request.messages
            .filter((item: any) => item.role === "USER" || item.role === "ASSISTANT")
            .map((item: any) => {
                if (item.role === "USER") {
                    return `AGENT: ${item.message}`;
                } else {
                    return `CUSTOMER: ${item.message}`;
                }
            })
            .join('\n');

        try {
            await this.s3Client.send(new PutObjectCommand({
                Bucket: TRANSCRIPT_BUCKET_NAME,
                Key: transcriptKey,
                Body: transcript,
                ContentType: 'text/plain'
            }));

            // generate an S3 presigned URL to the transcript object
            const expiresInSeconds = 600; // URL valid for 5 min (in seconds)

            const getObjectParams = {
                Bucket: TRANSCRIPT_BUCKET_NAME,
                Key: transcriptKey, // The path to your file in S3
            };

            const getCommand = new GetObjectCommand(getObjectParams);
            const downloadUrl = await getSignedUrl(this.s3Client, getCommand, { expiresIn: expiresInSeconds });
            logger.debug("Presigned download URL:", downloadUrl);

            return { downloadUrl };
        } catch (error) {
            logger.error('Error saving transcript:', error);
            throw error;
        }
    }

    async uploadRecording(sessionId: string, audioBuffer: Buffer): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '').replace('Z', '');
        const date = timestamp.substring(0, 8);

        const key = `recordings/${date}/${sessionId}-${timestamp}.raw`;
        logger.debug(`Saving recording to ${TRANSCRIPT_BUCKET_NAME}/${key}`);

        try {
            // upload the tempfile to S3

            await this.s3Client.send(new PutObjectCommand({
                Bucket: TRANSCRIPT_BUCKET_NAME,
                Key: key,
                Body: audioBuffer
            }));

            const s3Url = `s3://${TRANSCRIPT_BUCKET_NAME}/${key}`;
            logger.log(`Raw audio uploaded to S3: ${s3Url}`);
            return s3Url;
        } catch (error) {
            logger.error(`Failed to upload audio to S3:`, error);
            throw error;
        }
    }
}

const conversationService = new ConversationService();

export {conversationService, TranscriptRequest, TranscriptResponse}