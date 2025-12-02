import { MetabaseClient } from './MetabaseClient';
import { config } from '../config';
import { storage } from './StorageService';
import { UnmatchedTable, UnmatchedField, FieldMetadata } from '../types';

interface TableMap {
    [oldId: number]: number;
}

interface FieldMap {
    [oldId: number]: number;
}

interface FieldInfo {
    name: string;
    display_name?: string;
    table: string;
    base_type?: string;
}

export class MetadataMapper {
    private client: MetabaseClient;
    public tableMap: TableMap = {};
    public fieldMap: FieldMap = {};
    public missingTables: UnmatchedTable[] = [];
    public missingFields: UnmatchedField[] = [];
    private fieldInfo: Record<number, FieldInfo> = {};
    private newTablesById: Map<number, any> = new Map();
    private oldFieldTargetTable: Record<number, number | undefined> = {};
    private fieldCandidates: Record<number, Array<{ id: number; name: string; display_name?: string }>> = {};

    constructor(client: MetabaseClient) {
        this.client = client;
    }

    async buildMaps() {
        console.log('Fetching metadata...');
        const tables = await this.client.getTables();

        const oldTables = tables.filter((t: any) => t.db_id === config.oldDbId);
        const newTables = tables.filter((t: any) => t.db_id === config.newDbId);

        console.log(`Found ${oldTables.length} tables in old DB and ${newTables.length} tables in new DB.`);

        // Clear previous missing items
        this.missingTables = [];
        this.missingFields = [];

        // 1) Use confirmed table mappings from workflow if available
        await this.loadTableMappingsFromWorkflow();

        // 2) Fallback to exact/loose name matches for any tables not mapped yet
        for (const oldTable of oldTables) {
            if (this.tableMap[oldTable.id]) continue;

            let match = newTables.find((t: any) =>
                t.schema === oldTable.schema && t.name === oldTable.name
            );

            if (!match) {
                // Try loose matching by name only
                const potentialMatches = newTables.filter((t: any) => t.name === oldTable.name);
                if (potentialMatches.length === 1) {
                    match = potentialMatches[0];
                    console.log(`Loose match found for ${oldTable.schema}.${oldTable.name} -> ${match.schema}.${match.name}`);
                }
            }

            if (match) {
                this.tableMap[oldTable.id] = match.id;
            } else {
                this.missingTables.push({
                    sourceTableId: oldTable.id,
                    sourceTableName: oldTable.name,
                    schema: oldTable.schema
                });
            }
        }

        // Fetch full metadata to get fields
        console.log('Fetching field metadata...');
        const oldDbMetadata = await this.client.getDatabaseMetadata(config.oldDbId);
        const newDbMetadata = await this.client.getDatabaseMetadata(config.newDbId);

        const oldDbTables = oldDbMetadata.tables || [];
        const newDbTables = newDbMetadata.tables || [];
        this.newTablesById = new Map<number, any>();
        newDbTables.forEach((t: any) => this.newTablesById.set(t.id, t));

        for (const oldTable of oldDbTables) {
            const newTableId = this.tableMap[oldTable.id];
            const oldTableName = `${oldTable.schema}.${oldTable.name}`;

            // Always record field info so warnings can include names even if the table is not mapped
            for (const oldField of oldTable.fields || []) {
                this.fieldInfo[oldField.id] = {
                    name: oldField.name,
                    display_name: oldField.display_name,
                    table: oldTableName,
                    base_type: oldField.base_type
                };
            }

            if (!newTableId) continue;

            const newTable = newDbTables.find((t: any) => t.id === newTableId);
            if (!newTable) continue;

            const newFieldsByName = new Map<string, any>();
            newTable.fields.forEach((f: any) => newFieldsByName.set((f.name || '').toLowerCase(), f));
            const newFieldsByDisplay = new Map<string, any>();
            newTable.fields.forEach((f: any) => {
                if (f.display_name) {
                    newFieldsByDisplay.set(f.display_name.toLowerCase(), f);
                }
            });

            for (const oldField of oldTable.fields || []) {
                const nameKey = (oldField.name || '').toLowerCase();
                const displayKey = (oldField.display_name || '').toLowerCase();
                let match: any | undefined;

                if (newFieldsByName.has(nameKey)) {
                    match = newFieldsByName.get(nameKey);
                } else if (displayKey && newFieldsByDisplay.has(displayKey)) {
                    match = newFieldsByDisplay.get(displayKey);
                } else {
                    // try underscore/space insensitive
                    const normalized = nameKey.replace(/[\s_]+/g, '');
                    match = newTable.fields.find((f: any) => (f.name || '').toLowerCase().replace(/[\s_]+/g, '') === normalized);
                }

                if (match) {
                    this.fieldMap[oldField.id] = match.id;
                    this.oldFieldTargetTable[oldField.id] = newTable.id;
                } else {
                    this.missingFields.push({
                        sourceFieldId: oldField.id,
                        sourceFieldName: oldField.name,
                        sourceTableName: oldTableName,
                        sourceTableId: oldTable.id
                    });
                }

                // Store candidates for UI selection
                this.fieldCandidates[oldField.id] = (newTable.fields || []).map((f: any) => ({
                    id: f.id,
                    name: f.name,
                    display_name: f.display_name
                }));
            }
        }

        // 3) Apply manual/agent overrides if present
        await this.loadFieldOverrides();

        console.log(`Mapped ${Object.keys(this.tableMap).length} tables and ${Object.keys(this.fieldMap).length} fields.`);
    }

