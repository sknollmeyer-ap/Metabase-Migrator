
import React, { useState, useEffect } from 'react';

interface DependencyItem {
    id: number;
    name: string;
    type: string;
    dependentCount: number;
}

export const DependencyResolver: React.FC = () => {
    const [dependencies, setDependencies] = useState<DependencyItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mappingInputs, setMappingInputs] = useState<Record<number, string>>({});
    const [resolving, setResolving] = useState<number | null>(null);

    const fetchDependencies = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/dependencies');
            if (res.ok) {
                const data = await res.json();
                setDependencies(data);
            } else {
                setError('Failed to load dependencies');
            }
        } catch (err) {
            setError('Error fetching dependencies');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDependencies();
    }, []);

    const handleResolve = async (oldCardId: number) => {
        const newCardIdStr = mappingInputs[oldCardId];
        if (!newCardIdStr) return;

        const newCardId = parseInt(newCardIdStr, 10);
        if (isNaN(newCardId)) return;

        setResolving(oldCardId);
        try {
            const res = await fetch('/api/resolve-dependency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldCardId, newCardId })
            });

            if (res.ok) {
                const data = await res.json();
                alert(`Successfully mapped! Released ${data.releasedCount} dependent cards.`);
                // Refresh list
                fetchDependencies();
                // Clear input
                setMappingInputs(prev => {
                    const next = { ...prev };
                    delete next[oldCardId];
                    return next;
                });
            } else {
                alert('Failed to resolve dependency');
            }
        } catch (err) {
            console.error(err);
            alert('Error resolving dependency');
        } finally {
            setResolving(null);
        }
    };

    return (
        <div className="glass-card fade-in" style={{ padding: '1.5rem' }}>
            <h2 style={{ marginBottom: '1rem' }}>🔗 Dependency Resolver</h2>
            <p style={{ marginBottom: '1.5rem', opacity: 0.8 }}>
                Map legacy cards (e.g., native SQL) to existing ClickHouse cards to unblock their dependents.
            </p>

            {loading && <div className="spinner"></div>}

            {error && <div className="alert alert-error">{error}</div>}

            {!loading && dependencies.length === 0 && (
                <div className="empty-state">No high-dependency cards found.</div>
            )}

            {!loading && dependencies.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ padding: '0.75rem' }}>Count</th>
                                <th style={{ padding: '0.75rem' }}>Legacy Card</th>
                                <th style={{ padding: '0.75rem' }}>Type</th>
                                <th style={{ padding: '0.75rem' }}>Map to New ID</th>
                                <th style={{ padding: '0.75rem' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dependencies.map(item => (
                                <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '0.75rem', fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--primary)' }}>
                                        {item.dependentCount}
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <div style={{ fontWeight: 500 }}>{item.name}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>ID: {item.id}</div>
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <span className="type-badge">{item.type}</span>
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <input
                                            type="number"
                                            placeholder="New Card ID..."
                                            className="input-field"
                                            style={{ width: '120px' }}
                                            value={mappingInputs[item.id] || ''}
                                            onChange={(e) => setMappingInputs({
                                                ...mappingInputs,
                                                [item.id]: e.target.value
                                            })}
                                        />
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <button
                                            className="btn btn-success btn-sm"
                                            disabled={resolving === item.id || !mappingInputs[item.id]}
                                            onClick={() => handleResolve(item.id)}
                                        >
                                            {resolving === item.id ? 'Saving...' : 'Resolve'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
