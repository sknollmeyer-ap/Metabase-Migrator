import { MetabaseClient } from './services/MetabaseClient';
import { config } from './config';
import fs from 'fs-extra';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface TableMappingWorkflowEntry {
    old_table_id: number;
    suggested_new_table_id: number;
    final_new_table_id?: number | null;
    confirmed?: boolean;
}

interface FieldMatchCandidate {
    id: number;
    name: string;
    display_name?: string;
}

interface FieldDecision {
    old_field_id: number;
    new_field_id: number;
    reason: string;
    score: number;
    method: 'heuristic' | 'ai';
}

const HIGH_CONFIDENCE = 0.9;
const AI_THRESHOLD = 0.75; // Only ask AI if heuristic score is below this

async function main() {
    if (!config.geminiApiKey) {
        throw new Error('Missing GEMINI_API_KEY; cannot run AI field mapping agent.');
    }

    const client = new MetabaseClient();
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    console.log('Fetching database metadata...');
    const [oldMeta, newMeta] = await Promise.all([
        client.getDatabaseMetadata(config.oldDbId),
        client.getDatabaseMetadata(config.newDbId)
    ]);

    const oldTables = oldMeta.tables || [];
    const newTables = newMeta.tables || [];

    const tableMap = buildTableMap(oldTables, newTables);
    console.log(`Table map size: ${Object.keys(tableMap).length}`);

    const decisions: FieldDecision[] = [];

    const newTablesById = new Map<number, any>();
    newTables.forEach((t: any) => newTablesById.set(t.id, t));

    for (const oldTable of oldTables) {
        const targetTableId = tableMap[oldTable.id];
        if (!targetTableId) continue;
        const newTable = newTablesById.get(targetTableId);
        if (!newTable) continue;

        const newFields = (newTable.fields || []).map((f: any) => ({
            id: f.id,
            name: f.name || '',
            display_name: f.display_name || ''
        }));

        for (const oldField of oldTable.fields || []) {
            const heuristic = pickBestField(oldField, newFields);
            if (heuristic && heuristic.score >= HIGH_CONFIDENCE) {
                decisions.push({
                    old_field_id: oldField.id,
                    new_field_id: heuristic.id,
                    reason: heuristic.reason,
                    score: heuristic.score,
                    method: 'heuristic'
                });
                continue;
            }

            // Ask AI if heuristic is weak or missing
            const aiChoice = await askAI(model, oldField, oldTable, newFields);
            if (aiChoice) {
                decisions.push({
                    old_field_id: oldField.id,
                    new_field_id: aiChoice.id,
                    reason: aiChoice.reason,
                    score: aiChoice.score,
                    method: 'ai'
                });
            }
        }
    }

    const overrides: Record<number, number> = {};
    decisions.forEach(d => {
        overrides[d.old_field_id] = d.new_field_id;
    });

    const suggestionsPath = path.resolve(process.cwd(), 'field_mapping_ai_decisions.json');
    const overridesPath = path.resolve(process.cwd(), 'field_mapping_overrides.json');

    // Merge existing overrides to avoid clobbering
    let existingOverrides: Record<number, number> = {};
    if (fs.existsSync(overridesPath)) {
        try {
            existingOverrides = fs.readJsonSync(overridesPath);
        } catch {
            existingOverrides = {};
        }
    }
    Object.assign(existingOverrides, overrides);

    await fs.writeJson(suggestionsPath, decisions, { spaces: 2 });
    await fs.writeJson(overridesPath, existingOverrides, { spaces: 2 });

    console.log(`Saved ${decisions.length} AI/heuristic decisions to ${suggestionsPath}`);
    console.log(`Merged overrides into ${overridesPath} (total: ${Object.keys(existingOverrides).length})`);
    console.log('Restart the server or rerun migration to apply these mappings.');
}

function buildTableMap(oldTables: any[], newTables: any[]): Record<number, number> {
    const tableMap: Record<number, number> = {};

    // Load confirmed mappings from workflow
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

    // Exact schema+name or name-only fallback for anything not mapped
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

function pickBestField(oldField: any, newFields: FieldMatchCandidate[]): { id: number; score: number; reason: string } | null {
    const candidates: { f: FieldMatchCandidate; score: number; reason: string }[] = [];
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
    return { id: best.f.id, score: best.score, reason: best.reason };
}

async function askAI(model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, oldField: any, oldTable: any, newFields: FieldMatchCandidate[]) {
    if (newFields.length === 0) return null;

    const prompt = [
        `We are mapping fields from an old database table to a new database table in Metabase.`,
        `Old table: ${oldTable.schema}.${oldTable.name} (id: ${oldTable.id})`,
        `Old field: ${oldField.name} (display: ${oldField.display_name || 'n/a'}, id: ${oldField.id}, base_type: ${oldField.base_type})`,
        `New table candidates (pick exactly one field id):`,
        ...newFields.map(f => `- ${f.id}: ${f.name} (display: ${f.display_name || 'n/a'})`),
        ``,
        `Respond with a single line: "field_id: <id> | reason: <short reason>".`
    ].join('\n');

    try {
        const result = await model.generateContent(prompt);
        const text = (await result.response.text()).trim();
        const match = text.match(/field_id:\s*(\d+)/i);
        if (match) {
            const chosenId = parseInt(match[1], 10);
            const reason = text.replace(/\s+/g, ' ').slice(0, 300);
            return { id: chosenId, score: AI_THRESHOLD, reason: `AI: ${reason}` };
        }
    } catch (err) {
        console.warn(`AI mapping failed for field ${oldField.id}:`, err);
    }
    return null;
}

main().catch(err => {
    console.error('AI FieldMappingAgent failed:', err);
    process.exit(1);
});
