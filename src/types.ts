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

export enum MigrationErrorCode {
    MISSING_MAPPING_TABLE = 'MISSING_MAPPING_TABLE',
    MISSING_MAPPING_FIELD = 'MISSING_MAPPING_FIELD',
    MISSING_TARGET_TABLE = 'MISSING_TARGET_TABLE',
    DEPENDENCY_NOT_MIGRATED = 'DEPENDENCY_NOT_MIGRATED',
    SQL_TRANSLATION_ERROR = 'SQL_TRANSLATION_ERROR',
    METABASE_API_ERROR = 'METABASE_API_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export type CardStatus = 'unmigrated' | 'ready' | 'on_hold' | 'migrated' | 'failed';
export type NativeSqlStatus = 'ok' | 'needs_manual_review' | 'unsupported';

export interface MigrationResponse {
    status: 'ok' | 'failed' | 'already_migrated';
    oldId?: number;
    cardName?: string;
    errorCode?: MigrationErrorCode;
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
    isNativeSql?: boolean;
    autoFixApplied?: boolean;
    nativeSqlStatus?: NativeSqlStatus;
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
