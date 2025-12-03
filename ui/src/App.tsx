import { useState, useEffect } from 'react'
import './App.css'
import { UnmatchedMapping } from './components/UnmatchedMapping';
import type { MigrationResponse } from './types';

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
  const [currentCardIndex, setCurrentCardIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<MigrationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migratedCards, setMigratedCards] = useState<MigratedCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [returnToCardId, setReturnToCardId] = useState<number | null>(null);
  const defaultDbId = 6;
  const targetDbId = 10;

  // Load cards and migrated cards on mount
  useEffect(() => {
    fetchCards();
    loadMigratedCards();
  }, []);

  // Auto-refresh preview when returning to a card if it was the parent
  useEffect(() => {
    if (currentCard && returnToCardId === currentCard.id) {
      // We just returned to the parent. Clear the return ID and refresh preview.
      setReturnToCardId(null);
      previewCard();
    }
  }, [currentCardIndex, returnToCardId]);

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

  const currentCard = currentCardIndex !== null ? cards[currentCardIndex] : null;
  const isMigrated = currentCard ? isCardMigrated(currentCard.id) : false;

  const previewCard = async () => {
    if (!currentCard) return;

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      console.log(`Fetching preview for card ${currentCard.id}...`);
      const res = await fetch(`/api/preview/${currentCard.id}`, { method: 'POST' });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Preview API error:', res.status, errorText);
        throw new Error(`API returned ${res.status}: ${errorText}`);
      }

      const data: MigrationResponse = await res.json();
      console.log('Preview response:', data);

      setPreview(data);

      if (data.status === 'failed') {
        // Don't set global error string if we have structured errors, let the UI handle it
        if (!data.errorCode) {
          setError(data.message || 'Preview failed');
        }
      }

    } catch (err: any) {
      console.error('Preview error:', err);
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
      console.log(`Migrating card ${currentCard.id}, force=${force}...`);
      const res = await fetch(`/api/migrate/${currentCard.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, force })
      });

      const data: MigrationResponse = await res.json();
      console.log('Migration response:', data);

      if (data.status === 'ok' && data.newId) {
        const migration: MigratedCard = {
          oldId: currentCard.id,
          newId: data.newId,
          cardUrl: data.cardUrl || `https://metabase.alternativepayments.io/question/${data.newId}`,
          timestamp: Date.now()
        };
        saveMigratedCard(migration);
        setSuccess(`✓ Card ${currentCard.id} migrated successfully as Card ${data.newId}`);

        // Update preview to show success state
        setPreview(data);

        // Handle return flow
        if (returnToCardId) {
          setTimeout(() => {
            const parentIndex = cards.findIndex(c => c.id === returnToCardId);
            if (parentIndex !== -1) {
              selectCard(parentIndex);
              // The useEffect will handle clearing returnToCardId and refreshing preview
            }
          }, 1500); // Brief delay to show success
        }

      } else {
        const errorMsg = data.message || 'Migration failed - unknown error';
        console.error('Migration failed:', errorMsg, data);
        setError(`Migration failed: ${errorMsg}`);
        // Update preview to show error state
        setPreview(data);
      }
    } catch (err: any) {
      console.error('Migration error:', err);
      setError(`Migration failed: ${err.message}`);
    } finally {
      setMigrating(false);
    }
  };

  const selectCard = (index: number) => {
    setCurrentCardIndex(index);
    setPreview(null);
    setError(null);
    setSuccess(null);
    // Note: We don't clear returnToCardId here because we might be navigating TO the dependency
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
        <h1>⚡ MetaMigrator Workbench</h1>
        <p>PostgreSQL → ClickHouse Migration Tool</p>
      </div>

      {/* Main Layout */}
      <div className="workbench-layout">

        {/* Left Pane: Card List */}
        <div className="glass-card card-list-pane">
          <div className="pane-header">
            <h2>📋 Cards ({cards.length})</h2>
            <div className="progress-mini">
              <div className="progress-bar" style={{ width: `${progressPercent}%` }}></div>
            </div>
          </div>

          <div className="card-list-scroll">
            {cards.map((card, index) => {
              const migrated = isCardMigrated(card.id);
              const migratedInfo = getMigratedInfo(card.id);

              return (
                <div
                  key={card.id}
                  className={`card-item ${index === currentCardIndex ? 'selected' : ''} ${migrated ? 'migrated' : ''}`}
                  onClick={() => selectCard(index)}
                >
                  <div className="card-item-content">
                    <div className="card-name">
                      #{card.id} {card.name}
                    </div>
                    {migrated && (
                      <div className="card-status">
                        ✓ #{migratedInfo?.newId}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {cards.length === 0 && !error && (
              <div className="empty-state">No cards found</div>
            )}
          </div>
        </div>

        {/* Right Pane: Card Detail */}
        <div className="glass-card card-detail-pane">
          {currentCard ? (
            <div className="detail-content">
              <div className="detail-header">
                <div>
                  <h2>🎯 Card #{currentCard.id}</h2>
                  <p className="subtitle">{currentCard.name}</p>
                  {returnToCardId && returnToCardId !== currentCard.id && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--primary-light)', marginTop: '0.5rem' }}>
                      ↩ You are resolving a dependency for Card #{returnToCardId}
                    </div>
                  )}
                </div>
                <div className="actions">
                  {preview && (
                    <button onClick={previewCard} className="btn btn-secondary btn-sm" disabled={loading}>
                      🔄 Refresh Preview
                    </button>
                  )}
                </div>
              </div>

              {/* Initial Action */}
              {!preview && !isMigrated && !loading && (
                <div className="empty-state">
                  <button onClick={previewCard} className="btn btn-primary btn-lg">
                    🔍 Check Card & Preview Migration
                  </button>
                </div>
              )}

              {loading && <div className="spinner-container"><div className="spinner"></div><p>Processing...</p></div>}

              {/* Preview / Result Area */}
              {preview && (
                <div className="preview-area fade-in">

                  {/* Status Messages */}
                  {preview.status === 'failed' && (
                    <div className="alert alert-error" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
                        <strong>❌ Migration Check Failed</strong>
                        {preview.errorCode && <div className="error-code">{preview.errorCode}</div>}
                      </div>
                      <p style={{ marginTop: '0.5rem' }}>{preview.message}</p>

                      {/* Dependency Navigation */}
                      {(() => {
                        // Check for dependency error either by code or message content
                        const isDependencyError =
                          preview.errorCode === 'DEPENDENCY_NOT_MIGRATED' ||
                          preview.message?.includes('Dependency card');

                        if (isDependencyError) {
                          const match = preview.message?.match(/Dependency card (\d+)/);
                          const depId = match ? parseInt(match[1]) : (preview.details as any)?.oldId;

                          if (depId) {
                            return (
                              <div style={{ marginTop: '1rem' }}>
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => {
                                    const index = cards.findIndex(c => c.id === depId);
                                    if (index !== -1) {
                                      setReturnToCardId(currentCard.id);
                                      selectCard(index);
                                    } else {
                                      alert(`Card ${depId} not found in the list.`);
                                    }
                                  }}
                                >
                                  👉 Go to Dependency Card #{depId}
                                </button>
                              </div>
                            );
                          }
                        }
                        return null;
                      })()}

                      {preview.details && <pre className="error-details" style={{ marginTop: '1rem', width: '100%' }}>{JSON.stringify(preview.details, null, 2)}</pre>}
                    </div>
                  )}

                  {success && <div className="alert alert-success">{success}</div>}

                  {/* Unmatched Mappings UI */}
                  {(preview.unmatchedTables?.length || 0) > 0 || (preview.unmatchedFields?.length || 0) > 0 ? (
                    <UnmatchedMapping
                      unmatchedTables={preview.unmatchedTables || []}
                      unmatchedFields={preview.unmatchedFields || []}
                      targetDbId={targetDbId}
                      onMappingUpdated={previewCard}
                    />
                  ) : null}

                  {/* Queries Comparison */}
                  <div className="query-comparison">
                    <div className="query-box">
                      <h3>📄 Original (Postgres)</h3>
                      <div className="code-block">
                        <pre>{JSON.stringify(preview.originalQuery || {}, null, 2)}</pre>
                      </div>
                    </div>
                    <div className="query-box">
                      <h3>✨ Migrated (ClickHouse)</h3>
                      <div className="code-block">
                        <pre>{preview.migratedQuery ? JSON.stringify(preview.migratedQuery, null, 2) : 'No migration generated'}</pre>
                      </div>
                    </div>
                  </div>

                  {/* Warnings */}
                  {preview.warnings && preview.warnings.length > 0 && (
                    <div className="alert alert-warning" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <strong>⚠️ Warnings:</strong>
                      <ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>

                      {/* Check for nested card warnings and add navigation */}
                      {(() => {
                        // Look for "Could not map nested card ID 1774"
                        const nestedCardWarning = preview.warnings.find(w => w.includes('Could not map nested card ID'));
                        if (nestedCardWarning) {
                          const match = nestedCardWarning.match(/nested card ID (\d+)/);
                          const depId = match ? parseInt(match[1]) : null;

                          if (depId) {
                            return (
                              <div style={{ marginTop: '1rem' }}>
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => {
                                    const index = cards.findIndex(c => c.id === depId);
                                    if (index !== -1) {
                                      setReturnToCardId(currentCard.id);
                                      selectCard(index);
                                    } else {
                                      alert(`Card ${depId} not found in the list.`);
                                    }
                                  }}
                                >
                                  👉 Go to Dependency Card #{depId}
                                </button>
                              </div>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="action-bar">
                    <button
                      onClick={() => migrateCard(false)}
                      disabled={migrating || preview.status === 'failed'}
                      className="btn btn-success btn-lg"
                    >
                      {migrating ? 'Migrating...' : '✓ Migrate Card'}
                    </button>

                    {preview.status === 'already_migrated' && (
                      <button onClick={() => migrateCard(true)} className="btn btn-warning">
                        🔄 Re-migrate (Overwrite)
                      </button>
                    )}

                    {preview.cardUrl && (
                      <a href={preview.cardUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
                        🔗 View in Metabase
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">Select a card from the list to begin</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
