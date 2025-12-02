import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';

/**
 * Translates Postgres SQL to ClickHouse SQL using Gemini.
 */
export class SqlMigrator {
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

    constructor() {
        if (!config.geminiApiKey) {
            throw new Error('Missing GEMINI_API_KEY for SQL translation');
        }

        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        // Default to a newer, widely available model; override via GEMINI_MODEL env if needed.
        const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        this.model = genAI.getGenerativeModel({ model: modelName });
    }

    async translateSql(originalSql: string, context: string): Promise<string> {
        const prompt = `
You are converting a Metabase SQL question from PostgreSQL to ClickHouse.

Original PostgreSQL Query:
${originalSql}

Context (schema/table mappings and any notes):
${context}

Instructions:
1) Translate the SQL to valid ClickHouse dialect.
2) Preserve semantics and parameter names (e.g. {{param}}).
3) Adjust for ClickHouse differences (date/time, casts, LIMIT/OFFSET, array handling, boolean literals).
4) Return ONLY the translated SQL (no markdown or explanations).
5) If translation is impossible due to missing tables/features, return: ERROR: <reason>.
        `.trim();

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            let text = response.text();
            // Strip any code fences the model might return
            text = text.replace(/```sql/gi, '').replace(/```/g, '').trim();
            return text;
        } catch (error: any) {
            const message = error?.message || String(error);
            throw new Error(`[GoogleGenerativeAI Error]: ${message}`);
        }
    }
}
