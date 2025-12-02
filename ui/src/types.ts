export interface UnmatchedTable {
    sourceTableId: number;
    sourceTableName: string;
    schema: string;
}

export interface UnmatchedField {
    sourceFieldId: number;
    sourceFieldName: string;
    sourceTableName: string;
    sourceTableId: number;
}

export interface MigrationResponse {
    status: 'ok' | 'failed' | 'already_migrated';
    oldId?: number;
    cardName?: string;
    errorCode?: string;
    message?: string;
    details?: any;
    originalQuery?: any;
    migratedQuery?: any;
    unmatchedTables?: UnmatchedTable[];
    unmatchedFields?: UnmatchedField[];
    newId?: number;
    cardUrl?: string;
    warnings?: string[];
    errors?: string[];
}

export interface TableMetadata {
    id: number;
    name: string;
    schema: string;
    display_name?: string;
}

export interface FieldMetadata {
    id: number;
    name: string;
    display_name?: string;
    base_type: string;
    table_id: number;
}
