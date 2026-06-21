import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { LiveTrainingPage } from './pages/LiveTrainingPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { ScenarioBuilderPage } from './pages/ScenarioBuilderPage';
import { TrainingScenariosPage } from './pages/TrainingScenariosPage';

type Tab = 'training' | 'evaluation' | 'scenario-builder' | 'scenarios' | 'resources';

export function App() {
  const { isAuthenticated, token, accessToken, userName, login, logout, checkAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('training');

  const tabConfig: { id: Tab; icon: string; label: string }[] = [
    { id: 'training',        icon: 'fa-comments',  label: 'Live Training' },
    { id: 'scenarios',       icon: 'fa-book-open', label: 'Training Scenarios' },
    { id: 'scenario-builder',icon: 'fa-user-plus', label: 'Scenario Builder' },
    { id: 'evaluation',      icon: 'fa-history',   label: 'Evaluation History' },
    { id: 'resources',       icon: 'fa-link',      label: 'Resources' },
  ];

  const resourceLinks = [
    { href: '/resources/index.html', icon: 'fa-microphone-lines', label: 'Nova Sonic Resources' },
    { href: '/resources/architecture.html', icon: 'fa-diagram-project', label: 'Solution Architecture' },
  ];

  // Auto-redirect to Cognito when not authenticated.
  // Skip if ?code= is present — that's the OAuth callback mid-exchange.
  // Skip if embedded (iframe) — login() will open a popup instead.
  const hasOAuthCode = new URLSearchParams(window.location.search).has('code');
  useEffect(() => {
    if (!isAuthenticated && !hasOAuthCode) {
      login();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    // In embedded mode show a sign-in button (popup can't auto-open without a user gesture).
    // In standalone mode render nothing while the top-level redirect is in flight.
    const embedded = window.self !== window.top;
    if (!embedded) return null;
    return (
      <div id="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <button className="tab-button" onClick={login} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}>
          <i className="fas fa-sign-in-alt"></i> Sign in to NextGen Agent Trainer
        </button>
      </div>
    );
  }

  return (
    <div id="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <i className="fas fa-headset"></i>
            <h1>NextGen Agent Trainer</h1>
          </div>
          <div className="header-info">
            <span className="training-mode">
              <i className="fas fa-graduation-cap"></i>
              {' Training Mode'}
            </span>
          </div>
        </div>
      </header>
      <nav className="tabs-container">
        <div className="tabs-left">
          {tabConfig.map(tab => (
            <button
              key={tab.id}
              className={`tab-button${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => { if (checkAuth()) setActiveTab(tab.id); }}
            >
              <i className={`fas ${tab.icon}`}></i>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="tabs-right">
          {userName && (
            <span id="username-display">
              <i className="fas fa-user"></i> <span id="username-text">{userName}</span>
            </span>
          )}
          <button id="logout-btn" className="tab-button" onClick={logout}>Logout</button>
        </div>
      </nav>
      <div className="page-content">
        {activeTab === 'training' && <LiveTrainingPage token={token} accessToken={accessToken} userName={userName} logout={logout} />}
        {activeTab === 'evaluation' && <EvaluationPage userName={userName} accessToken={accessToken} />}
        {activeTab === 'scenario-builder' && <ScenarioBuilderPage />}
        {activeTab === 'scenarios' && <TrainingScenariosPage />}
        {activeTab === 'resources' && (
          <div className="form-container">
            <div className="section-header">
              <h2><i className="fas fa-link"></i> Resources</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 480 }}>
              {resourceLinks.map(link => (
                <a key={link.href} href={link.href} target="_blank" rel="noopener"
                  className="form-section"
                  style={{ display: 'flex', alignItems: 'center', gap: '1rem', textDecoration: 'none', marginBottom: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--primary-light)', border: '1px solid var(--primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--primary)' }}>
                    <i className={`fas ${link.icon}`}></i>
                  </div>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{link.label}</span>
                  <i className="fas fa-arrow-right" style={{ marginLeft: 'auto', color: 'var(--text-light)', fontSize: '0.75rem' }}></i>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
