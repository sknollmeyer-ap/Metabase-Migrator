import { MetadataMapper } from './MetadataMapper';
import { config } from '../config';
import { UnmatchedTable, UnmatchedField } from '../types';

export interface MigrationResult {
    query: any;
    warnings: string[];
    unmatchedTables: UnmatchedTable[];
    unmatchedFields: UnmatchedField[];
}

export class MbqlMigrator {
    private mapper: MetadataMapper;
    private warnings: string[] = [];
    private unmatchedTables: UnmatchedTable[] = [];
    private unmatchedFields: UnmatchedField[] = [];
    private cardIdMap: Map<number, number>;

    constructor(mapper: MetadataMapper, cardIdMap: Map<number, number> = new Map()) {
        this.mapper = mapper;
        this.cardIdMap = cardIdMap;
    }

    setCardIdMap(cardIdMap: Map<number, number>) {
        this.cardIdMap = cardIdMap;
    }

    migrateQuery(query: any): MigrationResult {
        this.warnings = [];
        this.unmatchedTables = [];
        this.unmatchedFields = [];

        if (!query) return { query, warnings: [], unmatchedTables: [], unmatchedFields: [] };

        // Deep copy to avoid mutating original
        const newQuery = JSON.parse(JSON.stringify(query));

        // Update database ID
        if (newQuery.database === config.oldDbId) {
            newQuery.database = config.newDbId;
        }

        if (newQuery.query) {
            newQuery.query = this.migrateInnerQuery(newQuery.query);
        }

        return {
            query: newQuery,
            warnings: this.warnings,
            unmatchedTables: this.unmatchedTables,
            unmatchedFields: this.unmatchedFields
        };
    }

    private migrateInnerQuery(innerQuery: any): any {
        if (!innerQuery) return innerQuery;

        // 1. Migrate source-table
        if (innerQuery['source-table']) {
            const oldId = innerQuery['source-table'];
            if (typeof oldId === 'number') {
                const newId = this.mapper.getNewTableId(oldId);
                if (newId) {
                    innerQuery['source-table'] = newId;
                } else {
                    const msg = `Warning: Could not map table ID ${oldId}`;
                    console.warn(msg);
                    this.warnings.push(msg);

                    // Add to unmatched tables if not already present
                    if (!this.unmatchedTables.find(t => t.sourceTableId === oldId)) {
                        const knownMissing = this.mapper.missingTables.find(t => t.sourceTableId === oldId);
                        if (knownMissing) {
                            this.unmatchedTables.push(knownMissing);
                        } else {
                            this.unmatchedTables.push({
                                sourceTableId: oldId,
                                sourceTableName: `Table ${oldId}`,
                                schema: 'public'
                            });
                        }
                    }
                }
            } else if (typeof oldId === 'string' && oldId.startsWith('card__')) {
                // Handle nested card references
                const oldCardId = parseInt(oldId.replace('card__', ''), 10);
                const newCardId = this.cardIdMap.get(oldCardId);
                if (newCardId) {
                    innerQuery['source-table'] = `card__${newCardId}`;
                    console.log(`Remapped ${oldId} to card__${newCardId}`);
                } else {
                    const msg = `Warning: Could not map nested card ID ${oldCardId}`;
                    console.warn(msg);
                    this.warnings.push(msg);
                }
            }
        }

        // 2. Migrate joins
        if (innerQuery.joins && Array.isArray(innerQuery.joins)) {
            innerQuery.joins = innerQuery.joins.map((join: any) => this.migrateInnerQuery(join));
        }

        // 3. Migrate filters, aggregations, breakouts, order-by
        const keysToMigrate = ['filter', 'aggregation', 'breakout', 'order-by', 'fields', 'condition'];

        for (const key of keysToMigrate) {
            if (innerQuery[key]) {
                innerQuery[key] = this.migrateClause(innerQuery[key]);
            }
        }

        return innerQuery;
    }

    private migrateClause(clause: any): any {
        if (!Array.isArray(clause)) return clause;
        if (clause.length === 0) return clause;

        const op = clause[0];

        // Handle field reference
        if (op === 'field' || op === 'field-id') {
            const fieldId = clause[1];
            if (typeof fieldId === 'number') {
                const newId = this.mapper.getNewFieldId(fieldId);
                if (newId) {
                    clause[1] = newId;
                } else {
                    const info = this.mapper.getFieldInfo(fieldId);
                    const label = info ? `${info.table}.${info.name}` : `field ID ${fieldId}`;
                    const msg = `Warning: Could not map ${label} (id ${fieldId})`;
                    console.warn(msg);
                    this.warnings.push(msg);

                    if (!this.unmatchedFields.find(f => f.sourceFieldId === fieldId)) {
                        this.unmatchedFields.push({
                            sourceFieldId: fieldId,
                            sourceFieldName: info?.name || `Field ${fieldId}`,
                            sourceTableName: info?.table || 'Unknown Table',
                            sourceTableId: 0
                        });
                    }
                }
            }
            // Handle options if present (e.g. source-field for joins)
            if (clause.length > 2 && clause[2] && typeof clause[2] === 'object') {
                const options = clause[2];
                if (options['source-field']) {
                    const sourceFieldId = options['source-field'];
                    if (typeof sourceFieldId === 'number') {
                        const newSourceId = this.mapper.getNewFieldId(sourceFieldId);
                        if (newSourceId) {
                            options['source-field'] = newSourceId;
                        } else {
                            const info = this.mapper.getFieldInfo(sourceFieldId);
                            const label = info ? `${info.table}.${info.name}` : `field ID ${sourceFieldId}`;
                            const msg = `Warning: Could not map source-field ${label} (id ${sourceFieldId})`;
                            console.warn(msg);
                            this.warnings.push(msg);

                            if (!this.unmatchedFields.find(f => f.sourceFieldId === sourceFieldId)) {
                                this.unmatchedFields.push({
                                    sourceFieldId: sourceFieldId,
                                    sourceFieldName: info?.name || `Field ${sourceFieldId}`,
                                    sourceTableName: info?.table || 'Unknown Table',
                                    sourceTableId: 0
                                });
                            }
                        }
                    }
                }
            }
            return clause;
        }

        // Recursively handle arguments
        return clause.map((item: any) => {
            if (Array.isArray(item)) {
                return this.migrateClause(item);
            }
            return item;
        });
    }
}
