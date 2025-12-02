import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    // Don't warn here, StorageService will handle the warning
}

// Only create client if credentials exist to avoid runtime errors
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null as unknown as SupabaseClient;

// Database schema types
export interface TableMapping {
    id?: number;
    old_table_id: number;
    old_table_name: string;
    suggested_new_table_id: number;
    suggested_new_table_name: string;
    confidence: number;
    alternatives: any[];
    confirmed: boolean;
    final_new_table_id: number | null;
    ignored: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface FieldMapping {
    id?: number;
    old_field_id: number;
    old_field_name: string;
    old_table_id: number;
    suggested_new_field_id: number | null;
    suggested_new_field_name: string | null;
    new_table_id: number | null;
    confidence: number | null;
    mapping_type: 'heuristic' | 'ai' | 'manual';
    confirmed: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface CardMapping {
    id?: number;
    old_card_id: number;
    new_card_id: number;
    created_at?: string;
}

export interface MigrationState {
    id?: number;
    key: string;
    value: any;
    created_at?: string;
    updated_at?: string;
}
