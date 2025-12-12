
import React, { useState, useEffect } from 'react';
import type { TableMetadata } from '../types';



export const TableMapper: React.FC = () => {
    const [sourceTables, setSourceTables] = useState<TableMetadata[]>([]);
    const [targetTables, setTargetTables] = useState<TableMetadata[]>([]);
    const [mappings, setMappings] = useState<Record<number, number>>({});
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState<number | null>(null);

    const oldDbId = 6;
    const targetDbId = 10;

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch Source Tables
                const srcRes = await fetch(`/api/metadata/tables?databaseId=${oldDbId}`);
                const srcData = await srcRes.json();
                setSourceTables(srcData);

                // Fetch Target Tables
                const tgtRes = await fetch(`/api/metadata/tables?databaseId=${targetDbId}`);
                const tgtData = await tgtRes.json();
                setTargetTables(tgtData);

                // Fetch Existing Mappings
                // We need an endpoint for this, or we can assume we check what's mapped.
                // Assuming we can get current state from server or just rely on 'unmatched'.
                // But for a full mapper, we want to know what IS mapped.
                // For now, let's just allow setting. 
                // Wait, if we don't show existing mappings, it's dangerous.
                // MigrationManager exposes tableMap. server.ts needs to expose it.
                // Let's add GET /api/mappings/all-tables
                const mapRes = await fetch('/api/mappings/table'); // Existing endpoint? check server.ts
                if (mapRes.ok) {
                    const mapData = await mapRes.json();
                    // mapData is array of TableMapping
                    const mapObj: Record<number, number> = {};
                    mapData.forEach((m: any) => {
                        if (m.confirmed && (m.final_new_table_id || m.suggested_new_table_id)) {
                            mapObj[m.old_table_id] = m.final_new_table_id || m.suggested_new_table_id;
                        }
                    });
                    setMappings(mapObj);
                }

            } catch (err) {
                console.error('Failed to load tables', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleMap = async (sourceId: number, targetId: number) => {
        setSaving(sourceId);
        try {
            await fetch('/api/mappings/table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceTableId: sourceId, targetTableId: targetId })
            });
            setMappings(prev => ({ ...prev, [sourceId]: targetId }));
        } catch (err) {
            console.error('Failed to save mapping', err);
            alert('Failed to save mapping');
        } finally {
            setSaving(null);
        }
    };

    const sortedSourceTables = [...sourceTables].sort((a, b) =>
        (a.schema + a.name).localeCompare(b.schema + b.name)
    );

    const sortedTargetTables = [...targetTables].sort((a, b) =>
        (a.schema + a.name).localeCompare(b.schema + b.name)
    );

    const filteredTables = sortedSourceTables.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.schema.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="glass-card fade-in" style={{ padding: '1.5rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h2>🗂️ Global Table Mapping</h2>
                <input
                    type="text"
                    placeholder="Search source tables..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input"
                    style={{ width: '300px' }}
                />
            </div>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Map tables from PostgreSQL (DB 6) to ClickHouse (DB 10). Mappings here affect all migrations.
            </p>

            {loading ? (
                <div>Loading schema...</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Source Table (Postgres)</div>
                    <div></div>
                    <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Target Table (ClickHouse)</div>

                    {filteredTables.map(t => (
                        <React.Fragment key={t.id}>
                            <div className="mapping-row-source">
                                <span className="schema-badge">{t.schema}</span>
                                <span className="table-name">{t.name}</span>
                                <span className="id-badge">#{t.id}</span>
                            </div>
                            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>→</div>
                            <div>
                                <select
                                    className="select full-width"
                                    value={mappings[t.id] || ''}
                                    onChange={(e) => handleMap(t.id, parseInt(e.target.value))}
                                    disabled={saving === t.id}
                                    style={{
                                        backgroundColor: mappings[t.id] ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                                        borderColor: mappings[t.id] ? 'var(--primary)' : 'var(--border)'
                                    }}
                                >
                                    <option value="">-- Unmapped --</option>
                                    {sortedTargetTables.map(target => (
                                        <option key={target.id} value={target.id}>
                                            {target.schema}.{target.name}
                                        </option>
                                    ))}
                                </select>
                                {saving === t.id && <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>💾</span>}
                            </div>
                        </React.Fragment>
                    ))}
                </div>
            )}

            <style>{`
                .schema-badge {
                    background: var(--bg-tertiary);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 0.75rem;
                    margin-right: 0.5rem;
                    color: var(--text-secondary);
                }
                .id-badge {
                    color: var(--text-tertiary);
                    font-size: 0.75rem;
                    margin-left: 0.5rem;
                }
                .mapping-row-source {
                    display: flex;
                    align-items: center;
                    padding: 0.5rem 0;
                }
            `}</style>
        </div>
    );
};
