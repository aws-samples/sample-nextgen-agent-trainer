import { useState, useRef, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket';
import { buildCoachPrompt } from '../prompts';

export interface CriterionResult {
  score: number;
  justification: string;
}

export interface SentimentPhase {
  sentiment: string;
  justification: string;
}

export interface EvaluationResult {
  overall_score: number;
  summary: string;
  user_name?: string;
  scenario_name?: string;
  general_objectives?: Record<string, CriterionResult>;
  // legacy alias
  general_criteria?: Record<string, CriterionResult>;
  scenario_objectives_primary?: Record<string, CriterionResult | string>;
  scenario_objectives_secondary?: Record<string, CriterionResult | string>;
  customer_sentiment?: Record<string, SentimentPhase>;
}

function scoreClass(score: number) {
  if (score >= 70) return 'score-good';
  if (score >= 50) return 'score-average';
  return 'score-poor';
}

function criterionLabel(key: string) {
  const str = key.replace(/_/g, ' ');
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function sentimentIcon(s: string) {
  switch (s?.toLowerCase()) {
    case 'positive': return '😊';
    case 'negative': return '😞';
    default: return '😐';
  }
}

function ObjectivesList({ data }: { data: Record<string, CriterionResult | string> }) {
  const entries = Object.entries(data).filter(([k, v]) => k !== 'summary' && typeof v === 'object' && v !== null && 'score' in v) as [string, CriterionResult][];
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([key, val]) => (
        <div key={key} className="eval-objective-item">
          <div className="eval-objective-header">
            <span className="eval-objective-name">{key}</span>
            <span className={`score-badge score-${val.score}`}>{val.score}/5</span>
          </div>
          {val.justification && <div className="eval-objective-justification">{val.justification}</div>}
        </div>
      ))}
    </>
  );
}

/* ── Loading state ─────────────────────────────────────────── */
export function EvaluatingModal() {
  return (
    <div className="eval-modal-overlay">
      <div className="eval-modal eval-modal-sm">
        <div className="eval-modal-header">
          <span>Evaluating Call Performance</span>
        </div>
        <div className="eval-loading-body">
          <i className="fas fa-spinner fa-spin eval-loading-spinner"></i>
          <p className="eval-loading-text">Analyzing conversation and generating evaluation report...</p>
        </div>
      </div>
    </div>
  );
}

/* ── Results modal ─────────────────────────────────────────── */
interface ResultsProps {
  result: EvaluationResult;
  userName?: string | null;
  scenarioName?: string | null;
  accessToken?: string | null;
  transcript?: string;
  onClose: () => void;
}

