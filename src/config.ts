import dotenv from 'dotenv';
dotenv.config();

export const config = {
    metabaseBaseUrl: process.env.METABASE_BASE_URL || '',
    metabaseApiKey: process.env.METABASE_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    oldDbId: parseInt(process.env.OLD_DB_ID || '6', 10),
    newDbId: parseInt(process.env.NEW_DB_ID || '10', 10),
};

if (!config.metabaseBaseUrl || !config.metabaseApiKey) {
    console.warn('Warning: METABASE_BASE_URL or METABASE_API_KEY is missing. Metabase API calls will fail until these are set.');
}
