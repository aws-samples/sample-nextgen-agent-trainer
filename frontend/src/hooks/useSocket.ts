import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface AudioPlayerHandle {
  start: () => Promise<void>;
  stop: () => void;
  playAudio: (samples: Float32Array) => void;
  bargeIn: () => void;
}

function createAudioPlayer(): AudioPlayerHandle {
  let audioContext: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let initialized = false;

  return {
    async start() {
      audioContext = new AudioContext({ sampleRate: 24000 });
      // Chrome suspends AudioContext until explicitly resumed even during a user gesture
      // chain that crosses async boundaries. Always resume to ensure playback works.
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      await audioContext.audioWorklet.addModule('/AudioPlayerProcessor.worklet.js');
      workletNode = new AudioWorkletNode(audioContext, 'audio-player-processor');
      workletNode.connect(audioContext.destination);
      initialized = true;
    },
    stop() {
      workletNode?.disconnect();
      audioContext?.close();
      workletNode = null;
      audioContext = null;
      initialized = false;
    },
    playAudio(samples: Float32Array) {
      if (!initialized || !audioContext) return;
      // Resume if the context was suspended (e.g., autoplay policy, tab hidden)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      workletNode?.port.postMessage({ type: 'audio', audioData: samples });
    },
    bargeIn() {
      workletNode?.port.postMessage({ type: 'barge-in' });
    },
  };
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
  return float32;
}

export interface UseSocketOptions {
  accessToken: string | null;
  /** Increment to force a socket disconnect + reconnect (e.g. after a session ends) */
  reconnectKey?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onTextOutput?: (role: string, content: string) => void;
  onAiSuggestion?: (content: string) => void;
  onSessionEnd?: () => void;
  onError?: (error: string) => void;
  onAuthError?: () => void;
}

/**
 * Session configuration. The frontend builds the full system prompt for all
 * session types and sends it directly via the `systemPrompt` socket event.
 * This matches the old monolith flow — synchronous, no DB fetch, no race condition.
 */
export type SessionConfig =
  | { type: 'training'; systemPrompt: string; voiceId: string; scenarioId?: string; businessName?: string }
  | { type: 'coach'; systemPrompt: string }
  | { type: 'custom'; systemPrompt: string; voiceId: string };

export interface UseSocketReturn {
  sendAudioChunk: (base64Audio: string) => void;
  startSession: (config: SessionConfig) => Promise<boolean>;
  stopSession: () => void;
}

