import { useState, useEffect } from 'react'
import './App.css'
import { DependencyResolver } from './components/DependencyResolver';
import { UnmatchedMapping } from './components/UnmatchedMapping';
import { TableMapper } from './components/TableMapper';
import type { MigrationResponse } from './types';

interface CardStatusItem {
  id: number;
  name: string;
  status: 'unmigrated' | 'ready' | 'on_hold' | 'migrated' | 'failed';
  is_native: boolean;
}

function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'dependencies' | 'tables'>('board');
  const [statuses, setStatuses] = useState<CardStatusItem[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [preview, setPreview] = useState<MigrationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [batchMigrating, setBatchMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [migrationTimestamps, setMigrationTimestamps] = useState<Record<number, number>>({});

  const REQUEST_TIMEOUT_MS = 120000;

  useEffect(() => {
    fetchStatuses();
    loadMigrationTimestamps();
  }, []);

  const loadMigrationTimestamps = () => {
    try {
      const stored = localStorage.getItem('migratedCards');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const map: Record<number, number> = {};
          parsed.forEach((item: any) => {
            if (item.oldId && item.timestamp) {
              map[item.oldId] = item.timestamp;
            }
          });
          setMigrationTimestamps(map);
        }
      }
    } catch (e) {
      console.error('Failed to load migration timestamps', e);
    }
  };

  const saveMigrationTimestamp = (cardId: number) => {
    const timestamp = Date.now();
    const newTimestamps = { ...migrationTimestamps, [cardId]: timestamp };
    setMigrationTimestamps(newTimestamps);

    // Persist to localStorage safely preserving existing array format if possible, 
    // or just updating the relevant one. To keep it simple and compatible with my previous code:
    try {
      const stored = localStorage.getItem('migratedCards');
      let list: any[] = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(list)) list = [];

      // Remove existing entry for this card
      list = list.filter((m: any) => m.oldId !== cardId);
      // Add new entry
      list.push({ oldId: cardId, timestamp, newId: 0, cardUrl: '' }); // We only care about timestamp for sorting here

      localStorage.setItem('migratedCards', JSON.stringify(list));
    } catch (e) {
      console.error('Failed to save migration timestamp', e);
    }
  };

  const fetchStatuses = async () => {
    try {
      const res = await fetch('/api/cards/status');
      if (res.ok) {
        const data = await res.json();
        setStatuses(data);
      }
    } catch (err) {
      console.error('Failed to fetch statuses', err);
    }
  };

  const fetchWithTimeout = async (input: RequestInfo | URL, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const previewCard = async (id: number) => {
    setLoading(true);
    setPreview(null);
    setError(null);
    setSuccess(null);
    setSelectedCardId(id);

    try {
      const res = await fetchWithTimeout(`/api/preview/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPreview(data);
      if (data.status === 'failed' && !data.errorCode) {
        setError(data.message || 'Preview failed');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const migrateCard = async (id: number, force = false, dryRun = false) => {
    setMigrating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithTimeout(`/api/migrate/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, force })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.status === 'ok' || data.status === 'already_migrated') {
        saveMigrationTimestamp(id);
        setSuccess(`Card ${id} migrated successfully`);
        setPreview(data);
        fetchStatuses(); // Refresh board
      } else {
        setError(data.message);
        setPreview(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMigrating(false);
    }
  };

  const runSafeBatch = async () => {
    if (!confirm('This will attempt to migrate all "Ready" cards. Continue?')) return;
    setBatchMigrating(true);
    try {
      const res = await fetch('/api/migrate/safe-batch', { method: 'POST' });
      const data = await res.json();
      alert(`Batch Complete: ${data.summary.success} succeeded, ${data.summary.failed} failed.`);
      // We should technically update timestamps for all successful ones, but we don't know exactly which unless we parse results.
      // For now, let's just refresh statuses. Order might not update perfectly for batch without timestamps, but that's acceptable.
      // Or we can assume all 'success' in batch happened 'now'.
      if (data.results) {
        data.results.forEach((r: any) => {
          if (r.status === 'ok' || r.status === 'already_migrated') {
            saveMigrationTimestamp(r.id);
          }
        });
      }
      fetchStatuses();
    } catch (err: any) {
      console.error(err);
      alert('Batch migration failed');
    } finally {
      setBatchMigrating(false);
    }
  };

  const filteredStatuses = statuses.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.id.toString().includes(searchTerm)
  );

  const readyCards = filteredStatuses
    .filter(s => s.status === 'ready')
    .sort((a, b) => a.id - b.id);

  const blockedCards = filteredStatuses
    .filter(s => s.status === 'on_hold' || s.status === 'failed' || s.status === 'unmigrated')
    .sort((a, b) => a.id - b.id);

  const migratedCardsList = filteredStatuses
    .filter(s => s.status === 'migrated')
    .sort((a, b) => {
      const timeA = migrationTimestamps[a.id] || 0;
      const timeB = migrationTimestamps[b.id] || 0;
      return timeB - timeA; // Descending (newest first)
    });

  const renderCardItem = (item: CardStatusItem) => (
    <div
      key={item.id}
      className={`card-item ${selectedCardId === item.id ? 'selected' : ''} ${item.status}`}
      onClick={() => previewCard(item.id)}
    >
      <div className="card-item-header">
        <span className="card-id">#{item.id}</span>
        {item.is_native && <span className="tag-native">SQL</span>}
      </div>
      <div className="card-name">{item.name}</div>
      <div className="card-status-label">{item.status.replace('_', ' ')}</div>
    </div>
  );

  return (
    <div className="app-container">
      <div className="app-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h1>⚡ MetaMigrator Workbench</h1>
            <p>Assisted Migration System</p>
          </div>
          <div className="tab-switcher" style={{ display: 'flex', gap: '1rem' }}>
            <button className={`btn ${activeTab === 'board' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('board')}>Migration Board</button>
            <button className={`btn ${activeTab === 'tables' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('tables')}>Table Mappings</button>
            <button className={`btn ${activeTab === 'dependencies' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('dependencies')}>Dependency Graph</button>
          </div>
        </div>
      </div>

      {activeTab === 'tables' && <div className="workbench-layout" style={{ display: 'block' }}><TableMapper /></div>}
      {activeTab === 'dependencies' && <div className="workbench-layout" style={{ display: 'block' }}><DependencyResolver /></div>}

      {activeTab === 'board' && (
        <div className="workbench-layout-board">
          <div className="board-controls glass-card">
            <input
              type="text"
              placeholder="Search cards..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input"
              style={{ width: '300px' }}
            />
            <button className="btn btn-secondary" onClick={fetchStatuses}>Refresh Statuses</button>
            <div style={{ flex: 1 }}></div>
            <button className="btn btn-success" onClick={runSafeBatch} disabled={batchMigrating || readyCards.length === 0}>
              {batchMigrating ? 'Migrating...' : `Migrate All Ready (${readyCards.length})`}
            </button>
          </div>

          <div className="board-columns">
            <div className="board-column">
              <h3 className="column-header ready">Ready to Migrate ({readyCards.length})</h3>
              <div className="column-content">
                {readyCards.map(renderCardItem)}
              </div>
            </div>
            <div className="board-column">
              <h3 className="column-header blocked">Blocked / Needs Review ({blockedCards.length})</h3>
              <div className="column-content">
                {blockedCards.map(renderCardItem)}
              </div>
            </div>
            <div className="board-column">
              <h3 className="column-header migrated">Migrated ({migratedCardsList.length})</h3>
              <div className="column-content">
                {migratedCardsList.map(renderCardItem)}
              </div>
            </div>
          </div>

          {/* Preview Modal / bottom pane */}
          {selectedCardId && (
            <div className="card-detail-pane glass-card slide-up">
              <div className="detail-header">
                <h2>Card #{selectedCardId}</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelectedCardId(null)}>Close</button>
              </div>

              {loading && <div>Loading preview...</div>}
              {error && <div className="alert alert-error">{error}</div>}
              {success && <div className="alert alert-success">{success}</div>}

              {preview && (
                <div className="preview-content">
                  <div className="action-bar">
                    <button className="btn btn-primary" onClick={() => migrateCard(selectedCardId!, true)} disabled={migrating}>
                      {migrating ? 'Migrating...' : 'Migrate Now'}
                    </button>
                    {preview.cardUrl && <a href={preview.cardUrl} target="_blank" className="btn btn-secondary">View in Metabase</a>}
                  </div>

                  {preview.status === 'failed' && (
                    <div className="alert alert-error">
                      <strong>{preview.errorCode}</strong>: {preview.message}
                      {preview.unmatchedTables && (
                        <UnmatchedMapping
                          unmatchedTables={preview.unmatchedTables}
                          unmatchedFields={preview.unmatchedFields || []}
                          targetDbId={10}
                          onMappingUpdated={() => previewCard(selectedCardId!)}
                        />
                      )}
                    </div>
                  )}

                  <div className="query-comparison">
                    <div className="query-box">
                      <h4>Original</h4>
                      <pre>{JSON.stringify(preview.originalQuery, null, 2)}</pre>
                    </div>
                    <div className="query-box">
                      <h4>Migrated</h4>
                      <pre>{JSON.stringify(preview.migratedQuery, null, 2)}</pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        .workbench-layout-board {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 80px);
            padding: 1rem;
            gap: 1rem;
        }
        .board-controls {
            padding: 1rem;
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        .board-columns {
            display: flex;
            gap: 1rem;
            flex: 1;
            overflow: hidden;
        }
        .board-column {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            border: 1px solid var(--border);
        }
        .column-header {
            padding: 1rem;
            border-bottom: 1px solid var(--border);
            margin: 0;
            font-size: 1rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .column-header.ready { color: var(--success); border-bottom-color: var(--success); }
        .column-header.blocked { color: var(--warning); border-bottom-color: var(--warning); }
        .column-header.migrated { color: var(--primary); border-bottom-color: var(--primary); }
        
        .column-content {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .card-item {
            background: var(--bg-secondary);
            padding: 0.75rem;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.2s;
        }
        .card-item:hover {
            transform: translateY(-2px);
            background: var(--bg-tertiary);
        }
        .card-item.selected {
            border-color: var(--primary);
            background: var(--bg-tertiary);
        }
        .card-item-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.25rem;
        }
        .card-id { font-size: 0.75rem; color: var(--text-tertiary); }
        .tag-native { 
            font-size: 0.65rem; background: #6366f1; color: white; padding: 1px 4px; border-radius: 3px; 
        }
        .card-status-label { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.25rem; text-transform: uppercase; }
        
        .card-detail-pane {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 50vh;
            background: #1e1e1e; /* Ensure contrast */
            border-top: 1px solid var(--border);
            padding: 1rem;
            overflow-y: auto;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.5);
            z-index: 100;
        }
        .slide-up { animation: slideUp 0.3s ease-out; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </div>
  );
}

export default App;