    private async loadTableMappingsFromWorkflow() {
        try {
            const mappings = await storage.getTableMappings();
            let applied = 0;
            for (const m of mappings) {
                if (m.confirmed && (m.final_new_table_id || m.suggested_new_table_id)) {
                    const targetId = m.final_new_table_id || m.suggested_new_table_id;
                    this.tableMap[m.old_table_id] = targetId;
                    applied++;
                }
            }
            if (applied > 0) {
                console.log(`Loaded ${applied} confirmed table mappings from storage`);
            }
        } catch (err) {
            console.warn('Failed to load table mappings:', err);
        }
    }

    private async loadFieldOverrides() {
        try {
            const mappings = await storage.getFieldMappings();
            let applied = 0;
            for (const m of mappings) {
                if (m.confirmed && m.suggested_new_field_id) {
                    this.fieldMap[m.old_field_id] = m.suggested_new_field_id;
                    applied++;
                }
            }
            if (applied > 0) {
                console.log(`Applied ${applied} field overrides from storage`);
            }
        } catch (err) {
            console.warn('Failed to load field mappings:', err);
        }
    }

    getNewTableId(oldId: number): number | undefined {
        return this.tableMap[oldId];
    }

    getNewFieldId(oldId: number): number | undefined {
        return this.fieldMap[oldId];
    }

    getFieldInfo(oldId: number): FieldInfo | undefined {
        return this.fieldInfo[oldId];
    }

    async setTableMapping(oldTableId: number, newTableId: number) {
        this.tableMap[oldTableId] = newTableId;

        // Remove from missing tables if present
        this.missingTables = this.missingTables.filter(t => t.sourceTableId !== oldTableId);

        await storage.saveTableMappings([{
            old_table_id: oldTableId,
            old_table_name: 'Unknown', // We should look this up if possible
            suggested_new_table_id: newTableId,
            suggested_new_table_name: 'Manual Override',
            confidence: 1.0,
            mapping_type: 'manual',
            confirmed: true
        }]);
    }

    async setFieldOverride(oldId: number, newId: number) {
        this.fieldMap[oldId] = newId;

        // Remove from missing fields if present
        this.missingFields = this.missingFields.filter(f => f.sourceFieldId !== oldId);

        try {
            const fieldInfo = this.fieldInfo[oldId];

            await storage.saveFieldMappings([{
                old_field_id: oldId,
                old_field_name: fieldInfo?.name || 'Unknown',
                old_table_id: 0,
                suggested_new_field_id: newId,
                suggested_new_field_name: 'Manual Override',
                new_table_id: 0,
                confidence: 1.0,
                mapping_type: 'manual',
                confirmed: true
            }]);
        } catch (error) {
            console.error('Failed to save field override:', error);
        }
    }

    getFieldCandidates(oldFieldId: number): Array<{ id: number; name: string; display_name?: string }> {
        return this.fieldCandidates[oldFieldId] || [];
    }

    getUnmappedTables(): UnmatchedTable[] {
        return this.missingTables;
    }

    getUnmappedFields(): UnmatchedField[] {
        return this.missingFields;
    }
}
