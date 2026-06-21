import { useState, useEffect } from 'react';
import { getEvaluationHistory } from '../api/evaluations';
import type { EvaluationHistoryItem } from '../api/evaluations';
import { EvaluationResultModal } from '../components/EvaluationModal';
import type { EvaluationResult } from '../components/EvaluationModal';

interface Props { userName: string | null; accessToken: string | null; }

function getScoreClass(score: number) {
  if (score >= 70) return 'score-good';
  if (score >= 50) return 'score-average';
  return 'score-poor';
}

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function EvaluationPage({ userName, accessToken }: Props) {
  const [history, setHistory] = useState<EvaluationHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<EvaluationResult | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<string | undefined>();

  useEffect(() => {
    if (!userName) { setLoading(false); return; }
    getEvaluationHistory(userName)
      .then(setHistory)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userName]);

  function handleRowClick(item: EvaluationHistoryItem) {
    const base = (item.full_response ?? {}) as unknown as EvaluationResult;
    setSelectedResult({
      ...base,
      overall_score: base.overall_score ?? item.overall_score,
      summary: base.summary ?? 'Full evaluation details not available.',
      user_name: base.user_name ?? item.user_name,
      scenario_name: base.scenario_name ?? item.scenario_name,
    });
    setSelectedTranscript(item.call_transcript ?? undefined);
  }

  return (
    <div className="form-container">
      {selectedResult && (
        <EvaluationResultModal
          result={selectedResult}
          accessToken={accessToken}
          transcript={selectedTranscript}
          onClose={() => { setSelectedResult(null); setSelectedTranscript(undefined); }}
        />
      )}
      <div className="section-header">
        <h2><i className="fas fa-history"></i> Evaluation History</h2>
        <p className="section-description">Review your past evaluation results and transcripts</p>
      </div>
      <div id="evaluation-history-container">
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--primary-color)' }}></i>
            <p style={{ marginTop: '1rem' }}>Loading evaluation history...</p>
          </div>
        )}
        {error && (
          <div className="error-message" style={{ textAlign: 'center', padding: '2rem' }}>
            <i className="fas fa-exclamation-circle" style={{ fontSize: '2rem', color: '#e74c3c', display: 'block', marginBottom: '1rem' }}></i>
            <p style={{ color: '#e74c3c' }}>Failed to load evaluation history.</p>
            <p style={{ color: '#999', fontSize: '0.85rem' }}>{error}</p>
          </div>
        )}
        {!loading && !error && history.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <i className="fas fa-inbox" style={{ fontSize: '3rem', color: '#ccc', display: 'block', marginBottom: '1rem' }}></i>
            <p style={{ color: '#666', fontSize: '1.1rem' }}>No evaluation history found</p>
            <p style={{ color: '#999', fontSize: '0.9rem', marginTop: '0.5rem' }}>Complete a training session and evaluate it to see your history here</p>
          </div>
        )}
        {!loading && !error && history.length > 0 && (
          <table className="evaluation-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Scenario</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item, i) => (
                <tr key={i} className="evaluation-row" style={{ cursor: 'pointer' }} onClick={() => handleRowClick(item)}>
                  <td>{formatTimestamp(item.timestamp)}</td>
                  <td>{item.scenario_name}</td>
                  <td>
                    <span className={`score-badge ${getScoreClass(item.overall_score)}`}>{item.overall_score}</span>
                  </td>
                  <td>
                    {item.transcript_truncated
                      ? <><i className="fas fa-exclamation-triangle" style={{ color: '#f39c12' }}></i> <span style={{ color: '#f39c12', fontSize: '0.9rem' }}>Truncated</span></>
                      : <i className="fas fa-check-circle" style={{ color: '#27ae60' }}></i>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
