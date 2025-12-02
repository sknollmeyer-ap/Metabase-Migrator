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

interface CardSummary {
  id: number;
  name: string;
  database_id?: number;
  collection_id?: number;
}

interface MigratedCard {
  oldId: number;
  newId: number;
  cardUrl: string;
  timestamp: number;
}

function App() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migratedCards, setMigratedCards] = useState<MigratedCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const defaultDbId = 6;

  // Load cards and migrated cards on mount
  useEffect(() => {
    fetchCards();
    loadMigratedCards();
  }, []);

  // Auto-select first unmigrated card
  useEffect(() => {
    if (cards.length > 0 && migratedCards.length > 0) {
      const firstUnmigrated = cards.findIndex(c => !isCardMigrated(c.id));
      if (firstUnmigrated !== -1) {
        setCurrentCardIndex(firstUnmigrated);
      }
    }
  }, [cards, migratedCards]);

  const loadMigratedCards = () => {
    const stored = localStorage.getItem('migratedCards');
    if (stored) {
      try {
        setMigratedCards(JSON.parse(stored));
      } catch {
        setMigratedCards([]);
      }
    }
  };

  const saveMigratedCard = (migration: MigratedCard) => {
    const updated = [...migratedCards, migration];
    setMigratedCards(updated);
    localStorage.setItem('migratedCards', JSON.stringify(updated));
  };

  const fetchCards = async () => {
    try {
      const res = await fetch(`/api/cards?db=${defaultDbId}`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      // Sort by ID (lowest first)
      const sorted = (Array.isArray(data) ? data : []).sort((a, b) => a.id - b.id);
      setCards(sorted);
      setError(null);
    } catch (err: any) {
      setError('Could not load cards. Ensure the backend is running.');
      setCards([]);
    }
  };

  const isCardMigrated = (cardId: number) => {
    return migratedCards.some(m => m.oldId === cardId);
  };

  const currentCard = cards[currentCardIndex];
  const isMigrated = currentCard ? isCardMigrated(currentCard.id) : false;

  const previewCard = async () => {
    if (!currentCard) return;

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const res = await fetch(`/api/preview/${currentCard.id}`, { method: 'POST' });
      const data = await res.json();
      setPreview(data);
    } catch (err: any) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const migrateCard = async (force = false) => {
    if (!currentCard) return;

    setMigrating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/migrate/${currentCard.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, force })
      });

      const data = await res.json();

      if (data.status === 'success' && data.newId) {
        const migration: MigratedCard = {
          oldId: currentCard.id,
          newId: data.newId,
          cardUrl: data.cardUrl || `https://metabase.alternativepayments.io/question/${data.newId}`,
          timestamp: Date.now()
        };
        saveMigratedCard(migration);
        setSuccess(`✓ Card ${currentCard.id} migrated successfully as Card ${data.newId}`);

        // Move to next card after brief delay
        setTimeout(() => {
          if (currentCardIndex < cards.length - 1) {
            setCurrentCardIndex(currentCardIndex + 1);
            setPreview(null);
            setSuccess(null);
          }
        }, 2000);
      } else {
        setError(data.error || 'Migration failed');
      }
    } catch (err: any) {
      setError(`Migration failed: ${err.message}`);
    } finally {
      setMigrating(false);
    }
  };

  const goToCard = (index: number) => {
    setCurrentCardIndex(index);
    setPreview(null);
    setError(null);
    setSuccess(null);
  };

  const getMigratedInfo = (cardId: number) => {
    return migratedCards.find(m => m.oldId === cardId);
  };

  const progressPercent = cards.length > 0
    ? Math.round((migratedCards.length / cards.length) * 100)
    : 0;

  return (
    <div className="app-container">
      {/* Header */}
      <div className="app-header">
        <h1>⚡ MetaMigrator</h1>
        <p>PostgreSQL → ClickHouse Migration Tool</p>
      </div>

      {/* Progress Stats */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <div className="grid-3">
          <div className="stat-card">
            <div className="stat-value">{migratedCards.length}</div>
            <div className="stat-label">Migrated</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{cards.length - migratedCards.length}</div>
            <div className="stat-label">Remaining</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{progressPercent}%</div>
            <div className="stat-label">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{
          width: '100%',
          height: '8px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '10px',
          marginTop: '1.5rem',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${progressPercent}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
            transition: 'width 0.5s ease',
            borderRadius: '10px'
          }} />
        </div>
      </div>

      <div className="grid-2">
        {/* Left: Card List */}
        <div className="glass-card">
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>📋 Cards</h2>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div className="card-list">
            {cards.map((card, index) => {
              const migrated = isCardMigrated(card.id);
              const migratedInfo = getMigratedInfo(card.id);

              return (
                <div
                  key={card.id}
                  className={`card-item ${index === currentCardIndex ? 'selected' : ''} ${migrated ? 'migrated' : ''}`}
                  onClick={() => goToCard(index)}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      #{card.id} {card.name}
                    </div>
                    {migrated && migratedInfo && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginTop: '0.25rem' }}>
                        → Card #{migratedInfo.newId}
                      </div>
                    )}
                  </div>
                  {migrated ? (
                    <span className="status-badge success">✓ Migrated</span>
                  ) : (
                    <span className="status-badge pending">Pending</span>
                  )}
                </div>
              );
            })}

            {cards.length === 0 && !error && (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                No cards found
              </div>
            )}
          </div>
        </div>

        {/* Right: Current Card Workflow */}
        <div className="glass-card">
          {currentCard ? (
            <>
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                  🎯 Card #{currentCard.id}
                </h2>
                <p style={{ color: 'var(--text-secondary)' }}>{currentCard.name}</p>
              </div>

              {/* Workflow Steps */}
              <div className="workflow-steps">
                <div className={`workflow-step ${!preview ? 'active' : 'completed'}`}>
                  <div className="workflow-step-number">1</div>
                  <div className="workflow-step-label">Check</div>
                </div>
                <div className={`workflow-step ${preview && !isMigrated ? 'active' : preview && isMigrated ? 'completed' : ''}`}>
                  <div className="workflow-step-number">2</div>
                  <div className="workflow-step-label">Review</div>
                </div>
                <div className={`workflow-step ${isMigrated ? 'completed' : ''}`}>
                  <div className="workflow-step-number">3</div>
                  <div className="workflow-step-label">Migrate</div>
                </div>
                <div className={`workflow-step ${isMigrated ? 'active' : ''}`}>
                  <div className="workflow-step-number">4</div>
                  <div className="workflow-step-label">Verify</div>
                </div>
              </div>

              {/* Success Message */}
              {success && (
                <div className="alert alert-success fade-in">
                  {success}
                </div>
              )}

              {/* Already Migrated */}
              {isMigrated && (() => {
                const info = getMigratedInfo(currentCard.id);
                return info ? (
                  <div className="alert alert-info fade-in" style={{ marginTop: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      ✓ Already migrated as Card #{info.newId}
                    </div>
                    <a
                      href={info.cardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                      style={{ marginLeft: '1rem' }}
                    >
                      🔗 View in Metabase
                    </a>
                  </div>
                ) : null;
              })()}

              {/* Step 1: Check */}
              {!preview && !isMigrated && (
                <div className="fade-in" style={{ marginTop: '2rem' }}>
                  <button
                    onClick={previewCard}
                    disabled={loading}
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                  >
                    {loading ? '🔄 Checking mappings...' : '🔍 Check Card & Preview Migration'}
                  </button>
                </div>
              )}

              {/* Step 2 & 3: Review & Migrate */}
              {preview && !isMigrated && (
                <div className="fade-in" style={{ marginTop: '2rem' }}>
                  {/* Warnings */}
                  {preview.warnings && preview.warnings.length > 0 && (
                    <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                      <div>
                        <strong>⚠️ Warnings:</strong>
                        <ul style={{ marginTop: '0.5rem', marginLeft: '1.5rem' }}>
                          {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {preview.errors && preview.errors.length > 0 && (
                    <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                      <div>
                        <strong>❌ Errors:</strong>
                        <ul style={{ marginTop: '0.5rem', marginLeft: '1.5rem' }}>
                          {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
                          Fix these issues before migrating
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Preview Queries - Side by Side */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div className="grid-2">
                      <div>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--warning)' }}>
                          📄 Original Query (PostgreSQL)
                        </h3>
                        <div className="code-block">
                          <pre>{JSON.stringify(preview.original, null, 2)}</pre>
                        </div>
                      </div>

                      <div>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--success)' }}>
                          ✨ Migrated Query (ClickHouse)
                        </h3>
                        <div className="code-block">
                          <pre>{preview.migrated ? JSON.stringify(preview.migrated, null, 2) : 'No migration preview available'}</pre>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Migration Buttons */}
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                    <button
                      onClick={() => migrateCard(false)}
                      disabled={migrating || (preview.errors && preview.errors.length > 0)}
                      className="btn btn-success"
                      style={{ flex: 1 }}
                    >
                      {migrating ? '🔄 Migrating...' : '✓ Migrate Card'}
                    </button>

                    {preview.status === 'already_migrated' && (
                      <button
                        onClick={() => migrateCard(true)}
                        disabled={migrating}
                        className="btn btn-warning"
                      >
                        🔄 Re-migrate & Overwrite
                      </button>
                    )}

                    <button
                      onClick={() => setPreview(null)}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Loading Spinner */}
              {loading && <div className="spinner" />}

              {/* Navigation */}
              <div style={{
                display: 'flex',
                gap: '1rem',
                marginTop: '2rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid rgba(255,255,255,0.1)'
              }}>
                <button
                  onClick={() => goToCard(currentCardIndex - 1)}
                  disabled={currentCardIndex === 0}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  ← Previous
                </button>
                <button
                  onClick={() => goToCard(currentCardIndex + 1)}
                  disabled={currentCardIndex >= cards.length - 1}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Next →
                </button>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              Select a card to begin
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
