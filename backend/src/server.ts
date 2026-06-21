import express from 'express';
import http from 'http';
import {Server} from 'socket.io';
import {NovaSonicBidirectionalStreamClient} from './client';
import {Buffer} from 'node:buffer';
import {logger} from './logger';
import {SuggestionsService} from './suggestions-service';
import * as CONFIG from "./consts";
import {conversationService} from "./conversation-service";
import {evaluationService} from "./evaluation-service";
import {ScenarioService} from "./scenario-service";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import rateLimit from 'express-rate-limit';

// Validate required environment variables
const requiredEnvVars = [
    'AWS_REGION',
    'TRANSCRIPT_BUCKET_NAME',
    'SCENARIOS_TABLE_NAME',
    'NOVA_MODEL_ID',
    'REASONING_MODEL_ID'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    logger.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

logger.log('Environment validation passed');
logger.log(`Using Nova Model: ${CONFIG.NOVA_MODEL_ID}`);
logger.log(`Using Reasoning Model: ${CONFIG.REASONING_MODEL_ID}`);
logger.log(`Knowledge Base: ${CONFIG.KNOWLEDGE_BASE_ID ? 'Enabled' : 'Disabled'}`);

// Create Express app and HTTP server
const app = express();
app.set('trust proxy', 1); // Trust ALB X-Forwarded-For header for rate limiting
const server = http.createServer(app);

// Initialize Cognito JWT Verifier
let jwtVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

if (CONFIG.COGNITO_USER_POOL_ID && CONFIG.COGNITO_APP_CLIENT) {
    jwtVerifier = CognitoJwtVerifier.create({
        userPoolId: CONFIG.COGNITO_USER_POOL_ID,
        clientId: CONFIG.COGNITO_APP_CLIENT,
        tokenUse: "access",
    });
    logger.log('Cognito JWT Verifier initialized');
} else {
    logger.log('Cognito not configured - JWT verification disabled');
}

// Token verification function
async function verifyToken(token: string): Promise<boolean> {
    if (!token) return false;
    
    // If Cognito not configured, fall back to basic expiry check (dev mode)
    if (!jwtVerifier) {
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            return payload.exp * 1000 > Date.now();
        } catch {
            return false;
        }
    }
    
    try {
        await jwtVerifier.verify(token);
        return true;
    } catch (error) {
        logger.error('JWT verification failed:', error);
        return false;
    }
}

// Rate limiting configuration
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

const suggestionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 suggestions per minute
    message: { error: 'Too many suggestion requests, please slow down' },
});

const evaluateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 evaluations per minute
    message: { error: 'Too many evaluation requests, please wait' },
});

