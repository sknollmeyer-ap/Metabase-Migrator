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
                    disabled={loading}
                >
                    <option value="" disabled>{loading ? 'Loading...' : 'Select target field...'}</option>
                    {candidates.map(f => (
                        <option key={f.id} value={f.id}>
                            {f.name} ({f.base_type})
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
};