export function EvaluationResultModal({ result, userName, scenarioName, accessToken, transcript, onClose }: ResultsProps) {
  const displayUser = result.user_name ?? userName ?? '—';
  const displayScenario = result.scenario_name ?? scenarioName ?? '—';
  const generalObj = result.general_objectives ?? result.general_criteria;

  // Coach inline voice session — connection is deferred until the user clicks
  // "Ask a Coach". Passing null as the token keeps useSocket dormant.
  const [coachToken, setCoachToken] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isStoppingRef = useRef(false);

  // Ref breaks the circular dep: onConnect needs startSession (returned by
  // useSocket), so we wire it through a ref that stays in sync every render.
  const doStartRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const coachConfig = {
    type: 'coach' as const,
    systemPrompt: buildCoachPrompt(transcript ?? '', result.overall_score, result.summary),
  };

  const { sendAudioChunk, startSession, stopSession } = useSocket({
    accessToken: coachToken,
    reconnectKey,
    onConnect: () => doStartRef.current(),
    onSessionEnd: () => stopListening(true),
    onError: (err) => console.error('Coach socket error:', err),
  });

  // Keep doStartRef in sync so onConnect always calls the latest startSession.
  doStartRef.current = async () => {
    try {
      const ok = await startSession(coachConfig);
      if (!ok) { setIsConnecting(false); return; }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      micContextRef.current = ctx;
      await ctx.audioWorklet.addModule('/MicCaptureProcessor.worklet.js');
      const workletNode = new AudioWorkletNode(ctx, 'mic-capture-processor');
      micProcessorRef.current = workletNode;

      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const bytes = new Uint8Array(e.data);
        let b64 = '';
        for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
        sendAudioChunk(btoa(b64));
      };

      const source = ctx.createMediaStreamSource(stream);
      micSourceRef.current = source;
      source.connect(workletNode);
      setListening(true);
    } catch (err) {
      console.error('Coach start error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const stopMic = useCallback(() => {
    micProcessorRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micContextRef.current?.close();
    micProcessorRef.current = null;
    micSourceRef.current = null;
    micStreamRef.current = null;
    micContextRef.current = null;
  }, []);

  function startListening() {
    if (isConnecting) return;
    setIsConnecting(true);
    // Increment reconnectKey so useSocket tears down any old socket and creates
    // a fresh one → backend creates a new Bedrock session on connect.
    setReconnectKey(k => k + 1);
    // Supply the token — this triggers useSocket's useEffect to connect.
    setCoachToken(accessToken ?? null);
  }

  function stopListening(skipStopSession = false) {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    stopMic();
    if (!skipStopSession) stopSession();
    setListening(false);
    // Clear the token so useSocket disconnects and goes dormant.
    setCoachToken(null);
    setTimeout(() => { isStoppingRef.current = false; }, 500);
  }

  function handleClose() {
    stopListening();
    onClose();
  }

  return (
    <div className="eval-modal-overlay" onClick={handleClose}>
      <div className="eval-modal" onClick={e => e.stopPropagation()}>
        <div className="eval-modal-header">
          <span>Call Evaluation Results</span>
          <button className="eval-modal-close" onClick={handleClose}><i className="fas fa-times"></i></button>
        </div>

        <div className="eval-modal-body">
          {/* Meta */}
          <div className="eval-meta">
            <span><strong>User:</strong> {displayUser}</span>
            <span><strong>Scenario:</strong> {displayScenario}</span>
          </div>

          {/* Score + Summary */}
          <div className="eval-score-summary">
            <div className="eval-score-box">
              <div className="eval-score-label">Overall Score</div>
              <div className={`score-circle ${scoreClass(result.overall_score)}`}>{result.overall_score}</div>
            </div>
            <div className="eval-summary-box">
              <div className="eval-section-title">Summary</div>
              <p className="eval-summary-text">{result.summary}</p>
            </div>
          </div>

          {/* Customer Sentiment */}
          {result.customer_sentiment && Object.keys(result.customer_sentiment).length > 0 && (
            <div className="eval-section">
              <div className="eval-section-title">Customer Sentiment</div>
              <div className="eval-sentiment-timeline">
                {Object.entries(result.customer_sentiment).map(([phase, data]) => (
                  <div key={phase} className="eval-sentiment-point">
                    <div className="eval-sentiment-icon">{sentimentIcon(data.sentiment)}</div>
                    <div className="eval-sentiment-phase">{criterionLabel(phase)}</div>
                    <div className="eval-sentiment-desc">{data.justification}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* General Objectives */}
          {generalObj && Object.keys(generalObj).length > 0 && (
            <div className="eval-section">
              <div className="eval-section-title">General Objectives</div>
              {Object.entries(generalObj).map(([key, val]) => (
                <div key={key} className="eval-objective-item">
                  <div className="eval-objective-header">
                    <span className="eval-objective-name">{key}</span>
                    <span className={`score-badge score-${val.score}`}>{val.score}/5</span>
                  </div>
                  {val.justification && <div className="eval-objective-justification">{val.justification}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Primary Objectives */}
          {result.scenario_objectives_primary && Object.keys(result.scenario_objectives_primary).filter(k => k !== 'summary').length > 0 && (
            <div className="eval-section">
              <div className="eval-section-title">Primary Objectives</div>
              {typeof result.scenario_objectives_primary.summary === 'string' && (
                <p className="eval-obj-summary">{result.scenario_objectives_primary.summary}</p>
              )}
              <ObjectivesList data={result.scenario_objectives_primary} />
            </div>
          )}

          {/* Secondary Objectives */}
          {result.scenario_objectives_secondary && Object.keys(result.scenario_objectives_secondary).filter(k => k !== 'summary').length > 0 && (
            <div className="eval-section">
              <div className="eval-section-title">Secondary Objectives</div>
              {typeof result.scenario_objectives_secondary.summary === 'string' && (
                <p className="eval-obj-summary">{result.scenario_objectives_secondary.summary}</p>
              )}
              <ObjectivesList data={result.scenario_objectives_secondary} />
            </div>
          )}
        </div>

        {/* Coach footer */}
        <div className="eval-footer">
          <span className="eval-footer-text">Ask a coach about your evaluation results</span>
          {listening ? (
            <button className="btn eval-coach-btn eval-coach-listening" onClick={() => stopListening(false)}>
              <i className="fas fa-circle eval-coach-pulse"></i> Listening...
              <i className="fas fa-times eval-coach-stop"></i>
            </button>
          ) : (
            <button className="btn eval-coach-btn" disabled={!accessToken || isConnecting} onClick={startListening}>
              <i className={`fas ${isConnecting ? 'fa-spinner fa-spin' : 'fa-microphone'}`}></i> {isConnecting ? 'Connecting...' : 'Ask a coach'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
