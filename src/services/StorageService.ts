import { supabase, TableMapping, FieldMapping, CardMapping } from '../lib/supabase';
import fs from 'fs-extra';
import path from 'path';

/**
 * Storage service that abstracts file system and Supabase storage
 * Falls back to file system if Supabase is not configured
 */
export class StorageService {
    private useSupabase: boolean;
    private fileBasePath: string;

    constructor() {
        this.useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
        this.fileBasePath = process.env.NODE_ENV === 'production' ? '/tmp' : '.';

        if (this.useSupabase) {
            console.log('✅ Using Supabase for persistent storage');
        } else {
            console.log('⚠️  Using file system (data will not persist on Vercel)');
        }
    }

    // ======================
    // TABLE MAPPINGS
    // ======================

    async getTableMappings(): Promise<TableMapping[]> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('table_mappings')
                .select('*')
                .order('old_table_id');

            if (error) throw error;
            return data || [];
        } else {
            const filePath = path.join(this.fileBasePath, 'table_mapping_workflow.json');
            if (await fs.pathExists(filePath)) {
                return await fs.readJson(filePath);
            }
            return [];
        }
    }

    async saveTableMappings(mappings: TableMapping[]): Promise<void> {
        if (this.useSupabase) {
            // Upsert all mappings
            const { error } = await supabase
                .from('table_mappings')
                .upsert(mappings, { onConflict: 'old_table_id' });

            if (error) throw error;
        } else {
            const filePath = path.join(this.fileBasePath, 'table_mapping_workflow.json');
            await fs.writeJson(filePath, mappings, { spaces: 2 });
        }
    }

    async updateTableMapping(oldTableId: number, updates: Partial<TableMapping>): Promise<TableMapping> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('table_mappings')
                .update(updates)
                .eq('old_table_id', oldTableId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } else {
            const mappings = await this.getTableMappings();
            const mapping = mappings.find(m => m.old_table_id === oldTableId);
            if (!mapping) throw new Error(`Mapping for table ${oldTableId} not found`);

            Object.assign(mapping, updates);
            await this.saveTableMappings(mappings);
            return mapping;
        }
    }

    // ======================
    // FIELD MAPPINGS
    // ======================

    async getFieldMappings(): Promise<FieldMapping[]> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('field_mappings')
                .select('*')
                .order('old_field_id');

            if (error) throw error;
            return data || [];
        } else {
            const filePath = path.join(this.fileBasePath, 'field_mapping_workflow.json');
            if (await fs.pathExists(filePath)) {
                return await fs.readJson(filePath);
            }
            return [];
        }
    }

    async saveFieldMappings(mappings: FieldMapping[]): Promise<void> {
        if (this.useSupabase) {
            const { error } = await supabase
                .from('field_mappings')
                .upsert(mappings, { onConflict: 'old_field_id' });

            if (error) throw error;
        } else {
            const filePath = path.join(this.fileBasePath, 'field_mapping_workflow.json');
            await fs.writeJson(filePath, mappings, { spaces: 2 });
        }
    }

    async updateFieldMapping(oldFieldId: number, updates: Partial<FieldMapping>): Promise<FieldMapping> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('field_mappings')
                .update(updates)
                .eq('old_field_id', oldFieldId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } else {
            const mappings = await this.getFieldMappings();
            const mapping = mappings.find(m => m.old_field_id === oldFieldId);
            if (!mapping) throw new Error(`Mapping for field ${oldFieldId} not found`);

            Object.assign(mapping, updates);
            await this.saveFieldMappings(mappings);
            return mapping;
        }
    }

    // ======================
    // CARD MAPPINGS
    // ======================

    async getCardMappings(): Promise<Map<number, number>> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('card_mappings')
                .select('old_card_id, new_card_id');

            if (error) throw error;

            const map = new Map<number, number>();
            data?.forEach(m => map.set(m.old_card_id, m.new_card_id));
            return map;
        } else {
            const filePath = path.join(this.fileBasePath, 'card_id_mapping.json');
            if (await fs.pathExists(filePath)) {
                const obj = await fs.readJson(filePath);
                return new Map(Object.entries(obj).map(([k, v]) => [parseInt(k), v as number]));
            }
            return new Map();
        }
    }

    async saveCardMapping(oldCardId: number, newCardId: number): Promise<void> {
        if (this.useSupabase) {
            const { error } = await supabase
                .from('card_mappings')
                .upsert({ old_card_id: oldCardId, new_card_id: newCardId }, { onConflict: 'old_card_id' });

            if (error) throw error;
        } else {
            const mappings = await this.getCardMappings();
            mappings.set(oldCardId, newCardId);

            const obj = Object.fromEntries(mappings);
            const filePath = path.join(this.fileBasePath, 'card_id_mapping.json');
            await fs.writeJson(filePath, obj, { spaces: 2 });
        }
    }

    // ======================
    // GENERIC STATE
    // ======================

    async getState<T>(key: string): Promise<T | null> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('migration_state')
                .select('value')
                .eq('key', key)
                .single();

            if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
            return data?.value || null;
        } else {
            const filePath = path.join(this.fileBasePath, `${key}.json`);
            if (await fs.pathExists(filePath)) {
                return await fs.readJson(filePath);
            }
            return null;
        }
    }

    async setState<T>(key: string, value: T): Promise<void> {
        if (this.useSupabase) {
            const { error } = await supabase
                .from('migration_state')
                .upsert({ key, value }, { onConflict: 'key' });

            if (error) throw error;
        } else {
            const filePath = path.join(this.fileBasePath, `${key}.json`);
            await fs.writeJson(filePath, value, { spaces: 2 });
        }
    }

    // ======================
    // SQL TRANSLATION CACHE
    // ======================

    async getSqlTranslation(cacheKey: string): Promise<string | null> {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('sql_translation_cache')
                .select('translated_sql')
                .eq('cache_key', cacheKey)
                .single();

            if (error) {
                if (error.code === 'PGRST116') return null; // Not found
                throw error;
            }
            return data?.translated_sql || null;
        } else {
            const filePath = path.join(this.fileBasePath, 'sql_cache', `${cacheKey}.txt`);
            if (await fs.pathExists(filePath)) {
                return await fs.readFile(filePath, 'utf-8');
            }
            return null;
        }
    }

    async saveSqlTranslation(cacheKey: string, translatedSql: string): Promise<void> {
        if (this.useSupabase) {
            const { error } = await supabase
                .from('sql_translation_cache')
                .upsert({
                    cache_key: cacheKey,
                    translated_sql: translatedSql,
                    created_at: new Date().toISOString()
                }, { onConflict: 'cache_key' });

            if (error) throw error;
        } else {
            const dirPath = path.join(this.fileBasePath, 'sql_cache');
            await fs.ensureDir(dirPath);
            const filePath = path.join(dirPath, `${cacheKey}.txt`);
            await fs.writeFile(filePath, translatedSql, 'utf-8');
        }
    }
}

// Singleton instance
export const storage = new StorageService();
