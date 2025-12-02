-- Supabase Database Schema for Metabase Migration Tool
-- Run this in your Supabase SQL Editor

-- Table Mappings
CREATE TABLE IF NOT EXISTS table_mappings (
    id BIGSERIAL PRIMARY KEY,
    old_table_id INTEGER NOT NULL UNIQUE,
    old_table_name TEXT NOT NULL,
    suggested_new_table_id INTEGER NOT NULL,
    suggested_new_table_name TEXT NOT NULL,
    confidence NUMERIC(5, 4) NOT NULL,
    alternatives JSONB DEFAULT '[]'::jsonb,
    confirmed BOOLEAN DEFAULT FALSE,
    final_new_table_id INTEGER,
    ignored BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Field Mappings
CREATE TABLE IF NOT EXISTS field_mappings (
    id BIGSERIAL PRIMARY KEY,
    old_field_id INTEGER NOT NULL UNIQUE,
    old_field_name TEXT NOT NULL,
    old_table_id INTEGER NOT NULL,
    suggested_new_field_id INTEGER,
    suggested_new_field_name TEXT,
    new_table_id INTEGER,
    confidence NUMERIC(5, 4),
    mapping_type TEXT CHECK (mapping_type IN ('heuristic', 'ai', 'manual')),
    confirmed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Card ID Mappings
CREATE TABLE IF NOT EXISTS card_mappings (
    id BIGSERIAL PRIMARY KEY,
    old_card_id INTEGER NOT NULL UNIQUE,
    new_card_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migration State (for storing arbitrary JSON like waiting area)
CREATE TABLE IF NOT EXISTS migration_state (
    id BIGSERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_table_mappings_confirmed ON table_mappings(confirmed);
CREATE INDEX IF NOT EXISTS idx_table_mappings_ignored ON table_mappings(ignored);
CREATE INDEX IF NOT EXISTS idx_field_mappings_old_field_id ON field_mappings(old_field_id);
CREATE INDEX IF NOT EXISTS idx_card_mappings_old_card_id ON card_mappings(old_card_id);
CREATE INDEX IF NOT EXISTS idx_migration_state_key ON migration_state(key);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_table_mappings_updated_at BEFORE UPDATE ON table_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_field_mappings_updated_at BEFORE UPDATE ON field_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_migration_state_updated_at BEFORE UPDATE ON migration_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional, but recommended)
ALTER TABLE table_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_state ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all operations with service role key)
CREATE POLICY "Enable all operations for service role" ON table_mappings
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for service role" ON field_mappings
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for service role" ON card_mappings
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for service role" ON migration_state
    FOR ALL USING (true) WITH CHECK (true);