export function useSocket(options: UseSocketOptions): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle>(createAudioPlayer());
  const promptNameRef = useRef<string>('');
  const displayAssistantTextRef = useRef(false);
  const displayAiSuggestionRef = useRef(false);
  // Guards against duplicate suggestions per customer turn. Reset when USER speaks.
  const suggestionFiredRef = useRef(false);
  const currentAudioConfigRef = useRef<unknown>(null);

  useEffect(() => {
    if (!options.accessToken || !options.reconnectKey) return;

    const socket = io('/', {
      auth: { token: options.accessToken },
      transports: ['polling', 'websocket'],
    });

    socket.on('connect', () => {
      options.onConnect?.();
    });

    socket.on('disconnect', () => {
      audioPlayerRef.current.stop();
      options.onDisconnect?.();
    });

    socket.on('contentStart', (data: { type: string; audioOutputConfiguration?: unknown; additionalModelFields?: string; role?: string }) => {
      if (data.type === 'AUDIO') {
        currentAudioConfigRef.current = data.audioOutputConfiguration;
      }
      if (data.type === 'TEXT') {
        try {
          const isSpeculative = data.additionalModelFields
            ? JSON.parse(data.additionalModelFields).generationStage === 'SPECULATIVE'
            : false;
          if (isSpeculative) {
            // Speculative: display text incrementally as customer speaks
            displayAssistantTextRef.current = true;
            displayAiSuggestionRef.current = false;
          } else {
            // Non-speculative: don't display (empty message), but trigger AI suggestion
            displayAssistantTextRef.current = false;
            displayAiSuggestionRef.current = data.role === 'ASSISTANT';
          }
        } catch {}
      }
    });

    socket.on('textOutput', (data: { role: string; content: string }) => {
      if (!data.content) return;
      if (data.role === 'USER') {
        options.onTextOutput?.(data.role, data.content);
        // New user turn — allow suggestion for the next customer response
        suggestionFiredRef.current = false;
      } else if (data.role === 'ASSISTANT') {
        if (displayAssistantTextRef.current) {
          // Speculative: display incrementally (customer speech streaming in)
          options.onTextOutput?.(data.role, data.content);
        }
        if (displayAiSuggestionRef.current && !suggestionFiredRef.current) {
          // Non-speculative: trigger AI suggestion once per customer turn
          suggestionFiredRef.current = true;
          options.onAiSuggestion?.(data.content);
        }
      }
    });

    socket.on('audioOutput', (data: { content: string }) => {
      if (currentAudioConfigRef.current) {
        audioPlayerRef.current.playAudio(base64ToFloat32(data.content));
      }
    });

    socket.on('contentEnd', (data: { type: string; stopReason?: string }) => {
      if (data.type === 'TEXT') {
        if (data.stopReason?.toUpperCase() === 'INTERRUPTED') {
          audioPlayerRef.current.bargeIn();
        }
        // Reset flags
        displayAssistantTextRef.current = false;
        displayAiSuggestionRef.current = false;
      }
    });

    socket.on('streamComplete', () => options.onSessionEnd?.());

    socket.on('error', (err: { message?: string; details?: string; source?: string } | string) => {
      const msg = typeof err === 'string' ? err : (err?.message ?? 'Socket error');
      const details = typeof err === 'object' && err?.details ? ` — ${err.details}` : '';
      options.onError?.(msg + details);
    });

    socket.on('auth_error', (err: { message: string }) => {
      options.onError?.(`Auth error: ${err.message}`);
      socket.disconnect();
      options.onAuthError?.();
    });

    socketRef.current = socket;
    return () => {
      audioPlayerRef.current.stop();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [options.accessToken, options.reconnectKey]);

  const sendAudioChunk = useCallback((base64Audio: string) => {
    socketRef.current?.emit('audioInput', base64Audio);
  }, []);

  const startSession = useCallback(async (config: SessionConfig): Promise<boolean> => {
    const socket = socketRef.current;
    if (!socket?.connected) return false;

    try {
      await audioPlayerRef.current.start();
    } catch (e) {
      console.error('AudioPlayer start failed:', e);
    }

    // Extract voiceId — training/custom include it; coach defaults to 'matthew'
    const voiceId = 'voiceId' in config ? config.voiceId : 'matthew';

    // Send prompt start
    promptNameRef.current = crypto.randomUUID();
    socket.emit('promptStart', {
      promptName: promptNameRef.current,
      textOutputConfiguration: { mediaType: 'text/plain' },
      audioOutputConfiguration: {
        mediaType: 'audio/lpcm',
        sampleRateHertz: 24000,
        sampleSizeBits: 16,
        channelCount: 1,
        voiceId,
        encoding: 'base64',
        audioType: 'SPEECH',
      },
      toolUseOutputConfiguration: { mediaType: 'application/json' },
      toolConfiguration: { tools: [] },
    });

    // Exact same sequence as old code: promptStart → systemPrompt → audioStart
    // All three are synchronous on the backend (no DB fetch), ordering guaranteed.
    socket.emit('systemPrompt', config.systemPrompt);
    socket.emit('audioStart');
    return true;
  }, []);

  const stopSession = useCallback(() => {
    socketRef.current?.emit('stopAudio');
    audioPlayerRef.current.stop();
  }, []);

  return { sendAudioChunk, startSession, stopSession };
}
