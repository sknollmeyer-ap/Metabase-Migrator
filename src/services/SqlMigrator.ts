import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { storage } from './StorageService';
import crypto from 'crypto';

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
        // Use the fastest model for better performance within Vercel timeout limits
        const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';
        this.model = genAI.getGenerativeModel({ model: modelName });
    }

    async translateSql(originalSql: string, context: string): Promise<string> {
        // Generate cache key from SQL + context
        const cacheKey = this.generateCacheKey(originalSql, context);

        // Check cache first
        try {
            const cached = await storage.getSqlTranslation(cacheKey);
            if (cached) {
                console.log('  ✓ Using cached SQL translation');
                return cached;
            }
        } catch (err) {
            console.warn('  Cache lookup failed, proceeding with translation:', err);
        }

        // Optimized, more concise prompt
        const prompt = `Convert PostgreSQL to ClickHouse SQL.

PostgreSQL:
${originalSql}

Schema mappings:
${context}

Rules:
- Keep {{param}} syntax
- Use ClickHouse date/time functions
- Return ONLY the SQL (no markdown)
- If impossible, return: ERROR: <reason>

ClickHouse SQL:`;

        let retries = 0;
        const maxRetries = 3;
        const baseDelay = 2000; // 2 seconds

        while (true) {
            try {
                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                let text = response.text();
                // Strip any code fences
                text = text.replace(/```sql/gi, '').replace(/```/g, '').trim();

                // Cache the translation
                try {
                    await storage.saveSqlTranslation(cacheKey, text);
                } catch (err) {
                    console.warn('  Failed to cache translation:', err);
                }

                return text;
            } catch (error: any) {
                const message = error?.message || String(error);

                // Check for rate limit error (429)
                if (message.includes('429') || message.includes('Too Many Requests') || message.includes('Resource exhausted')) {
                    if (retries < maxRetries) {
                        retries++;
                        const delay = baseDelay * Math.pow(2, retries - 1); // Exponential backoff: 2s, 4s, 8s
                        console.warn(`  ⚠️ Gemini API rate limited. Retrying in ${delay}ms (Attempt ${retries}/${maxRetries})...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }

                throw new Error(`[GoogleGenerativeAI Error]: ${message}`);
            }
        }
    }

    private generateCacheKey(sql: string, context: string): string {
        const hash = crypto.createHash('sha256');
        hash.update(sql + context);
        return hash.digest('hex');
    }
}
