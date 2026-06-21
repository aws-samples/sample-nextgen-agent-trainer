// Training Scenarios tab — browse existing scenarios by business
import { useState, useEffect } from 'react';
import { getBusinesses, getScenarios } from '../api/scenarios';
import { ScenarioCard } from '../components/ScenarioCard';
import type { Scenario } from '../../../shared/types';

export function TrainingScenariosPage() {
  const [businesses, setBusinesses] = useState<string[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<string>('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    getBusinesses()
      .then(bs => {
        setBusinesses(bs);
        if (bs.length > 0) return loadScenarios(bs[0]);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function loadScenarios(business: string) {
    setSelectedBusiness(business);
    setSelectedScenario(null);
    setLoading(true);
    return getScenarios(business)
      .then(setScenarios)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  return (
    <div className="form-container">
      <div className="section-header">
        <h2><i className="fas fa-book-open"></i> Training Scenarios Reference</h2>
        <p className="section-description">Review customer scenarios and agent objectives before training sessions</p>
      </div>

      <div className="form-group business-filter">
        <label htmlFor="scenarios-business-selector">
          <i className="fas fa-building"></i> Business Sector
        </label>
        <select
          id="scenarios-business-selector"
          className="form-control"
          value={selectedBusiness}
          onChange={e => loadScenarios(e.target.value)}
        >
          {businesses.length === 0 && <option>Loading...</option>}
          {businesses.map(b => (
            <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
          ))}
        </select>
      </div>

      {selectedScenario ? (
        <div id="scenario-detail">
          <button
            onClick={() => setSelectedScenario(null)}
            className="btn btn-primary"
            style={{ marginBottom: '1.5rem' }}
          >
            <i className="fas fa-arrow-left"></i> Back to Scenarios
          </button>
          <div className="scenario-detail-header">
            <h2>{selectedScenario.personaName}</h2>
            <p className="scenario-detail-subtitle">{scenario_name(selectedScenario)} Training Scenario</p>
          </div>
          <ScenarioCard scenario={selectedScenario} />
        </div>
      ) : (
        <div id="scenario-list-container">
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--primary-color)' }}></i>
            </div>
          )}
          {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
          {!loading && !error && scenarios.length > 0 && (
            <table className="scenarios-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Scenario</th>
                  <th>Profile</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map(s => (
                  <tr
                    key={s.scenarioId}
                    className="scenario-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedScenario(s)}
                  >
                    <td>{s.personaName}</td>
                    <td>{scenario_name(s)}</td>
                    <td>{s.demographics.age} years old, {s.demographics.gender}, {s.demographics.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && !error && scenarios.length === 0 && (
            <p style={{ color: '#666', textAlign: 'center' }}>No scenarios found for this business.</p>
          )}
        </div>
      )}
    </div>
  );
}

function scenario_name(s: Scenario) {
  return s.scenarioName || s.scenarioId;
}
