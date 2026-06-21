import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket, type SessionConfig } from '../hooks/useSocket';
import { getBusinesses, getScenarios } from '../api/scenarios';
import apiFetch from '../api/client';
import { ScenarioCard } from '../components/ScenarioCard';
import { EvaluatingModal, EvaluationResultModal } from '../components/EvaluationModal';
import type { EvaluationResult } from '../components/EvaluationModal';
import type { Scenario } from '../../../shared/types';
import { buildTrainingPrompt, buildCustomPrompt } from '../prompts';

interface Props {
  token: string | null;
  accessToken: string | null;
  userName: string | null;
  logout?: () => void;
}


export function LiveTrainingPage({ accessToken, userName, logout }: Props) {
  const [businesses, setBusinesses] = useState<string[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [transcript, setTranscript] = useState<{ role: string; text: string; sourceUrl?: string }[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showAiSuggestions, setShowAiSuggestions] = useState(true);
  const [showScenarioInfo, setShowScenarioInfo] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  // Custom scenario
  const DEFAULT_CUSTOM_PROMPT = `You are Jennifer Walsh, a 42-year-old female customer from Sydney, Australia, calling SkyAus Airlines contact center.

Booking Reference: SKY847291
Frequent Flyer: Gold Status (5 years)

Situation: Your flight SA201 Sydney to Melbourne (7:00am) was cancelled due to mechanical issues. You received the SMS only 30 minutes before departure and you're already at the airport. You have a critical business meeting at 2pm in Melbourne CBD.

Personality: Stressed and urgent. You travel this route weekly for work. You expect priority treatment as a Gold member and business class passenger. You cooperate when the agent shows urgency and competence.

Authentication: Provide booking reference SKY847291 or frequent flyer number SA5847291 only when asked.

Start the call stressed and urgent — lead with your meeting deadline.`;

  const [customScenario, setCustomScenario] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_CUSTOM_PROMPT);
  const [customVoiceId, setCustomVoiceId] = useState('matthew');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  // Keep stable refs for session data (may change after stop)
  const sessionScenarioRef = useRef<Scenario | null>(null);
  const sessionAgentRef = useRef<string>('');

  // Microphone capture refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Reconnect key: incrementing this forces useSocket to disconnect and reconnect,
  // which creates a fresh Bedrock session on the server (1 session per connection).
  const [reconnectKey, setReconnectKey] = useState(0);
  // Gate: resolves when the socket (re)connects, so startSession never races ahead.
  const connectResolverRef = useRef<(() => void) | null>(null);
  const connectedRef = useRef(false);
  // Stored session config — used to re-initialise the backend Bedrock session on
  // an automatic mid-session socket reconnect (e.g. WebSocket drop → polling fallback).
  const sessionConfigRef = useRef<SessionConfig | null>(null);
  // Ref-based restart function to break the circular dependency between onConnect
  // (passed to useSocket) and startSession (returned from useSocket).
  const restartSessionRef = useRef<() => void>(() => {});

  // Debounce AI suggestions: Nova Sonic emits non-speculative text for the final
  // customer turn. We fire the API call immediately (no debounce) to match the
  // old code's behaviour. The abort controller handles stale requests.
  const suggestionAbortRef = useRef<AbortController | null>(null);
  // Increments on every new session start. API responses from a previous session
  // compare against this and are silently discarded if the session changed.
  const sessionVersionRef = useRef(0);

  const showAiSuggestionsRef = useRef(showAiSuggestions);
  const selectedBusinessRef = useRef(selectedBusiness);
  const transcriptRef = useRef(transcript);
  // Mirrors sessionActive as a ref so event callbacks (onSessionEnd) can read
  // the current value without closing over a stale snapshot from a prior render.
  const sessionActiveRef = useRef(false);

  const selectedScenario = scenarios.find(s => s.scenarioId === selectedScenarioId) ?? null;

  const { sendAudioChunk, startSession, stopSession } = useSocket({
    accessToken,
    reconnectKey,
    onConnect: () => {
      connectedRef.current = true;
      setConnected(true);
      if (connectResolverRef.current) {
        // Initial connect during doStartSession — resolve the gate promise.
        connectResolverRef.current();
        connectResolverRef.current = null;
      } else if (sessionActiveRef.current && sessionConfigRef.current) {
        // Auto-reconnect mid-session (e.g. WS drop → polling → reconnect).
        // The backend has created a fresh Bedrock session; re-send the config
        // so it gets promptStart/systemPrompt/audioStart before audio arrives.
        restartSessionRef.current();
      }
    },
    onDisconnect: () => {
      connectedRef.current = false;
      setConnected(false);
    },
    onTextOutput: (role, content) => {
      if (!content) return;
      const mappedRole = role === 'USER' ? 'user' : 'agent';
      // Strip stage command tags (e.g. [amused], [eye roll]) from both roles
      const cleanContent = content.replace(/\[\s*[^\]]+?\s*\]\s*/g, '').trim();
      if (!cleanContent) return;
      setTranscript(prev => {
        // Find the last non-suggestion entry — a suggestion bubble inserted
        // mid-stream must not break the current speaker's message into two bubbles.
        let lastIdx = prev.length - 1;
        while (lastIdx >= 0 && prev[lastIdx].role === 'suggestion') lastIdx--;
        const last = lastIdx >= 0 ? prev[lastIdx] : null;
        if (last && last.role === mappedRole) {
          const updated = { role: mappedRole, text: last.text + ' ' + cleanContent };
          return [...prev.slice(0, lastIdx), updated, ...prev.slice(lastIdx + 1)];
        }
        return [...prev, { role: mappedRole, text: cleanContent }];
      });
    },
    onAiSuggestion: (content) => {
      if (!showAiSuggestionsRef.current || !content.trim()) return;

      // Abort any in-flight request from a previous turn
      suggestionAbortRef.current?.abort();

      // Capture session version so we can discard stale responses
      const capturedVersion = sessionVersionRef.current;

      // Fire immediately — this callback only fires on non-speculative (final)
      // customer text, so there's no need to debounce. Matches old code behaviour.
      const controller = new AbortController();
      suggestionAbortRef.current = controller;
      (async () => {
        try {
          // Strip stage command tags (e.g. [assertive], [frustrated]) before KB search
          const cleanQuery = content.replace(/\[\s*[^\]]+?\s*\]\s*/g, '').trim();
          const res = await apiFetch<{ suggestion: string; nextSteps: string[]; knowledgeBaseRef?: string }>('/api/agent-suggestion', {
            method: 'POST',
            body: JSON.stringify({ customerQuery: cleanQuery, useKnowledgeBase: true, businessName: selectedBusinessRef.current || undefined }),
            signal: controller.signal,
          });
          // Discard if the session changed while the request was in flight
          if (sessionVersionRef.current !== capturedVersion) return;
          // Display nextSteps as bullet points
          const text = res.nextSteps && res.nextSteps.length > 0
            ? res.nextSteps.map(step => `• ${step}`).join('  ')
            : '';
          if (!text) return;
          setTranscript(prev => [...prev, { role: 'suggestion', text, sourceUrl: res.knowledgeBaseRef || undefined }]);
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('AI suggestion failed:', err);
        }
      })();
    },
    // Guard against a stale `streamComplete` event from an old socket firing
    // during the reconnect window of a new session. Only call handleStop() if
    // a session is actually active right now.
    onSessionEnd: () => { if (sessionActiveRef.current) handleStop(); },
    onError: (err) => console.error('Socket error:', err),
    onAuthError: logout,
  });

  // Keep restartSessionRef in sync so onConnect can call startSession without
  // a stale closure. Must run after useSocket so startSession is in scope.
  restartSessionRef.current = () => {
    if (sessionConfigRef.current) startSession(sessionConfigRef.current);
  };

  useEffect(() => {
    getBusinesses().then(bs => {
      setBusinesses(bs);
      if (bs.length > 0) loadScenarios(bs[0]);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    showAiSuggestionsRef.current = showAiSuggestions;
  }, [showAiSuggestions]);

  useEffect(() => {
    selectedBusinessRef.current = selectedBusiness;
  }, [selectedBusiness]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  function loadScenarios(business: string) {
    setSelectedBusiness(business);
    setSelectedScenarioId('');
    getScenarios(business).then(s => {
      setScenarios(s);
      if (s.length > 0) setSelectedScenarioId(s[0].scenarioId);
    }).catch(console.error);
  }

  const stopMicrophone = useCallback(() => {
    micProcessorRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micContextRef.current?.close();
    micProcessorRef.current = null;
    micSourceRef.current = null;
    micStreamRef.current = null;
    micContextRef.current = null;
  }, []);

  async function startMicrophone() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        sampleSize: 16,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;

    const audioContext = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    micContextRef.current = audioContext;

    await audioContext.audioWorklet.addModule('/MicCaptureProcessor.worklet.js');
    const workletNode = new AudioWorkletNode(audioContext, 'mic-capture-processor');
    micProcessorRef.current = workletNode;

    workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const bytes = new Uint8Array(e.data);
      let data = '';
      for (let i = 0; i < bytes.length; i++) data += String.fromCharCode(bytes[i]);
      sendAudioChunk(btoa(data));
    };

    const source = audioContext.createMediaStreamSource(stream);
    micSourceRef.current = source;
    source.connect(workletNode);
    // No destination connection needed — AudioWorkletNode processes audio independently
  }

  async function handleStart() {
    if (customScenario) {
      if (!customPrompt.trim()) { alert('Please enter custom instructions.'); return; }
    } else {
      if (!selectedScenarioId || !selectedScenario) return;
    }
    await doStartSession(userName ?? 'guest');
  }

  function playStartTone() {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  }

  async function doStartSession(agentName: string) {
    playStartTone(); // fire immediately on user click, before any async work
    const scenario = customScenario ? null : (scenarios.find(s => s.scenarioId === selectedScenarioId) ?? null);
    sessionScenarioRef.current = scenario;
    sessionAgentRef.current = agentName;
    setSessionActive(true);
    setTranscript([]);
    sessionVersionRef.current += 1; // invalidate any in-flight suggestion from previous session
    setElapsed(0);
    setEvaluationResult(null);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    // Build config — frontend builds the full system prompt to avoid a DynamoDB
    // round-trip and the race condition where audioStart fires before the prompt is set.
    const config: SessionConfig = customScenario
      ? { type: 'custom', systemPrompt: buildCustomPrompt(customPrompt), voiceId: customVoiceId }
      : { type: 'training', systemPrompt: buildTrainingPrompt(scenario!), scenarioId: selectedScenarioId, businessName: selectedBusinessRef.current, voiceId: scenario!.voiceId };
    sessionConfigRef.current = config; // store for auto-reconnect recovery
    // The backend creates exactly one Bedrock session per socket connection.
    // After stopAudio closes it, the old session is dead. Incrementing reconnectKey
    // disconnects the socket and reconnects, giving us a fresh Bedrock session.
    const connectPromise = new Promise<void>((resolve, reject) => {
      connectResolverRef.current = resolve;
      setTimeout(() => reject(new Error('Socket connection timeout')), 5000);
    });
    connectedRef.current = false;
    setReconnectKey(k => k + 1);

    try {
      await connectPromise;
      const started = await startSession(config);
      if (!started) throw new Error('Socket disconnected before session could start');
      await startMicrophone();
    } catch (err) {
      console.error('Session/microphone start failed:', err);
      handleStop();
      if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        const isEmbedded = window.self !== window.top;
        alert(
          isEmbedded
            ? 'Microphone access was blocked.\n\nThis app is embedded in Amazon Connect. Ask your administrator to enable the microphone permission on the NextGen Agent Trainer application in the Connect console (Agent workspace → Third-party applications).'
            : 'Microphone access was denied. Please allow microphone access in your browser and try again.'
        );
      }
    }
  }

  function handleStop() {
    stopSession();
    stopMicrophone();
    setSessionActive(false);
    sessionConfigRef.current = null; // clear so auto-reconnect doesn't re-init after stop
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Cancel any in-flight suggestion request
    suggestionAbortRef.current?.abort();
    suggestionAbortRef.current = null;
  }

  async function handleEvaluate() {
    const scenario = sessionScenarioRef.current;
    const agentId = sessionAgentRef.current || userName;
    if (!transcript.length || !agentId) return;
    setEvaluating(true);
    try {
      const messages = transcript
        .filter(e => e.role !== 'suggestion')
        .map(e => ({
          role: e.role === 'user' ? 'USER' : 'ASSISTANT',
          message: e.text,
        }));
      const result = await apiFetch<EvaluationResult>('/api/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          messages,
          persona: scenario?.personaName ?? 'unknown',
          scenario: scenario?.scenarioName ?? 'unknown',
          primary_objectives: scenario?.agentObjectives?.primary ?? [],
          secondary_objectives: scenario?.agentObjectives?.secondary ?? [],
        }),
      });
      setEvaluationResult({
        ...result,
        user_name: result.user_name ?? agentId ?? undefined,
        scenario_name: result.scenario_name ?? (scenario ? `${scenario.personaName} - ${scenario.scenarioName}` : undefined),
      });
    } catch (err) {
      console.error('Evaluation failed:', err);
      alert('Evaluation failed. Please try again.');
    } finally {
      setEvaluating(false);
    }
  }

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <div className="training-dashboard">
      {evaluating && !evaluationResult && <EvaluatingModal />}
      {evaluationResult && (
        <EvaluationResultModal
          result={evaluationResult}
          accessToken={accessToken}
          transcript={transcript.filter(e => e.role !== 'suggestion').map(e => `${e.role === 'user' ? 'AGENT' : 'CUSTOMER'}: ${e.text}`).join('\n')}
          onClose={() => setEvaluationResult(null)}
        />
      )}

      {showScenarioInfo && selectedScenario && (
        <div className="scenario-modal-overlay" onClick={() => setShowScenarioInfo(false)}>
          <div className="scenario-modal" onClick={e => e.stopPropagation()}>
            <div className="scenario-modal-header">
              <span><i className="fas fa-user"></i> Scenario Details</span>
              <button className="scenario-modal-close" onClick={() => setShowScenarioInfo(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="scenario-modal-body">
              <div className="scenario-detail-header">
                <h2>{selectedScenario.personaName}</h2>
                <p className="scenario-detail-subtitle">{selectedScenario.scenarioName}</p>
              </div>
              <ScenarioCard scenario={selectedScenario} />
            </div>
          </div>
        </div>
      )}

      <div className="status-bar">
        <div id="status" className={sessionActive ? 'connected' : 'disconnected'}>
          <i className="fas fa-circle"></i>
          <span>{sessionActive ? 'System Connected' : 'System Disconnected'}</span>
        </div>
        <div className="session-info">
          <span className="session-timer"><i className="fas fa-clock"></i> {formatTime(elapsed)}</span>
        </div>
      </div>

      <div className="main-content">
        <div className="conversation-panel">
          <div className="panel-header">
            <h3><i className="fas fa-comments"></i> Customer Interaction</h3>
          </div>
          <div id="chat-container" ref={chatRef}>
            {transcript.map((entry, i) => {
              // Inline AI suggestion card — only shown when toggle is on
              if (entry.role === 'suggestion') {
                if (!showAiSuggestions) return null;
                return (
                  <div key={i} className="message-suggestion">
                    <div className="message-suggestion-header">
                      AI ASSISTANT
                    </div>
                    <div className="message-suggestion-body">{entry.text}</div>
                    {entry.sourceUrl && entry.sourceUrl.trim() !== '' && (
                      <div className="ai-suggestion-source">
                        <i className="fas fa-book"></i>{' '}
                        {entry.sourceUrl.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/-/g, ' ') || 'knowledge base'}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={i} className={`message ${entry.role}`}>
                  <div className="message-role">
                    {entry.role === 'agent' ? 'Customer' : 'You'}
                  </div>
                  <div className="message-text">{entry.text}</div>
                </div>
              );
            })}
            {transcript.length === 0 && (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '2rem', fontSize: '0.9rem' }}>
                Select a scenario and press Start Training Session to begin.
              </div>
            )}
          </div>

        </div>

        <div className="control-panel">
          <div className="panel-header">
            <h3><i className="fas fa-sliders-h"></i> Training Controls</h3>
          </div>
          <div className="persona-selector">
            <div className="control-group">
              <div className="custom-prompt-toggle">
                <input
                  type="checkbox"
                  id="customScenarioToggle"
                  checked={customScenario}
                  disabled={sessionActive}
                  onChange={e => setCustomScenario(e.target.checked)}
                />
                <label htmlFor="customScenarioToggle">Custom Scenario</label>
              </div>
            </div>

            <div className="control-group">
              <label className="control-label"><i className="fas fa-building"></i> Business Sector</label>
              <select
                className="control-select"
                value={selectedBusiness}
                onChange={e => loadScenarios(e.target.value)}
                disabled={sessionActive}
              >
                {businesses.map(b => <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>)}
              </select>
            </div>

            {!customScenario && (
              <>
                <div className="control-group">
                  <label className="control-label" style={{ justifyContent: 'space-between' }}>
                    <span><i className="fas fa-user"></i> Customer Profile</span>
                    {selectedScenario && (
                      <button
                        className="scenario-info-btn"
                        onClick={() => setShowScenarioInfo(v => !v)}
                        title="View scenario details"
                        type="button"
                      >
                        <i className={`fas ${showScenarioInfo ? 'fa-times' : 'fa-info-circle'}`}></i>
                        {showScenarioInfo ? 'Close' : 'Details'}
                      </button>
                    )}
                  </label>
                  <select
                    className="control-select"
                    value={selectedScenarioId}
                    onChange={e => { setSelectedScenarioId(e.target.value); setShowScenarioInfo(false); }}
                    disabled={sessionActive}
                  >
                    {scenarios.map(s => (
                      <option key={s.scenarioId} value={s.scenarioId}>
                        {s.personaName} - {s.scenarioName}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedScenario && (
                  <div className="control-group">
                    <label className="control-label"><i className="fas fa-volume-up"></i> Voice Profile</label>
                    <select className="control-select" value={selectedScenario.voiceId} disabled>
                      <option value="matthew">Matthew (English US - Male)</option>
                      <option value="tiffany">Tiffany (English US - Female)</option>
                      <option value="amy">Amy (English UK - Female)</option>
                      <option value="olivia">Olivia (English AU - Female)</option>
                      <option value="arjun">Arjun (English IN - Male)</option>
                      <option value="kiara">Kiara (English IN - Female)</option>
                    </select>
                  </div>
                )}
              </>
            )}

            {customScenario && (
              <>
                <div className="control-group">
                  <label className="control-label"><i className="fas fa-volume-up"></i> Voice Profile</label>
                  <select
                    className="control-select"
                    value={customVoiceId}
                    onChange={e => setCustomVoiceId(e.target.value)}
                    disabled={sessionActive}
                  >
                    <option value="matthew">Matthew (English US - Male)</option>
                    <option value="tiffany">Tiffany (English US - Female)</option>
                    <option value="amy">Amy (English UK - Female)</option>
                    <option value="olivia">Olivia (English AU - Female)</option>
                    <option value="arjun">Arjun (English IN - Male)</option>
                    <option value="kiara">Kiara (English IN - Female)</option>
                  </select>
                </div>
                <div className="control-group">
                  <label className="control-label"><i className="fas fa-edit"></i> Custom Instructions</label>
                  <textarea
                    className="control-textarea"
                    rows={4}
                    disabled={sessionActive}
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="Enter custom training scenario instructions..."
                  />
                </div>
              </>
            )}

            <div className="control-group" style={{ marginTop: 'auto' }}>
              <div className="custom-prompt-toggle">
                <input
                  type="checkbox"
                  id="aiSuggestionsToggle"
                  checked={showAiSuggestions}
                  onChange={e => setShowAiSuggestions(e.target.checked)}
                />
                <label htmlFor="aiSuggestionsToggle">Show AI suggestions</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="action-bar">
        <div className="training-controls">
          <button
            id="start"
            className="btn btn-primary"
            disabled={sessionActive || (!customScenario && !selectedScenarioId)}
            onClick={handleStart}
          >
            <i className="fas fa-play"></i>
            <span>Start Training Session</span>
          </button>
          <button
            id="stop"
            className="btn btn-danger"
            disabled={!sessionActive}
            onClick={handleStop}
          >
            <i className="fas fa-stop"></i>
            <span>End Session</span>
          </button>
          <button
            id="evaluate"
            className="btn btn-primary"
            disabled={sessionActive || transcript.length === 0 || evaluating}
            onClick={handleEvaluate}
          >
            <i className={`fas ${evaluating ? 'fa-spinner fa-spin' : 'fa-chart-line'}`}></i>
            <span>{evaluating ? 'Evaluating...' : 'Evaluate Call'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