// Add CORS middleware for HTTP endpoints
app.use((req, res, next) => {
  const allowedOrigins = [
    CONFIG.COGNITO_REDIRECT_URI || "http://localhost:3000",
    process.env.CLOUDFRONT_DOMAIN ? `https://${process.env.CLOUDFRONT_DOMAIN}` : null,
  ].filter(Boolean).map(o => (o as string).replace(/\/$/, '')) as string[];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Add JSON parsing middleware
app.use(express.json());

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

const io = new Server(server, {
  cors: {
    origin: [
      CONFIG.COGNITO_REDIRECT_URI || "http://localhost:3000",
      process.env.CLOUDFRONT_DOMAIN ? `https://${process.env.CLOUDFRONT_DOMAIN}` : "",
    ].filter(Boolean).map(o => o.replace(/\/$/, '')),
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Create the AWS Bedrock client
const bedrockClient = new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
        maxConcurrentStreams: 10,
    },
    clientConfig: {
        region: CONFIG.DEFAULT_REGION
        // No credentials needed - SDK uses default chain automatically
    }
});

// create services
const suggestionsService = new SuggestionsService();
const scenarioService = new ScenarioService();

// Periodically check for and close inactive sessions (every minute)
// Sessions with no activity for over 5 minutes will be force closed
setInterval(() => {
    const connectionCount = Object.keys(io.sockets.sockets).length;
    if (connectionCount > 0) {
        logger.log(`Active socket connections: ${connectionCount}`);
    }
    const now = Date.now();

    // Check all active sessions
    bedrockClient.getActiveSessions().forEach(sessionId => {
        const lastActivity = bedrockClient.getLastActivityTime(sessionId);

        // If no activity for 5 minutes, force close
        if (now - lastActivity > 5 * 60 * 1000) {
            logger.log(`Closing inactive session ${sessionId} after 5 minutes of inactivity`);
            try {
                bedrockClient.forceCloseSession(sessionId);
            } catch (error) {
                logger.error(`Error force closing inactive session ${sessionId}:`, error);
            }
        }
    });
}, 60000);

// API routes
import scenariosRouter from './scenarios-routes';
app.use('/api/scenarios', scenariosRouter);

// Socket.IO connection handler with authentication
io.on('connection', async (socket) => {
    const sessionId = socket.id;
    const sessionLogger = logger.withSession(sessionId);
    
    // Check for authentication token
    const token = socket.handshake.auth.token;
    const isValid = await verifyToken(token);
    if (!isValid) {
        sessionLogger.log('Unauthorized connection attempt');
        socket.emit('auth_error', { message: 'Authentication required' });
        socket.disconnect();
        return;
    }
    
    sessionLogger.log('Authenticated client connected');

    try {
        // Create session with the new API
        const session = bedrockClient.createStreamSession(sessionId);
        bedrockClient.initiateSession(sessionId)

        // Set up event handlers
        session.onEvent('contentStart', (data) => {
            sessionLogger.log('contentStart:', data);
            socket.emit('contentStart', data);
        });

        session.onEvent('textOutput', (data) => {
            sessionLogger.log('Text output:', data);
            socket.emit('textOutput', data);
        });

        session.onEvent('audioOutput', (data) => {
            //sessionLogger.debug('Audio output received, sending to client');
            socket.emit('audioOutput', data);
        });

        session.onEvent('error', (data) => {
            sessionLogger.error('Error in session:', data);
            socket.emit('error', data);
        });

        session.onEvent('toolUse', (data) => {
            sessionLogger.log('Tool use detected:', data.toolName);
            socket.emit('toolUse', data);
        });

        session.onEvent('toolResult', (data) => {
            sessionLogger.log('Tool result received');
            socket.emit('toolResult', data);
        });

        session.onEvent('contentEnd', (data) => {
            sessionLogger.log('Content end received', data);
            socket.emit('contentEnd', data);
        });

        session.onEvent('streamComplete', () => {
            sessionLogger.log('Stream completed for client');
            socket.emit('streamComplete');
        });

        // Simplified audioInput handler without rate limiting
        socket.on('audioInput', async (audioData) => {
            try {
                // Convert base64 string to Buffer
                const audioBuffer = typeof audioData === 'string'
                    ? Buffer.from(audioData, 'base64')
                    : Buffer.from(audioData.content);

                // Stream the audio
                await session.streamAudio(audioBuffer);

            } catch (error) {
                logger.error('Error processing audio:', error);
                socket.emit('error', {
                    message: 'Error processing audio',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('promptStart', async (data) => {
            try {
                sessionLogger.log('Prompt start received', data);
                await session.setupPromptStart(data);
            } catch (error) {
                sessionLogger.error('Error processing prompt start:', error);
                socket.emit('error', {
                    message: 'Error processing prompt start',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('systemPrompt', async (data) => {
            try {
                sessionLogger.log('System prompt received', data);
                await session.setupSystemPrompt(undefined, data);
            } catch (error) {
                sessionLogger.error('Error processing system prompt:', error);
                socket.emit('error', {
                    message: 'Error processing system prompt',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('audioStart', async (data) => {
            try {
                sessionLogger.log('Audio start received', data);
                await session.setupStartAudio();
            } catch (error) {
                sessionLogger.error('Error processing audio start:', error);
                socket.emit('error', {
                    message: 'Error processing audio start',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('stopAudio', async () => {
            try {
                sessionLogger.log('Stop audio requested, beginning proper shutdown sequence');

                // Wait a bit for any pending audio to be processed
                await new Promise(resolve => setTimeout(resolve, 100));

                // Chain the closing sequence
                await session.endAudioContent();
                await session.endPrompt();
                await session.close();
                sessionLogger.log('Session cleanup complete');
            } catch (error) {
                sessionLogger.error('Error processing streaming end events:', error);
                socket.emit('error', {
                    message: 'Error processing streaming end events',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        // Handle disconnection
        socket.on('disconnect', async () => {
            sessionLogger.log('Client disconnected abruptly');

            if (bedrockClient.isSessionActive(sessionId)) {
                try {
                    sessionLogger.log(`Beginning cleanup for abruptly disconnected session`);

                    // Wait for any pending audio processing
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // Add explicit timeouts to avoid hanging promises
                    const cleanupPromise = Promise.race([
                        (async () => {
                            await session.endAudioContent();
                            await session.endPrompt();
                            await session.close();
                        })(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Session cleanup timeout')), 120000)
                        )
                    ]);

                    await cleanupPromise;
                    sessionLogger.log(`Successfully cleaned up session after abrupt disconnect`);
                } catch (error) {
                    sessionLogger.error(`Error cleaning up session after disconnect`, error);
                    try {
                        bedrockClient.forceCloseSession(sessionId);
                        sessionLogger.log(`Force closed session`);
                    } catch (e) {
                        sessionLogger.error(`Failed even force close for session`, e);
                    }
                } finally {
                    // Make sure socket is fully closed in all cases
                    if (socket.connected) {
                        socket.disconnect(true);
                    }
                }
            }
        });

    } catch (error) {
        sessionLogger.error('Error creating session:', error);
        socket.emit('error', {
            message: 'Failed to initialize session',
            details: error instanceof Error ? error.message : String(error)
        });
        socket.disconnect();
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cognito configuration endpoint
app.get('/auth/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
        userPoolId: CONFIG.COGNITO_USER_POOL_ID,
        clientId: CONFIG.COGNITO_APP_CLIENT,
        domain: CONFIG.COGNITO_DOMAIN,
        redirectUri: CONFIG.COGNITO_REDIRECT_URI
    });
});

// Agent suggestion endpoint with knowledge base integration
app.post('/api/agent-suggestion', suggestionLimiter, async (req, res) => {
    logger.log('Received agent suggestion request:', req.body);
    try {
        const result = await suggestionsService.getAgentSuggestion(req.body);
        logger.log('Agent suggestion:', result);
        res.json(result);
    } catch (error) {
        logger.error('Error in agent suggestion endpoint:', error);
        res.status(500).json({
            error: 'Failed to get agent suggestion',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

// create scenario
app.post('/api/create-persona', async (req, res) => {
    logger.log('Received create persona request:', req.body);
    try {
        const { businessName, scenarioId, ...scenario } = req.body;
        const result = await scenarioService.create(scenario, businessName, scenarioId);
        logger.log('create scenario response:', result);
        res.json(result);
    } catch (error) {
        logger.error('Error in persona endpoint:', error);
        res.status(500).json({
            error: 'Failed to create scenario',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

// add code to handle /scenario/{id}
app.get('/api/persona/:id', async (req, res) => {
    logger.log('Received get scenario request:', req.params);
    try {
        const [businessName, scenarioId] = req.params.id.split(':');
        const result = await scenarioService.get(businessName, scenarioId);
        logger.log('get scenario response:', result);
        res.json(result);
    } catch (error) {
        logger.error('Error in scenario endpoint:', error);
        res.status(500).json({
            error: 'Failed to get scenario',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

// evaluate the conversation
app.post('/api/evaluate', evaluateLimiter, async (req, res) => {
    logger.log('Received evaluate request:', req.body);
    try {
        const result = await conversationService.evaluate(req.body);
        logger.log('evaluate response:', result);
        res.json(result);
    } catch (error) {
        logger.error('Error in evaluate endpoint:', error);
        res.status(500).json({
            error: 'Failed to evaluate conversation',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

// save the transcript to S3
app.post('/api/transcript', async (req, res) => {
    logger.log('Received transcript request:', req.body);
    try {
        const result = await conversationService.saveTranscript(req.body);
        logger.log('saveTranscript response:', result);
        res.json(result);
    } catch (error) {
        logger.error('Error in transcript endpoint:', error);
        res.status(500).json({
            error: 'Failed to save transcript',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});


// Get evaluation history for a user
app.get('/api/evaluations', async (req, res) => {
    const userName = req.query.user_name as string;
    if (!userName) {
        return res.status(400).json({ error: 'user_name query parameter is required' });
    }

    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        const results = await evaluationService.getEvaluationsByUser(userName, limit);
        res.json(results);
    } catch (error) {
        logger.error('Error in evaluations endpoint:', error);
        res.status(500).json({
            error: 'Failed to fetch evaluation history',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.log(`Server listening on port ${PORT}`);
    //logger.log(`Open http://localhost:${PORT} in your browser to access the application`);
});

process.on('SIGINT', async () => {
    logger.log('Shutting down server...');

    const forceExitTimer = setTimeout(() => {
        logger.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 120000);

    try {
        // First close Socket.IO server which manages WebSocket connections
        await new Promise(resolve => io.close(resolve));
        logger.log('Socket.IO server closed');

        // Then close all active sessions
        const activeSessions = bedrockClient.getActiveSessions();
        logger.log(`Closing ${activeSessions.length} active sessions...`);

        await Promise.all(activeSessions.map(async (sessionId) => {
            try {
                await bedrockClient.closeSession(sessionId);
                logger.log(`Closed session ${sessionId} during shutdown`);
            } catch (error) {
                logger.error(`Error closing session ${sessionId} during shutdown:`, error);
                bedrockClient.forceCloseSession(sessionId);
            }
        }));

        // Now close the HTTP server with a promise
        await new Promise(resolve => server.close(resolve));
        clearTimeout(forceExitTimer);
        logger.log('Server shut down');
        process.exit(0);
    } catch (error) {
        logger.error('Error during server shutdown:', error);
        process.exit(1);
    }
});