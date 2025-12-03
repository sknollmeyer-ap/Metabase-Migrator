import { useState, useEffect, useRef } from 'react'
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
  const [onHoldIds, setOnHoldIds] = useState<number[]>([]);
  const [unmigratedOverrides, setUnmigratedOverrides] = useState<number[]>([]);
  const [visibleCounts, setVisibleCounts] = useState({ onHold: 10, unmigrated: 10, migrated: 10 });
  const unmigratedRef = useRef<HTMLDivElement | null>(null);
  const migratedRef = useRef<HTMLDivElement | null>(null);
  const onHoldRef = useRef<HTMLDivElement | null>(null);
  const defaultDbId = 6;
  const targetDbId = 10;
  const REQUEST_TIMEOUT_MS = 120000; // avoid hanging UI if API never returns

  const fetchWithTimeout = async (input: RequestInfo | URL, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  // Load cards and migrated cards on mount
  useEffect(() => {
    loadUnmigratedOverrides();
    fetchCards();
    loadMigratedCards();
    loadOnHold();
  }, []);

  // Auto-refresh preview when returning to a card if it was the parent
  useEffect(() => {
    if (currentCard && returnToCardId === currentCard.id) {
      // We just returned to the parent. Clear the return ID and refresh preview.
      setReturnToCardId(null);
      previewCard();
    }
  }, [currentCardIndex, returnToCardId]);

  const loadMigratedCards = async () => {
    const overrides = readUnmigratedOverrides();
    try {
      // First, load from localStorage
      const stored = localStorage.getItem('migratedCards');
      let localMappings: MigratedCard[] = [];
      if (stored) {
        try {
          localMappings = JSON.parse(stored);
        } catch {
          localMappings = [];
        }
      }

      // Then fetch from backend
      const res = await fetch('/api/card-mappings');
      if (res.ok) {
        const backendMappings: MigratedCard[] = await res.json();

        // Merge: backend is source of truth, but keep localStorage for timestamps
        const merged = new Map<number, MigratedCard>();

        // Add backend mappings first
        backendMappings.forEach(m => {
          merged.set(m.oldId, m);
        });

        // Update with localStorage timestamps if available
        localMappings.forEach(local => {
          const existing = merged.get(local.oldId);
          if (existing) {
            existing.timestamp = local.timestamp || Date.now();
          }
        });

        const result = Array.from(merged.values()).filter(m => !overrides.includes(m.oldId));
        setMigratedCards(result);
        localStorage.setItem('migratedCards', JSON.stringify(result));
      } else {
        // Fallback to localStorage only
        const filtered = localMappings.filter(m => !overrides.includes(m.oldId));
        setMigratedCards(filtered);
      }
    } catch (err) {
      console.error('Failed to load migrated cards:', err);
      // Fallback to localStorage
      const stored = localStorage.getItem('migratedCards');
      if (stored) {
        try {
          const parsed: MigratedCard[] = JSON.parse(stored);
          const filtered = parsed.filter(m => !overrides.includes(m.oldId));
          setMigratedCards(filtered);
        } catch {
          setMigratedCards([]);
        }
      }
    }
  };

  const saveMigratedCard = (migration: MigratedCard) => {
    const updated = [...migratedCards.filter(m => m.oldId !== migration.oldId), migration];
    setMigratedCards(updated);
    localStorage.setItem('migratedCards', JSON.stringify(updated));
    persistUnmigratedOverrides(unmigratedOverrides.filter(id => id !== migration.oldId));
  };

  const removeMigratedCard = (cardId: number) => {
    const updatedMappings = migratedCards.filter(m => m.oldId !== cardId);
    setMigratedCards(updatedMappings);
    localStorage.setItem('migratedCards', JSON.stringify(updatedMappings));
    persistUnmigratedOverrides([...unmigratedOverrides, cardId]);
  };

  const loadOnHold = () => {
    try {
      const stored = localStorage.getItem('onHoldCards');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setOnHoldIds(parsed);
        }
      }
    } catch {
      setOnHoldIds([]);
    }
  };

  const saveOnHold = (ids: number[]) => {
    setOnHoldIds(ids);
    localStorage.setItem('onHoldCards', JSON.stringify(ids));
  };

  const addToOnHold = (cardId: number) => {
    if (onHoldIds.includes(cardId)) return;
    saveOnHold([...onHoldIds, cardId]);
  };

  const removeFromOnHold = (cardId: number) => {
    if (!onHoldIds.includes(cardId)) return;
    saveOnHold(onHoldIds.filter(id => id !== cardId));
  };

  const readUnmigratedOverrides = (): number[] => {
    try {
      const stored = localStorage.getItem('unmigratedOverrides');
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((id: any) => typeof id === 'number') : [];
    } catch {
      return [];
    }
  };

  const loadUnmigratedOverrides = () => {
    setUnmigratedOverrides(readUnmigratedOverrides());
  };

  const persistUnmigratedOverrides = (ids: number[]) => {
    const unique = Array.from(new Set(ids));
    setUnmigratedOverrides(unique);
    localStorage.setItem('unmigratedOverrides', JSON.stringify(unique));
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
    if (unmigratedOverrides.includes(cardId)) return false;
    return migratedCards.some(m => m.oldId === cardId);
  };

  const isOnHold = (cardId: number) => onHoldIds.includes(cardId);

  const migratedCardsList = cards.filter(card => isCardMigrated(card.id));
  const onHoldCards = cards.filter(card => isOnHold(card.id));
  const unmigratedCards = cards.filter(card => !isCardMigrated(card.id) && !isOnHold(card.id));

  const currentCard = currentCardIndex !== null ? cards[currentCardIndex] : null;
  const isMigrated = currentCard ? isCardMigrated(currentCard.id) : false;
  const isCurrentOnHold = currentCard ? isOnHold(currentCard.id) : false;

  // Adjust visible slices when list sizes change
  useEffect(() => {
    const clamp = (current: number, length: number) => {
      if (length === 0) return 0;
      const base = Math.min(10, length);
      return Math.min(Math.max(base, current), length);
    };

    setVisibleCounts(prev => ({
      onHold: clamp(prev.onHold, onHoldCards.length),
      unmigrated: clamp(prev.unmigrated, unmigratedCards.length),
      migrated: clamp(prev.migrated, migratedCardsList.length)
    }));
  }, [onHoldCards.length, unmigratedCards.length, migratedCardsList.length]);

  // Infinite scroll per section
  useEffect(() => {
    const attachScroll = (ref: React.RefObject<HTMLDivElement>, key: 'onHold' | 'unmigrated' | 'migrated', length: number) => {
      const node = ref.current;
      if (!node) return () => {};
      const handler = () => {
        if (node.scrollTop + node.clientHeight >= node.scrollHeight - 24) {
          setVisibleCounts(prev => ({
            ...prev,
            [key]: Math.min(length, prev[key] + 10)
          }));
        }
      };
      node.addEventListener('scroll', handler);
      return () => node.removeEventListener('scroll', handler);
    };

    const cleanups = [
      attachScroll(unmigratedRef, 'unmigrated', unmigratedCards.length),
      attachScroll(migratedRef, 'migrated', migratedCardsList.length),
      attachScroll(onHoldRef, 'onHold', onHoldCards.length)
    ];

    return () => cleanups.forEach(fn => fn());
  }, [unmigratedCards.length, migratedCardsList.length, onHoldCards.length]);

  const previewCard = async () => {
    if (!currentCard) return;

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      console.log(`Fetching preview for card ${currentCard.id}...`);
      const res = await fetchWithTimeout(`/api/preview/${currentCard.id}`, { method: 'POST' });

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
      if (err?.name === 'AbortError') {
        setError('Preview timed out. Please try again or run the migration locally for complex queries.');
      } else {
        setError(`Preview failed: ${err.message}`);
      }
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
      const res = await fetchWithTimeout(`/api/migrate/${currentCard.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, force })
      });

      // Check if response is OK before parsing
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Migration API error:', res.status, errorText);
        throw new Error(`API returned ${res.status}: ${errorText}`);
      }

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
        setSuccess(`✅ Card ${currentCard.id} migrated successfully as Card ${data.newId}`);

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
      if (err?.name === 'AbortError') {
        setError('Migration timed out. Please retry or run locally for complex queries.');
      } else {
        setError(`Migration failed: ${err.message}`);
      }
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
            <div className="card-section">
              <h3 className="section-header">Unmigrated Cards ({unmigratedCards.length})</h3>
              <div className="section-list" ref={unmigratedRef}>
                {unmigratedCards.length === 0 ? (
                  <div className="empty-state">No unmigrated cards</div>
                ) : (
                  unmigratedCards.slice(0, visibleCounts.unmigrated).map(card => {
                    const index = cards.findIndex(c => c.id === card.id);
                    return (
                      <div
                        key={card.id}
                        className={`card-item ${index === currentCardIndex ? 'selected' : ''}`}
                        onClick={() => selectCard(index)}
                      >
                        <div className="card-item-content">
                          <div className="card-name">
                            #{card.id} {card.name}
                          </div>
                          <button
                            className="btn btn-secondary btn-xs"
                            onClick={(e) => { e.stopPropagation(); addToOnHold(card.id); }}
                          >
                            Put on hold
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="card-section">
              <h3 className="section-header">Migrated Cards ({migratedCardsList.length})</h3>
              <div className="section-list" ref={migratedRef}>
                {migratedCardsList.length === 0 ? (
                  <div className="empty-state">No migrated cards</div>
                ) : (
                  migratedCardsList.slice(0, visibleCounts.migrated).map(card => {
                    const index = cards.findIndex(c => c.id === card.id);
                    const migratedInfo = getMigratedInfo(card.id);
                    return (
                      <div
                        key={card.id}
                        className={`card-item ${index === currentCardIndex ? 'selected' : ''} migrated`}
                        onClick={() => selectCard(index)}
                      >
                        <div className="card-item-content">
                          <div className="card-name">
                            #{card.id} {card.name}
                          </div>
                          <div className="card-status">
                            {"-> "}{migratedInfo?.newId}
                          </div>
                          <button
                            className="btn btn-secondary btn-xs"
                            onClick={(e) => { e.stopPropagation(); removeMigratedCard(card.id); }}
                          >
                            Move to Unmigrated
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="card-section">
              <h3 className="section-header">On Hold Cards ({onHoldCards.length})</h3>
              <div className="section-list" ref={onHoldRef}>
                {onHoldCards.length === 0 ? (
                  <div className="empty-state">No cards on hold</div>
                ) : (
                  onHoldCards.slice(0, visibleCounts.onHold).map(card => {
                    const index = cards.findIndex(c => c.id === card.id);
                    return (
                      <div
                        key={card.id}
                        className={`card-item ${index === currentCardIndex ? 'selected' : ''} on-hold`}
                        onClick={() => selectCard(index)}
                      >
                        <div className="card-item-content">
                          <div className="card-name">
                            #{card.id} {card.name}
                          </div>
                          <button
                            className="btn btn-secondary btn-xs"
                            onClick={(e) => { e.stopPropagation(); removeFromOnHold(card.id); }}
                          >
                            Move to Unmigrated
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

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
                  <h2>Card #{currentCard.id}</h2>
                  <p className="subtitle">{currentCard.name}</p>
                  {returnToCardId && returnToCardId !== currentCard.id && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--primary-light)', marginTop: '0.5rem' }}>
                      📌 You are resolving a dependency for Card #{returnToCardId}
                    </div>
                  )}
                  {isCurrentOnHold && (
                    <div style={{ fontSize: "0.85rem", color: "var(--warning)", marginTop: "0.4rem" }}>
                      On hold for manual review
                    </div>
                  )}
                </div>
                <div className="actions">
                  {preview && (
                    <button onClick={previewCard} className="btn btn-secondary btn-sm" disabled={loading}>
                      Refresh Preview
                    </button>
                  )}
                </div>
              </div>

              {/* Initial Action */}
              {!preview && !isMigrated && !loading && (
                <div className="empty-state">
                  <button onClick={previewCard} className="btn btn-primary btn-lg">
                    Check Card & Preview Migration
                  </button>
                </div>
              )}

              {error && (!preview || preview.status !== 'failed') && (
                <div className="alert alert-error">{error}</div>
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
                                  Go to Dependency Card #{depId}
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
                      <h3>Original (Postgres)</h3>
                      <pre>{JSON.stringify(preview.originalQuery || {}, null, 2)}</pre>
                    </div>
                    <div className="query-box">
                      <h3>Migrated (ClickHouse)</h3>
                      <pre>{preview.migratedQuery ? JSON.stringify(preview.migratedQuery, null, 2) : 'No migration generated'}</pre>
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
                              <div style={{ marginTop: "1rem" }}>
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
                                  Go to Dependency Card #{depId}
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
                    {isMigrated && (
                      <button
                        onClick={() => removeMigratedCard(currentCard.id)}
                        className="btn btn-secondary"
                        disabled={migrating}
                      >
                        Move to Unmigrated
                      </button>
                    )}


                    {!isMigrated && (
                      isCurrentOnHold ? (
                        <button
                          onClick={() => removeFromOnHold(currentCard.id)}
                          className="btn btn-secondary"
                          disabled={migrating}
                        >
                          Move back to Unmigrated
                        </button>
                      ) : (
                        <button
                          onClick={() => addToOnHold(currentCard.id)}
                          className="btn btn-secondary"
                          disabled={migrating}
                        >
                          Put on Hold
                        </button>
                      )
                    )}

                    <button
                      onClick={() => migrateCard(false)}
                      disabled={migrating || preview.status === 'failed'}
                      className="btn btn-success btn-lg"
                    >
                      {migrating ? 'Migrating...' : 'Migrate Card'}
                    </button>

                    {preview.status === 'already_migrated' && (
                      <button onClick={() => migrateCard(true)} className="btn btn-warning">
                        Re-migrate (Overwrite)
                      </button>
                    )}

                    {preview.cardUrl && (
                      <a href={preview.cardUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
                        View in Metabase
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




