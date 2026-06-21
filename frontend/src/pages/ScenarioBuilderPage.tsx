// Scenario Builder tab — create new training scenarios
import { useState, useRef } from 'react';
import { createScenario } from '../api/scenarios';

function DragList({ items, onChange, placeholder = 'Enter objective...' }: { items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const dragIdx = useRef<number | null>(null);

  function update(i: number, val: string) {
    const next = [...items];
    next[i] = val;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  function onDragStart(i: number) { dragIdx.current = i; }

  function onDrop(i: number) {
    const from = dragIdx.current;
    if (from === null || from === i) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(i, 0, moved);
    onChange(next);
    dragIdx.current = null;
  }

  return (
    <div className="dyn-list">
      {items.map((item, i) => (
        <div key={i} className="dyn-row" draggable
          onDragStart={() => onDragStart(i)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => onDrop(i)}
        >
          <span className="drag-handle">⠿</span>
          <input type="text" value={item} onChange={e => update(i, e.target.value)} />
          <button type="button" className="btn-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button type="button" className="btn-add" onClick={() => onChange([...items, ''])}>+ Add objective</button>
    </div>
  );
}

function generatePrompt(data: {
  personaName: string; scenarioName: string; businessVertical: string;
  age: number; gender: string; location: string;
  communicationStyle: string; emotionalState: string; notes: string; scenarioInteraction: string;
  agentPrimaryObj: string[]; agentSecondaryObj: string[];
}) {
  return `You are ${data.personaName} calling in to customer support about: ${data.scenarioName}
  
The customer support agent that you are speaking to has the following Primary Objectives:
- ${data.agentPrimaryObj.join('\n- ')}

The Customer support agent that you are speaking to has the following Secondary Objectives:
- ${data.agentSecondaryObj.join('\n- ')}
  
**Your Profile**
Name: ${data.personaName}
Age: ${data.age}
Gender: ${data.gender}
Location: ${data.location}

**Your Current Situation**
${data.notes}

**Your Behavior:**
${data.emotionalState}

**Your Communication Style:**
${data.communicationStyle}

${data.scenarioInteraction ? '**Scenario Interaction:**\n' + data.scenarioInteraction + '\n\n' : ''}

**Rules:**
- Only respond as ${data.personaName}`;
}

export function ScenarioBuilderPage() {
  const [personaName, setPersonaName] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [businessVertical, setBusinessVertical] = useState('');
  const [age, setAge] = useState(35);
  const [gender, setGender] = useState('Male');
  const [location, setLocation] = useState('');
  const [voiceId, setVoiceId] = useState('matthew');
  const [communicationStyle, setCommunicationStyle] = useState('');
  const [emotionalState, setEmotionalState] = useState('');
  const [notes, setNotes] = useState('');
  const [scenarioInteraction, setScenarioInteraction] = useState('');
  const [agentPrimaryObj, setAgentPrimaryObj] = useState<string[]>([]);
  const [agentSecondaryObj, setAgentSecondaryObj] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptReadonly, setPromptReadonly] = useState(true);
  const [savedPrompt, setSavedPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  function validate() {
    if (!personaName) { alert('Please enter a customer name'); return false; }
    if (!businessVertical.trim()) { alert('Please enter a business sector'); return false; }
    if (!scenarioName) { alert('Please enter a scenario name'); return false; }
    if (!location) { alert('Please enter a customer location'); return false; }
    if (!communicationStyle) { alert('Please enter a communication style'); return false; }
    if (!emotionalState) { alert('Please enter an emotional state'); return false; }
    if (agentPrimaryObj.length === 0) { alert('Please add at least one agent primary objective'); return false; }
    return true;
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setGenerating(true);
    const prompt = generatePrompt({ personaName, scenarioName, businessVertical, age, gender, location, communicationStyle, emotionalState, notes, scenarioInteraction, agentPrimaryObj, agentSecondaryObj });
    setSystemPrompt(prompt);
    setPromptReadonly(true);
    setSaveMsg('');
    setGenerating(false);
  }

  function handleCancel() {
    setPersonaName('');
    setScenarioName('');
    setBusinessVertical('');
    setAge(35);
    setGender('Male');
    setLocation('');
    setVoiceId('matthew');
    setCommunicationStyle('');
    setEmotionalState('');
    setNotes('');
    setScenarioInteraction('');
    setAgentPrimaryObj([]);
    setAgentSecondaryObj([]);
    setSystemPrompt('');
    setPromptReadonly(true);
    setSavedPrompt('');
    setSaveMsg('');
  }

  async function handleSave() {
    if (!systemPrompt) { alert('Please generate a prompt first.'); return; }
    setSaving(true);
    setSaveMsg('');
    try {
      const scenarioId = personaName.toLowerCase().replace(/\s+/g, '-');
      await createScenario({
        businessName: businessVertical.trim().toLowerCase(),
        scenarioId,
        personaName, scenarioName, voiceId,
        demographics: { age, gender, location },
        behavior: { communicationStyle, emotionalState },
        customerObjectives: { primary: [], secondary: [] },
        agentObjectives: { primary: agentPrimaryObj, secondary: agentSecondaryObj },
        notes, scenarioInteraction,
        prompt: systemPrompt,
      });
      setSaveMsg('Scenario saved successfully.');
    } catch (err) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-container">
      <div className="section-header">
        <h2><i className="fas fa-cogs"></i> Training Scenario Builder</h2>
        <p className="section-description">Create realistic customer scenarios for agent training</p>
      </div>
      <div className="scenario-builder-layout">
        <form id="persona-form" onSubmit={handleGenerate}>
          <div className="form-section">
            <h3><i className="fas fa-user"></i> Customer Details</h3>
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={personaName} onChange={e => setPersonaName(e.target.value)} required />
            </div>
            <div className="form-group" style={{ display: 'flex', gap: 15 }}>
              <div style={{ flex: 1 }}>
                <label>Age</label>
                <input type="number" value={age} min={18} max={100} onChange={e => setAge(Number(e.target.value))} required />
              </div>
              <div style={{ flex: 1 }}>
                <label>Gender</label>
                <select value={gender} onChange={e => setGender(e.target.value)} required>
                  <option>Male</option><option>Female</option><option>Non-binary</option><option>Other</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" value={location} onChange={e => setLocation(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Voice</label>
              <select value={voiceId} onChange={e => setVoiceId(e.target.value)} required>
                <option value="matthew">Matthew (English US - Male)</option>
                <option value="tiffany">Tiffany (English US - Female)</option>
                <option value="amy">Amy (English UK - Female)</option>
                <option value="olivia">Olivia (English AU - Female)</option>
                <option value="arjun">Arjun (English IN - Male)</option>
                <option value="kiara">Kiara (English IN - Female)</option>
              </select>
            </div>
            <div className="form-section" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              {/*<h4 style={{ margin: '0 0 0.75rem 0' }}>Behavior</h4>*/}
              <div className="form-group">
                <label>Communication Style</label>
                <textarea rows={3} value={communicationStyle} onChange={e => setCommunicationStyle(e.target.value)} placeholder="Describe the customer's communication style..." />
              </div>
              <div className="form-group">
                <label>Behavior</label>
                <textarea rows={3} value={emotionalState} onChange={e => setEmotionalState(e.target.value)} placeholder="Describe the customer's emotional state..." />
              </div>
            </div>
            <div className="form-group">
              <label>Additional Notes</label>
              <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes about the customer or scenario..." />
            </div>
          </div>

          <div className="form-section">
            <h3><i className="fas fa-book-open"></i> Scenario Details</h3>
            <div className="form-group">
              <label>Business Sector</label>
              <input type="text" value={businessVertical} onChange={e => setBusinessVertical(e.target.value)} placeholder="e.g. telco, retail, airline" required />
            </div>
            <div className="form-group">
              <label>Scenario Name</label>
              <input type="text" value={scenarioName} onChange={e => setScenarioName(e.target.value)} required />
            </div>
            <div className="form-section" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              <h4 style={{ margin: '0 0 0.75rem 0' }}>Agent Objectives</h4>
              <div className="form-group">
                <label>Primary</label>
                <DragList items={agentPrimaryObj} onChange={setAgentPrimaryObj} />
              </div>
              <div className="form-group">
                <label>Secondary</label>
                <DragList items={agentSecondaryObj} onChange={setAgentSecondaryObj} />
              </div>
            </div>
            <div className="form-group">
              <label>Scenario Interaction</label>
              <textarea rows={3} value={scenarioInteraction} onChange={e => setScenarioInteraction(e.target.value)} placeholder="Describe the expected scenario interaction or conversation flow..." />
            </div>
          </div>

          <div style={{ textAlign: 'center', display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button type="button" className="button button-secondary" onClick={handleCancel}>
              Clear
            </button>
            <button type="submit" className="button" disabled={generating}>
              {generating ? 'Generating...' : 'Generate Prompt'}
            </button>
          </div>
        </form>

        {/* Always render the prompt container to maintain 2-column layout — matches original HTML */}
        <div id="system-prompt-container">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3><i className="fas fa-file-alt"></i> Scenario Prompt</h3>
            <div id="prompt-edit-actions">
              {systemPrompt && (
                promptReadonly
                  ? <button type="button" title="Edit prompt" onClick={() => { setSavedPrompt(systemPrompt); setPromptReadonly(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><i className="fas fa-pencil-alt"></i></button>
                  : <>
                      <button type="button" title="Confirm" onClick={() => setPromptReadonly(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success-color)', fontSize: '1.25rem' }}><i className="fas fa-check"></i></button>
                      <button type="button" title="Cancel" onClick={() => { setSystemPrompt(savedPrompt); setPromptReadonly(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'red', fontSize: '1.25rem' }}><i className="fas fa-times"></i></button>
                    </>
              )}
            </div>
          </div>
          <textarea
            id="system-prompt-output"
            readOnly={promptReadonly || !systemPrompt}
            value={systemPrompt}
            placeholder="Fill in the scenario details and click 'Generate Prompt' to create a scenario prompt."
            onChange={e => setSystemPrompt(e.target.value)}
          />
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button type="button" className="button" onClick={handleSave} disabled={saving || !systemPrompt}>
              {saving ? 'Saving...' : 'Save Scenario'}
            </button>
            {saveMsg && <p style={{ marginTop: '0.5rem', color: saveMsg.startsWith('Error') ? '#e74c3c' : 'var(--success-color)' }}>{saveMsg}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
