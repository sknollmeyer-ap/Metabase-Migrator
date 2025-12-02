import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { MetadataMapper } from './MetadataMapper';

export interface FieldDecision {
    old_field_id: number;
    new_field_id: number;
    reason: string;
    score: number;
    method: 'heuristic' | 'ai';
}

export class FieldMapperAgent {
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
    private mapper: MetadataMapper;

    constructor(mapper: MetadataMapper) {
        this.mapper = mapper;
        if (!config.geminiApiKey) {
            throw new Error('Missing GEMINI_API_KEY for FieldMapperAgent');
        }
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        this.model = genAI.getGenerativeModel({ model: config.geminiModel || 'gemini-2.0-flash' });
    }

    async suggestMapping(oldFieldId: number): Promise<FieldDecision | null> {
        const oldField = this.mapper.getFieldInfo(oldFieldId);
        if (!oldField) {
            console.warn(`FieldMapperAgent: No info found for old field ${oldFieldId}`);
            return null;
        }

        const candidates = this.mapper.getFieldCandidates(oldFieldId);
        if (candidates.length === 0) {
            console.warn(`FieldMapperAgent: No candidates found for old field ${oldFieldId}`);
            return null;
        }

        // 1. Try heuristic first (fast path)
        const heuristic = this.pickBestFieldHeuristic(oldField, candidates);
        if (heuristic && heuristic.score >= 0.9) {
            return {
                old_field_id: oldFieldId,
                new_field_id: heuristic.id,
                reason: heuristic.reason,
                score: heuristic.score,
                method: 'heuristic'
            };
        }

        // 2. Ask AI
        return await this.askAI(oldFieldId, oldField, candidates);
    }

    private pickBestFieldHeuristic(oldField: any, newFields: any[]): { id: number; score: number; reason: string } | null {
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
        return { id: best.f.id, score: best.score, reason: best.reason };
    }

    private async askAI(oldFieldId: number, oldField: any, newFields: any[]): Promise<FieldDecision | null> {
        const prompt = [
            `We are mapping fields from an old database table to a new database table in Metabase.`,
            `Old table: ${oldField.table}`,
            `Old field: ${oldField.name} (display: ${oldField.display_name || 'n/a'}, id: ${oldFieldId}, base_type: ${oldField.base_type || 'unknown'})`,
            `New table candidates (pick exactly one field id):`,
            ...newFields.map(f => `- ${f.id}: ${f.name} (display: ${f.display_name || 'n/a'})`),
            ``,
            `Respond with a single line: "field_id: <id> | reason: <short reason>".`
        ].join('\n');

        try {
            const result = await this.model.generateContent(prompt);
            const text = (await result.response.text()).trim();
            const match = text.match(/field_id:\s*(\d+)/i);

            if (match) {
                const chosenId = parseInt(match[1], 10);
                const reason = text.replace(/field_id:\s*\d+\s*\|\s*reason:\s*/i, '').trim();

                // Verify the chosen ID is in candidates
                const candidate = newFields.find(f => f.id === chosenId);
                if (!candidate) {
                    console.warn(`AI chose invalid field ID ${chosenId}`);
                    return null;
                }

                return {
                    old_field_id: oldFieldId,
                    new_field_id: chosenId,
                    reason: `AI: ${reason}`,
                    score: 0.8, // AI confidence
                    method: 'ai'
                };
            }
        } catch (err) {
            console.warn(`AI mapping failed for field ${oldFieldId}:`, err);
        }
        return null;
    }
}
