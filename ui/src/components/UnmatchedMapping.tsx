import React, { useState, useEffect } from 'react';
import type { UnmatchedTable, UnmatchedField, TableMetadata, FieldMetadata } from '../types';

interface Props {
    unmatchedTables: UnmatchedTable[];
    unmatchedFields: UnmatchedField[];
    onMappingUpdated: () => void;
    targetDbId: number;
}

export const UnmatchedMapping: React.FC<Props> = ({ unmatchedTables, unmatchedFields, onMappingUpdated, targetDbId }) => {
    const [targetTables, setTargetTables] = useState<TableMetadata[]>([]);

    // Load target tables on mount
    useEffect(() => {
        const loadTables = async () => {
            try {
                const res = await fetch(`/api/metadata/tables?databaseId=${targetDbId}`);
                if (res.ok) {
                    const data = await res.json();
                    setTargetTables(data);
                }
            } catch (err) {
                console.error('Failed to load target tables', err);
            }
        };
        loadTables();
    }, [targetDbId]);

    const handleTableMap = async (sourceTableId: number, targetTableId: number) => {
        try {
            await fetch('/api/mappings/table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceTableId, targetTableId })
            });
            onMappingUpdated();
        } catch (err) {
            console.error('Failed to map table', err);
            alert('Failed to save mapping');
        }
    };

    return (
        <div className="mapping-container fade-in">
            <h3 style={{ color: 'var(--warning)', marginBottom: '1rem' }}>⚠️ Missing Mappings</h3>

            {unmatchedTables.length > 0 && (
                <div className="mapping-section">
                    <h4>Unmapped Tables</h4>
                    <div className="mapping-list">
                        {unmatchedTables.map(table => (
                            <div key={table.sourceTableId} className="mapping-item">
                                <div className="source-label">
                                    <span className="type-badge">Table</span>
                                    {table.schema}.{table.sourceTableName}
                                </div>
                                <div className="arrow">→</div>
                                <div className="target-select">
                                    <select
                                        onChange={(e) => handleTableMap(table.sourceTableId, parseInt(e.target.value))}
                                        defaultValue=""
                                    >
                                        <option value="" disabled>Select target table...</option>
                                        {targetTables.map(t => (
                                            <option key={t.id} value={t.id}>
                                                {t.schema}.{t.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {unmatchedFields.length > 0 && (
                <div className="mapping-section" style={{ marginTop: '1.5rem' }}>
                    <h4>Unmapped Fields</h4>
                    <div className="mapping-list">
                        {unmatchedFields.map(field => (
                            <FieldMapper
                                key={field.sourceFieldId}
                                field={field}
                                onMap={onMappingUpdated}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const FieldMapper: React.FC<{ field: UnmatchedField, onMap: () => void }> = ({ field, onMap }) => {
    const [candidates, setCandidates] = useState<FieldMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiNote, setAiNote] = useState<string | null>(null);

    useEffect(() => {
        const loadCandidates = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/field-candidates/${field.sourceFieldId}`);
                if (res.ok) {
                    const data = await res.json();
                    setCandidates(data);
                }
            } catch (err) {
                console.error('Failed to load field candidates', err);
            } finally {
                setLoading(false);
            }
        };
        loadCandidates();
    }, [field.sourceFieldId]);

    const handleMap = async (targetFieldId: number) => {
        try {
            await fetch('/api/mappings/field', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceFieldId: field.sourceFieldId, targetFieldId })
            });
            onMap();
        } catch (err) {
            console.error('Failed to map field', err);
        }
    };

    const handleAISuggest = async () => {
        setAiLoading(true);
        setAiNote(null);
        try {
            const res = await fetch('/api/suggest-field-mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_field_id: field.sourceFieldId })
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'AI suggestion failed');
            }
            const suggestion = await res.json();
            if (suggestion?.new_field_id) {
                const reason = suggestion.reason ? ` (${suggestion.reason})` : '';
                setAiNote(`AI picked field ${suggestion.new_field_id}${reason}`);
                await handleMap(suggestion.new_field_id);
            } else {
                setAiNote('No AI suggestion available.');
            }
        } catch (err: any) {
            console.error('AI suggestion failed', err);
            setAiNote('AI suggestion failed. See console for details.');
        } finally {
            setAiLoading(false);
        }
    };

    return (
        <div className="mapping-item">
            <div className="source-label">
                <span className="type-badge">Field</span>
                {field.sourceTableName}.{field.sourceFieldName}
            </div>
            <div className="arrow">→</div>
            <div className="target-select">
                <select
                    onChange={(e) => handleMap(parseInt(e.target.value))}
                    defaultValue=""
                    disabled={loading || aiLoading}
                >
                    <option value="" disabled>{loading ? 'Loading...' : 'Select target field...'}</option>
                    {candidates.map(f => (
                        <option key={f.id} value={f.id}>
                            {f.name} ({f.base_type})
                        </option>
                    ))}
                </select>
                <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: '0.5rem' }}
                    onClick={handleAISuggest}
                    disabled={aiLoading || loading}
                >
                    {aiLoading ? 'Asking AI...' : 'AI Suggest'}
                </button>
                {aiNote && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {aiNote}
                    </div>
                )}
            </div>
        </div>
    );
};
