import { useState, useEffect } from 'react'
import './App.css'

interface CardPreview {
  cardId: number;
  cardName: string;
  original: any;
  migrated: any;
  warnings: string[];
  errors: string[];
  status?: string;
  newId?: number;
  cardUrl?: string;
}

interface Status {
  initialized: boolean;
  tablesMapped: number;
  fieldsMapped: number;
  missingTables: number;
}

interface CardSummary {
  id: number;
  name: string;
  database_id?: number;
  collection_id?: number;
}

function App() {
  const [view, setView] = useState<'dashboard' | 'preview' | 'mappings' | 'ignored' | 'confirmed'>('dashboard');
  const [status, setStatus] = useState<Status | null>(null);
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [mappings, setMappings] = useState<any[]>([]);
  const [currentMappingIndex, setCurrentMappingIndex] = useState(0);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [ignoredMappings, setIgnoredMappings] = useState<any[]>([]);
  const [confirmedMappings, setConfirmedMappings] = useState<any[]>([]);
  const [ignoredIds, setIgnoredIds] = useState<number[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<number[]>([]);
  const [approving, setApproving] = useState(false);
  const [approveMessage, setApproveMessage] = useState<string | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [cardFilter, setCardFilter] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [overrideOldFieldId, setOverrideOldFieldId] = useState('');
  const [overrideNewFieldId, setOverrideNewFieldId] = useState('');
  const [overrideMessage, setOverrideMessage] = useState<string | null>(null);
  const [fieldCandidates, setFieldCandidates] = useState<{ id: number; name: string; display_name?: string }[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const defaultDbId = 6;

  const suggestFieldMapping = async () => {
    setOverrideMessage(null);
    const oldId = parseInt(overrideOldFieldId, 10);
    if (Number.isNaN(oldId)) {
      setOverrideMessage('Please enter a valid Old Field ID first.');
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch('/api/suggest-field-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_field_id: oldId })
      });
      const data = await res.json();
      if (data.new_field_id) {
        setOverrideNewFieldId(String(data.new_field_id));
        setOverrideMessage(`AI Suggestion: ${data.reason} (Score: ${data.score})`);
      } else {
        setOverrideMessage('AI could not find a confident match.');
      }
    } catch (error: any) {
      setOverrideMessage(`Suggestion failed: ${error.message}`);
    } finally {
      setSuggesting(false);
    }
  };

  const autoSelectFieldFromWarnings = (warnings: string[]) => {
    for (const w of warnings || []) {
      const match = w.match(/id\s+(\d+)/i);
      if (match) {
        const id = parseInt(match[1], 10);
        if (!Number.isNaN(id)) {
          setOverrideOldFieldId(String(id));
          loadFieldCandidates(id);
          return;
        }
      }
    }
  };

  useEffect(() => {
    fetchStatus();
    const storedIgnored = localStorage.getItem('ignoredTableMappings');
    if (storedIgnored) {
      try {
        setIgnoredIds(JSON.parse(storedIgnored));
      } catch {
        setIgnoredIds([]);
      }
    }
    const storedConfirmed = localStorage.getItem('confirmedTableMappings');
    if (storedConfirmed) {
      try {
        setConfirmedIds(JSON.parse(storedConfirmed));
      } catch {
        setConfirmedIds([]);
      }
    }

    // Preload cards list for old DB
    fetchCards(defaultDbId);
  }, []);

  useEffect(() => {
    if (view === 'mappings') {
      fetchUnconfirmedMappings();
    } else if (view === 'confirmed') {
      fetchConfirmedMappings();
    }
  }, [view]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

  const fetchCards = async (dbId: number) => {
    try {
      const res = await fetch(`/api/cards?db=${dbId}`);
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      setCards(Array.isArray(data) ? data : []);
      setCardError(null);
    } catch (error) {
      console.error('Failed to fetch cards list:', error);
      setCardError('Could not load cards. Ensure the backend is running and Metabase is reachable.');
      setCards([]);
    }
  };

  const fetchConfirmedMappings = async () => {
    try {
      setMappingError(null);
      const res = await fetch('/api/table-mappings?confirmed=true');
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      setConfirmedMappings(data);
    } catch (error: any) {
      console.error('Failed to fetch confirmed mappings:', error);
      setMappingError(`Could not load confirmed mappings: ${error.message}`);
      setConfirmedMappings([]);
    }
  };

  const fetchUnconfirmedMappings = async () => {
    let data: any[] = [];
    try {
      setMappingError(null);
      const res = await fetch('/api/table-mappings');
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      data = await res.json();
    } catch (error) {
      console.error('Failed to fetch mappings from API, trying local file:', error);
      try {
        const resLocal = await fetch('/table_mapping_workflow.json');
        if (!resLocal.ok) {
          throw new Error(`Local file returned ${resLocal.status}`);
        }
        data = await resLocal.json();
      } catch (fallbackError) {
        console.error('Failed to fetch local mappings file:', fallbackError);
        setMappingError('Could not load table mappings. Start the backend or ensure table_mapping_workflow.json is available in the public folder.');
        setMappings([]);
        setIgnoredMappings([]);
        return;
      }
    }

    const ignoredSet = new Set(ignoredIds);
    const confirmedSet = new Set(confirmedIds);

    const normalized = (Array.isArray(data) ? data : []).map((m: any) => ({
      ...m,
      confirmed: m.confirmed === true || confirmedSet.has(m.old_table_id),
      ignored: m.ignored === true || ignoredSet.has(m.old_table_id)
    }));

    // Keep local confirmed IDs in sync with any confirmed records we fetched
    const confirmedFromData = normalized.filter((m: any) => m.confirmed === true).map((m: any) => m.old_table_id);
    if (confirmedFromData.length > 0) {
      persistConfirmedIds(Array.from(new Set([...confirmedIds, ...confirmedFromData])));
    }

    const unconfirmed = normalized
      .filter((m: any) => m.confirmed !== true && m.ignored !== true)
      .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));

    const ignoredList = normalized
      .filter((m: any) => m.ignored === true)
      .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));

    setMappings(unconfirmed);
    setIgnoredMappings(ignoredList);
    setCurrentMappingIndex(0);
  };

  const updateMapping = async (oldId: number, confirmed: boolean, finalTableId: number | null) => {
    // Persist locally regardless of backend availability
    persistConfirmedIds(Array.from(new Set([...confirmedIds, oldId])));

    try {
      await fetch(`/api/table-mappings/${oldId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed, final_new_table_id: finalTableId, ignored: false })
      });
    } catch (error) {
      console.warn('Backend update failed; using local confirmation only.', error);
    }

    // Move to next mapping or refresh
    if (currentMappingIndex < mappings.length - 1) {
      setCurrentMappingIndex(currentMappingIndex + 1);
      setMappings(prev => prev.filter(m => m.old_table_id !== oldId));
    } else {
      fetchUnconfirmedMappings();
      setCurrentMappingIndex(0);
    }
  };

  const persistIgnoredIds = (ids: number[]) => {
    setIgnoredIds(ids);
    localStorage.setItem('ignoredTableMappings', JSON.stringify(ids));
  };

  const persistConfirmedIds = (ids: number[]) => {
    setConfirmedIds(ids);
    localStorage.setItem('confirmedTableMappings', JSON.stringify(ids));
  };

  const ignoreMapping = async (mapping: any) => {
    const newIgnored = [...ignoredIds, mapping.old_table_id];
    persistIgnoredIds(newIgnored);

    setMappings(prev => prev.filter(m => m.old_table_id !== mapping.old_table_id));
    setIgnoredMappings(prev => [...prev, { ...mapping, ignored: true }].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)));
    setCurrentMappingIndex(0);

    try {
      await fetch(`/api/table-mappings/${mapping.old_table_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: mapping.confirmed === true || confirmedIds.includes(mapping.old_table_id),
          final_new_table_id: mapping.final_new_table_id || null,
          ignored: true
        })
      });
    } catch (error) {
      console.warn('Backend ignore persist failed; using local-only ignore.', error);
    }
  };

  const restoreIgnored = async (mapping: any) => {
    const filteredIds = ignoredIds.filter(id => id !== mapping.old_table_id);
    persistIgnoredIds(filteredIds);

    setIgnoredMappings(prev => prev.filter(m => m.old_table_id !== mapping.old_table_id));
    setMappings(prev => [...prev, { ...mapping, ignored: false }].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)));
    setCurrentMappingIndex(0);

    try {
      await fetch(`/api/table-mappings/${mapping.old_table_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: mapping.confirmed === true || confirmedIds.includes(mapping.old_table_id),
          final_new_table_id: mapping.final_new_table_id || null,
          ignored: false
        })
      });
    } catch (error) {
      console.warn('Backend restore failed; using local-only unignore.', error);
    }
  };

  const unconfirmMapping = async (mapping: any) => {
    const filteredIds = confirmedIds.filter(id => id !== mapping.old_table_id);
    persistConfirmedIds(filteredIds);

    setConfirmedMappings(prev => prev.filter(m => m.old_table_id !== mapping.old_table_id));
    // We don't automatically add it back to 'mappings' because we want to fetch fresh data or let the user navigate back
    // But for better UX, we could add it back if we were in the 'mappings' view.
    // Since we are in 'confirmed' view, removing it is enough.

    try {
      await fetch(`/api/table-mappings/${mapping.old_table_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: false,
          final_new_table_id: null,
          ignored: false
        })
      });
    } catch (error) {
      console.warn('Backend unconfirm failed; using local-only unconfirm.', error);
    }
  };

  const previewCard = async (cardId: number) => {
    console.log(`🔍 PREVIEWING CARD ${cardId}`);
    setLoading(true);
    setApproveMessage(null);
    try {
      console.log(`📡 Fetching /api/preview/${cardId}`);
      const res = await fetch(`/api/preview/${cardId}`, { method: 'POST' });
      console.log(`📥 Response status: ${res.status}`);
      const data = await res.json();
      console.log(`📦 Response data:`, data);
      setPreview(data);
      setView('preview');
      setSelectedCardId(cardId);
      autoSelectFieldFromWarnings(data.warnings || []);
    } catch (error) {
      console.error('❌ Failed to preview card:', error);
    } finally {
      setLoading(false);
    }
  };

  const approveCard = async (force: boolean = false) => {
    if (!preview) return;
    setApproving(true);
    setApproveMessage(null);
    try {
      const res = await fetch(`/api/migrate/${preview.cardId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, force })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed with ${res.status}`);
      }
      const data = await res.json();
      setApproveMessage(`Approved and created card ${data.newId || '(id unknown)'}.`);
    } catch (error: any) {
      setApproveMessage(`Approve failed: ${error.message || error}`);
    } finally {
      setApproving(false);
    }
  };

  const submitFieldOverride = async () => {
    setOverrideMessage(null);
    const oldId = parseInt(overrideOldFieldId, 10);
    const newId = parseInt(overrideNewFieldId, 10);
    if (Number.isNaN(oldId) || Number.isNaN(newId)) {
      setOverrideMessage('Both old field ID and new field ID must be numbers.');
      return;
    }
    try {
      const res = await fetch('/api/field-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_field_id: oldId, new_field_id: newId })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed with status ${res.status}`);
      }
      setOverrideMessage(`Override saved: ${oldId} -> ${newId}. Reload preview to use it.`);
    } catch (error: any) {
      setOverrideMessage(`Override failed: ${error.message || error}`);
    }
  };

  const loadFieldCandidates = async (oldId: number) => {
    try {
      const res = await fetch(`/api/field-candidates/${oldId}`);
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const data = await res.json();
      setFieldCandidates(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0) {
        setOverrideNewFieldId(String(data[0].id));
      }
    } catch (error: any) {
      setOverrideMessage(`Failed to load candidates: ${error.message || error}`);
      setFieldCandidates([]);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Metabase Migration Tool</h1>
        <p>Postgres -&gt; ClickHouse</p>
      </header>

      <nav className="nav">
        <button
          className={view === 'dashboard' ? 'active' : ''}
          onClick={() => setView('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={view === 'preview' ? 'active' : ''}
          onClick={() => setView('preview')}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Card Preview'}
        </button>
        <button
          className={view === 'mappings' ? 'active' : ''}
          onClick={() => setView('mappings')}
        >
          Table Mappings
        </button>
        <button
          className={view === 'ignored' ? 'active' : ''}
          onClick={() => setView('ignored')}
        >
          Ignored
        </button>
        <button
          className={view === 'confirmed' ? 'active' : ''}
          onClick={() => setView('confirmed')}
        >
          Confirmed
        </button>
      </nav>

      <main className="main">
        {view === 'dashboard' && status && (
          <div className="dashboard">
            <h2>Migration Status</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Tables Mapped</div>
                <div className="stat-value">{status.tablesMapped}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Fields Mapped</div>
                <div className="stat-value">{status.fieldsMapped}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Missing Tables</div>
                <div className="stat-value warning">{status.missingTables}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Status</div>
                <div className="stat-value success">
                  {status.initialized ? 'Ready' : 'Initializing'}
                </div>
              </div>
            </div>

            <div className="info-box">
              <h3>Quick Start</h3>
              <ol>
                <li>Click "Preview Card 4094" to see migration preview</li>
                <li>Review the before/after comparison</li>
                <li>Check for warnings or errors</li>
                <li>Manually approve or reject the migration</li>
              </ol>
            </div>
          </div>
        )}

        {view === 'preview' && preview && (
          <div className="preview">
            <h2>Card Preview: {preview.cardName}</h2>

            {preview.status === 'already_migrated' && (
              <div className="info-box warning" style={{ marginBottom: '1rem', borderLeft: '4px solid #ff9800', backgroundColor: '#fff3e0', padding: '1rem' }}>
                <h3 style={{ marginTop: 0, color: '#e65100' }}>⚠️ Already Migrated</h3>
                <p>This card has already been migrated to <strong>Card {preview.newId}</strong>.</p>
                <div className="actions" style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
                  <button
                    className="btn-approve"
                    onClick={() => approveCard(true)}
                    disabled={approving}
                    style={{ backgroundColor: '#e65100' }}
                  >
                    {approving ? 'Overwriting...' : 'Re-migrate & Overwrite'}
                  </button>
                </div>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="warnings">
                <h3>Warnings</h3>
                <ul>
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.errors.length > 0 && (
              <div className="errors">
                <h3>Errors</h3>
                <ul>
                  {preview.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="comparison">
              <div className="comparison-column">
                <h3>Original (Postgres DB 6)</h3>
                <pre>{JSON.stringify(preview.original, null, 2)}</pre>
              </div>
              <div className="comparison-column">
                <h3>Migrated (ClickHouse DB 10)</h3>
                {preview.migrated ? (
                  <pre>{JSON.stringify(preview.migrated, null, 2)}</pre>
                ) : (
                  <div className="empty-state">Migration failed or incomplete</div>
                )}
              </div>
            </div>

            {preview.status !== 'already_migrated' && (
              <div className="actions">
                <button className="btn-approve" onClick={() => approveCard(false)} disabled={approving}>
                  {approving ? 'Approving...' : 'Approve & Migrate'}
                </button>
                <button className="btn-reject" onClick={() => setView('dashboard')}>
                  Back to Dashboard
                </button>
              </div>
            )}

            {preview.status === 'already_migrated' && (
              <div className="actions">
                <button className="btn-reject" onClick={() => setView('dashboard')}>
                  Back to Dashboard
                </button>
              </div>
            )}

            {approveMessage && (
              <div className="info-box" style={{ marginTop: '1rem' }}>
                <p>{approveMessage}</p>
              </div>
            )}

            <div className="info-box" style={{ marginTop: '1rem' }}>
              <h3>Manual Field Override</h3>
              <p style={{ marginBottom: '0.5rem' }}>Set a manual mapping for an unmapped field ID.</p>
              <div className="override-form">
                <input
                  type="text"
                  placeholder="Old field ID"
                  value={overrideOldFieldId}
                  onChange={(e) => {
                    setOverrideOldFieldId(e.target.value);
                    const oldId = parseInt(e.target.value, 10);
                    if (!Number.isNaN(oldId)) {
                      loadFieldCandidates(oldId);
                    } else {
                      setFieldCandidates([]);
                      setOverrideNewFieldId('');
                    }
                  }}
                />
                <button
                  onClick={suggestFieldMapping}
                  disabled={suggesting || !overrideOldFieldId}
                  style={{ marginLeft: '0.5rem', marginRight: '0.5rem', backgroundColor: '#6c5ce7', color: 'white' }}
                >
                  {suggesting ? 'Thinking...' : '✨ AI Suggest'}
                </button>
                {fieldCandidates.length > 0 && (
                  <select
                    value={overrideNewFieldId}
                    onChange={(e) => setOverrideNewFieldId(e.target.value)}
                  >
                    {fieldCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.display_name ? `(${c.display_name})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  placeholder="New field ID"
                  value={overrideNewFieldId}
                  onChange={(e) => setOverrideNewFieldId(e.target.value)}
                />
                <button onClick={submitFieldOverride}>Save Override</button>
              </div>
              {overrideMessage && <p>{overrideMessage}</p>}
            </div>
          </div>
        )}

        {view === 'preview' && (
          <div className="preview" style={{ marginTop: '1rem' }}>
            <h3>Select a Card to Preview (DB 6)</h3>
            <div className="card-selector">
              <input
                type="text"
                placeholder="Filter by name or ID..."
                value={cardFilter}
                onChange={(e) => setCardFilter(e.target.value)}
              />
              {cardError && (
                <div className="errors" style={{ marginBottom: '0.5rem' }}>
                  <h3>Error</h3>
                  <ul>
                    <li>{cardError}</li>
                  </ul>
                </div>
              )}
              <div className="card-list">
                {cards
                  .filter(c => {
                    const term = cardFilter.toLowerCase();
                    return (
                      !term ||
                      c.name.toLowerCase().includes(term) ||
                      String(c.id).includes(term)
                    );
                  })
                  .slice(0, 200)
                  .map(c => (
                    <button
                      key={c.id}
                      className={`card-list-item ${selectedCardId === c.id ? 'active' : ''}`}
                      onClick={() => previewCard(c.id)}
                      disabled={loading}
                    >
                      <span className="card-id">#{c.id}</span>
                      <span className="card-name">{c.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}

        {view === 'mappings' && mappings.length > 0 && (
          <div className="mappings">
            <h2>Table Mapping Review</h2>
            {mappingError && (
              <div className="errors" style={{ marginBottom: '1rem' }}>
                <h3>Error</h3>
                <ul>
                  <li>{mappingError}</li>
                </ul>
              </div>
            )}
            <div className="mapping-progress">
              Reviewing {currentMappingIndex + 1} of {mappings.length} unmapped tables
            </div>

            {mappings[currentMappingIndex] && (
              <div className="mapping-card">
                <div className="mapping-header">
                  <h3>Source Table (Postgres DB 6)</h3>
                  <div className="table-name">{mappings[currentMappingIndex].old_table_name}</div>
                  <div className="table-id">ID: {mappings[currentMappingIndex].old_table_id}</div>
                </div>

                <div className="mapping-suggestion">
                  <h3>Suggested Match ({(mappings[currentMappingIndex].confidence * 100).toFixed(1)}% confidence)</h3>
                  <div className="table-name suggested">{mappings[currentMappingIndex].suggested_new_table_name}</div>
                  <div className="table-id">ID: {mappings[currentMappingIndex].suggested_new_table_id}</div>

                  <div className="mapping-actions">
                    <button
                      className="btn-confirm"
                      onClick={() => updateMapping(
                        mappings[currentMappingIndex].old_table_id,
                        true,
                        mappings[currentMappingIndex].suggested_new_table_id
                      )}
                    >
                      Confirm This Mapping
                    </button>
                    <button
                      className="btn-skip"
                      onClick={() => ignoreMapping(mappings[currentMappingIndex])}
                    >
                      Ignore
                    </button>
                    <button
                      className="btn-skip"
                      onClick={() => {
                        if (currentMappingIndex < mappings.length - 1) {
                          setCurrentMappingIndex(currentMappingIndex + 1);
                        }
                      }}
                    >
                      Skip for Now
                    </button>
                  </div>
                </div>

                {mappings[currentMappingIndex].alternatives && mappings[currentMappingIndex].alternatives.length > 0 && (
                  <div className="mapping-alternatives">
                    <h3>Alternative Matches</h3>
                    {mappings[currentMappingIndex].alternatives.map((alt: any, idx: number) => (
                      <div key={idx} className="alternative-option">
                        <div className="alt-info">
                          <div className="table-name">{alt.table_name}</div>
                          <div className="table-id">ID: {alt.table_id} ({(alt.score * 100).toFixed(1)}%)</div>
                        </div>
                        <button
                          className="btn-select-alt"
                          onClick={() => updateMapping(
                            mappings[currentMappingIndex].old_table_id,
                            true,
                            alt.table_id
                          )}
                        >
                          Use This Instead
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mapping-navigation">
                  <button
                    disabled={currentMappingIndex === 0}
                    onClick={() => setCurrentMappingIndex(currentMappingIndex - 1)}
                  >
                    {'< Previous'}
                  </button>
                  <button
                    disabled={currentMappingIndex === mappings.length - 1}
                    onClick={() => setCurrentMappingIndex(currentMappingIndex + 1)}
                  >
                    Next &gt;
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'mappings' && mappings.length === 0 && (
          <div className="empty-state">
            {mappingError ? (
              <>
                <h2>Unable to Load Mappings</h2>
                <p>{mappingError}</p>
              </>
            ) : (
              <>
                <h2>All Mappings Confirmed!</h2>
                <p>All table mappings have been reviewed and confirmed.</p>
              </>
            )}
          </div>
        )}

        {view === 'ignored' && (
          <div className="mappings">
            <h2>Ignored Table Mappings</h2>
            {ignoredMappings.length === 0 && (
              <div className="empty-state">
                <p>No ignored mappings.</p>
              </div>
            )}
            {ignoredMappings.length > 0 && (
              <div className="mapping-list">
                {ignoredMappings.map((m: any) => (
                  <div key={m.old_table_id} className="mapping-card" style={{ marginBottom: '1rem' }}>
                    <div className="mapping-header">
                      <h3>{m.old_table_name}</h3>
                      <div className="table-id">ID: {m.old_table_id}</div>
                    </div>
                    <div className="mapping-suggestion">
                      <h4>Suggested: {m.suggested_new_table_name}</h4>
                      <div className="table-id">ID: {m.suggested_new_table_id}</div>
                      <div className="table-id">Confidence: {(m.confidence * 100).toFixed(1)}%</div>
                      <div className="mapping-actions" style={{ marginTop: '1rem' }}>
                        <button className="btn-confirm" onClick={() => restoreIgnored(m)}>
                          Restore
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'confirmed' && (
          <div className="mappings">
            <h2>Confirmed Table Mappings</h2>
            {confirmedMappings.length === 0 && (
              <div className="empty-state">
                <p>No confirmed mappings found.</p>
              </div>
            )}
            {confirmedMappings.length > 0 && (
              <div className="mapping-list">
                {confirmedMappings.map((m: any) => (
                  <div key={m.old_table_id} className="mapping-card" style={{ marginBottom: '1rem' }}>
                    <div className="mapping-header">
                      <h3>{m.old_table_name}</h3>
                      <div className="table-id">ID: {m.old_table_id}</div>
                    </div>
                    <div className="mapping-suggestion">
                      <h4>Mapped to: {m.final_new_table_name || m.suggested_new_table_name}</h4>
                      <div className="table-id">New ID: {m.final_new_table_id || m.suggested_new_table_id}</div>

                      <div className="mapping-actions" style={{ marginTop: '1rem' }}>
                        <button
                          className="btn-skip"
                          onClick={() => unconfirmMapping(m)}
                        >
                          Unmatch (Move to Pending)
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Migration Tool v1.0 | Dry-run mode active</p>
      </footer>
    </div>
  )
}

export default App
