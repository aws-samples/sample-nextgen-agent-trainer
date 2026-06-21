import type { Scenario } from '../../../shared/types';

interface Props {
  scenario: Scenario;
}

export function ScenarioCard({ scenario }: Props) {
  const primaryGoals = scenario.agentObjectives?.primary ?? [];
  const secondaryGoals = scenario.agentObjectives?.secondary ?? [];

  return (
    <div className="scenario-infographic">
      {/* Left — Customer Profile */}
      <div className="scenario-profile-card">
        <div className="scenario-card-heading">
          <i className="fas fa-user-circle"></i> Customer Profile
        </div>

        <div className="scenario-demo-grid">
          <div className="scenario-demo-cell">
            <div className="scenario-demo-label">Age &amp; Gender</div>
            <div className="scenario-demo-value">{scenario.demographics.age}, {scenario.demographics.gender}</div>
          </div>
          <div className="scenario-demo-cell">
            <div className="scenario-demo-label">Location</div>
            <div className="scenario-demo-value">{scenario.demographics.location}</div>
          </div>
        </div>

        <div className="scenario-behavior-section">
          <div className="scenario-behavior-label">
            <i className="fas fa-comment-dots"></i> Communication Style
          </div>
          <div className="scenario-behavior-text">{scenario.behavior.communicationStyle}</div>
        </div>

        <div className="scenario-behavior-section">
          <div className="scenario-behavior-label">
            <span>&#x1F60A;</span> Emotional State
          </div>
          <div className="scenario-behavior-text">{scenario.behavior.emotionalState}</div>
        </div>
      </div>

      {/* Right — Agent Objectives */}
      <div className="scenario-objectives-card">
        <div className="scenario-card-heading">
          <span>&#x1F3AF;</span> Agent Objectives
        </div>

        {primaryGoals.length > 0 && (
          <>
            <div className="scenario-goals-label">Primary Goals:</div>
            {primaryGoals.map((g, i) => (
              <div key={i} className="scenario-goal-item scenario-goal-primary">{g}</div>
            ))}
          </>
        )}

        {secondaryGoals.length > 0 && (
          <>
            <div className="scenario-goals-label scenario-goals-secondary-label">Secondary Goals:</div>
            {secondaryGoals.map((g, i) => (
              <div key={i} className="scenario-goal-item scenario-goal-secondary">{g}</div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
