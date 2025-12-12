import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { storage } from './StorageService';
import { MetadataMapper } from './MetadataMapper';
import crypto from 'crypto';

export class SqlMigrator {
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | undefined;
    private mapper: MetadataMapper | null = null; // Optional, set later or in constructor

    constructor(mapper?: MetadataMapper) {
        if (!config.geminiApiKey) {
            console.warn('Missing GEMINI_API_KEY. AI SQL translation will be disabled.');
        } else {
            const genAI = new GoogleGenerativeAI(config.geminiApiKey);
            const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';
            this.model = genAI.getGenerativeModel({ model: modelName });
        }
        if (mapper) this.mapper = mapper;
    }

    setMapper(mapper: MetadataMapper) {
        this.mapper = mapper;
    }

    /**
     * Applies heuristic regex-based transforms from Postgres to ClickHouse.
     */
    applyTransforms(sql: string): string {
        let transformed = sql;

        // 1. Basic Type Casts
        transformed = transformed.replace(/::date/gi, '::Date');
        transformed = transformed.replace(/::timestamp/gi, '::DateTime');
        transformed = transformed.replace(/::int/gi, '::Int32');
        transformed = transformed.replace(/::float/gi, '::Float64');
        transformed = transformed.replace(/::text/gi, '::String');

        // 2. Date Truncation
        transformed = transformed.replace(/date_trunc\('day',\s*([^\)]+)\)/gi, 'toStartOfDay($1)');
        transformed = transformed.replace(/date_trunc\('month',\s*([^\)]+)\)/gi, 'toStartOfMonth($1)');
        transformed = transformed.replace(/date_trunc\('year',\s*([^\)]+)\)/gi, 'toStartOfYear($1)');
        // Week is tricky, ClickHouse defaults to Sunday, Postgres might be Monday. Assuming standard ISO or Monday.
        transformed = transformed.replace(/date_trunc\('week',\s*([^\)]+)\)/gi, 'toStartOfWeek($1, 3)');

        // 3. String Functions
        transformed = transformed.replace(/split_part\(/gi, 'splitByChar('); // Approximation, check args

        // 4. JSON operators (basic attempt)
        // src->'key' => visitParamExtractRaw(src, 'key') ??? Too complex for regex

        // 5. Schema replacement (Global Search/Replace based on table_mapping_workflow)
        if (this.mapper) {
            // Very naive replacement of "schema"."table" -> "schema"."table"
            // Accessing internal state of mapper is dirty but effective
            const tableMap = this.mapper.tableMap;
            // We need a reverse lookup or iteration. 
            // Let's assume MetadataMapper has a way to get all known mappings.
            // Actually, MetadataMapper doesn't expose strict "src -> target" names easily without async lookups.
            // For now, we rely on the manager to pass context or handle table mapping via AI.
            // Or we iterate over known mappings if they are loaded.
        }

        return transformed;
    }

    /**
     * AI-based repair.
     */
    async fixWithAI(originalSql: string, transformedSql: string, errorMessage: string, context: string): Promise<string | null> {
        if (!this.model) return null;

        const cacheKey = this.generateCacheKey(transformedSql + errorMessage, context);
        try {
            const cached = await storage.getSqlTranslation(cacheKey);
            if (cached) return cached;
        } catch (e) { /* ignore */ }

        const prompt = `
You are an expert database engineer migrating from PostgreSQL to ClickHouse.

ORIGINAL SQL (Postgres):
${originalSql}

INTERMEDIATE SQL (Attempted ClickHouse):
${transformedSql}

ERROR MESSAGE:
${errorMessage}

CONTEXT (Tables/Schemas):
${context}

TASK:
1. Fix the SQL to be valid ClickHouse SQL.
2. Maintain the logic of the original query.
3. Fix function names (e.g. date_trunc -> toStartOf...), quoting, and joins.
4. Return ONLY the SQL string. No markdown.

FIXED SQL:`;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            let text = response.text().replace(/```sql/gi, '').replace(/```/g, '').trim();

            await storage.saveSqlTranslation(cacheKey, text);
            return text;
        } catch (err) {
            console.error('AI Fix failed:', err);
            return null;
        }
    }

    private generateCacheKey(sql: string, context: string): string {
        const hash = crypto.createHash('sha256');
        hash.update(sql + context);
        return hash.digest('hex');
    }
}
