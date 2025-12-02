import { MetabaseClient } from './services/MetabaseClient';
import { config } from './config';
import fs from 'fs-extra';
import path from 'path';

interface TableMappingWorkflowEntry {
    old_table_id: number;
    suggested_new_table_id: number;
    final_new_table_id?: number | null;
    confirmed?: boolean;
}

interface FieldSuggestion {
    old_field_id: number;
    old_field_name: string;
    old_table_id: number;
    old_table_name: string;
    new_field_id?: number;
    new_field_name?: string;
    new_table_id?: number;
    new_table_name?: string;
    score: number;
    reason: string;
}

/**
 * FieldMappingAgent
 * - Loads confirmed table mappings from table_mapping_workflow.json (or uses exact name matches)
 * - Scans metadata for both databases
 * - Suggests field mappings by name/display-name similarity
 * - Outputs suggestions to field_mapping_suggestions.json and a ready-to-use override file field_mapping_overrides.json
 */
async function main() {
    const client = new MetabaseClient();

    console.log('Fetching database metadata...');
    const [oldMeta, newMeta] = await Promise.all([
        client.getDatabaseMetadata(config.oldDbId),
        client.getDatabaseMetadata(config.newDbId)
    ]);

    const oldTables = oldMeta.tables || [];
    const newTables = newMeta.tables || [];

    const tableMap = buildTableMap(oldTables, newTables);
    console.log(`Table map size: ${Object.keys(tableMap).length}`);

    const suggestions: FieldSuggestion[] = [];
    const overrides: Record<number, number> = {};

    const newTablesById = new Map<number, any>();
    newTables.forEach((t: any) => newTablesById.set(t.id, t));

    for (const oldTable of oldTables) {
        const targetTableId = tableMap[oldTable.id];
        if (!targetTableId) continue;

        const newTable = newTablesById.get(targetTableId);
        if (!newTable) continue;

        const newFields = newTable.fields || [];
        for (const oldField of oldTable.fields || []) {
            const best = pickBestField(oldField, newFields);
            if (best) {
                suggestions.push({
                    old_field_id: oldField.id,
                    old_field_name: oldField.name,
                    old_table_id: oldTable.id,
                    old_table_name: `${oldTable.schema}.${oldTable.name}`,
                    new_field_id: best.id,
                    new_field_name: best.name,
                    new_table_id: newTable.id,
                    new_table_name: `${newTable.schema}.${newTable.name}`,
                    score: best.score,
                    reason: best.reason
                });
                // Only auto-override high-confidence matches
                if (best.score >= 0.9) {
                    overrides[oldField.id] = best.id;
                }
            }
        }
    }

    const suggestionsPath = path.resolve(process.cwd(), 'field_mapping_suggestions.json');
    const overridesPath = path.resolve(process.cwd(), 'field_mapping_overrides.json');

    await fs.writeJson(suggestionsPath, suggestions.sort((a, b) => b.score - a.score), { spaces: 2 });
    await fs.writeJson(overridesPath, overrides, { spaces: 2 });

    console.log(`Saved ${suggestions.length} field suggestions to ${suggestionsPath}`);
    console.log(`Saved ${Object.keys(overrides).length} high-confidence overrides to ${overridesPath}`);
    console.log('Reload the migration or restart the server to pick up the overrides.');
}

function buildTableMap(oldTables: any[], newTables: any[]): Record<number, number> {
    const tableMap: Record<number, number> = {};

    // 1) Load confirmed mappings from workflow
    const workflowPath = path.resolve(process.cwd(), 'table_mapping_workflow.json');
    if (fs.existsSync(workflowPath)) {
        try {
            const mappings: TableMappingWorkflowEntry[] = fs.readJsonSync(workflowPath);
            for (const m of mappings) {
                if (m.confirmed && (m.final_new_table_id || m.suggested_new_table_id)) {
                    tableMap[m.old_table_id] = m.final_new_table_id || m.suggested_new_table_id;
                }
            }
            console.log(`Loaded confirmed table mappings from workflow (${Object.keys(tableMap).length})`);
        } catch (err) {
            console.warn('Failed to load table_mapping_workflow.json:', err);
        }
    }

    // 2) Exact schema+name or name-only fallback for anything not mapped
    const newBySchemaName = new Map<string, any>();
    newTables.forEach((t: any) => newBySchemaName.set(`${t.schema}.${t.name}`, t));
    const newByName = new Map<string, any>();
    newTables.forEach((t: any) => newByName.set(t.name.toLowerCase(), t));

    for (const old of oldTables) {
        if (tableMap[old.id]) continue;
        const exact = newBySchemaName.get(`${old.schema}.${old.name}`);
        if (exact) {
            tableMap[old.id] = exact.id;
            continue;
        }
        const loose = newByName.get(old.name.toLowerCase());
        if (loose) {
            tableMap[old.id] = loose.id;
        }
    }

    return tableMap;
}

function pickBestField(oldField: any, newFields: any[]): { id: number; name: string; score: number; reason: string } | null {
    const candidates: { f: any; score: number; reason: string }[] = [];
    const oldName = (oldField.name || '').toLowerCase();
    const oldDisplay = (oldField.display_name || '').toLowerCase();
    const normalizedOld = oldName.replace(/[\s_]+/g, '');

    for (const f of newFields) {
        const name = (f.name || '').toLowerCase();
        const display = (f.display_name || '').toLowerCase();
        const normalizedNew = name.replace(/[\s_]+/g, '');

        if (name === oldName) {
            candidates.push({ f, score: 1.0, reason: 'exact name match' });
            continue;
        }
        if (display && display === oldDisplay) {
            candidates.push({ f, score: 0.95, reason: 'exact display_name match' });
        }
        if (normalizedNew && normalizedNew === normalizedOld) {
            candidates.push({ f, score: 0.92, reason: 'normalized name match' });
        }
        if (name.includes(oldName) || oldName.includes(name)) {
            candidates.push({ f, score: 0.75, reason: 'partial name overlap' });
        }
    }

    if (candidates.length === 0) return null;
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    return { id: best.f.id, name: best.f.name, score: best.score, reason: best.reason };
}

main().catch(err => {
    console.error('FieldMappingAgent failed:', err);
    process.exit(1);
});
