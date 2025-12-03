-- Create SQL translation cache table
CREATE TABLE IF NOT EXISTS sql_translation_cache (
    cache_key TEXT PRIMARY KEY,
    translated_sql TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sql_cache_created ON sql_translation_cache(created_at DESC);

-- Add RLS policies
ALTER TABLE sql_translation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on sql_translation_cache"
ON sql_translation_cache
FOR ALL
USING (true)
WITH CHECK (true);
