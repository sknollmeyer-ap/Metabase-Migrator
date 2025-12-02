import { MetabaseClient } from './services/MetabaseClient';
import { config } from './config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs-extra';

interface TableInfo {
    id: number;
    name: string;
    schema: string;
    display_name: string;
    description?: string;
    fields: Array<{ name: string; display_name: string }>;
}

interface TableMatch {
    sourceTable: TableInfo;
    matches: Array<{
        table: TableInfo;
        similarity: number;
        score: number;
    }>;
}

class TableMappingWorkflow {
    private client: MetabaseClient;
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        this.client = new MetabaseClient();
        this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
    }

    /**
     * Create a rich description of a table for embedding
     */
    private createTableDescription(table: TableInfo): string {
        const fieldNames = table.fields.map(f => f.name).join(', ');
        const fieldDisplayNames = table.fields.map(f => f.display_name).join(', ');

        return `
      Table: ${table.schema}.${table.name}
      Display Name: ${table.display_name}
      Description: ${table.description || 'N/A'}
      Fields: ${fieldNames}
      Field Display Names: ${fieldDisplayNames}
    `.trim();
    }

    /**
     * Get embedding for a table description
     */
    private async getEmbedding(text: string): Promise<number[]> {
        try {
            const result = await this.model.embedContent(text);
            return result.embedding.values;
        } catch (error) {
            console.error('Error getting embedding:', error);
            throw error;
        }
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    async run() {
        console.log('Starting table mapping workflow...\n');

        // 1. Fetch metadata for both databases
        console.log('Fetching metadata from Database 6 (Postgres)...');
        const oldDbMeta = await this.client.getDatabaseMetadata(config.oldDbId);
        const oldTables: TableInfo[] = oldDbMeta.tables;
        console.log(`Found ${oldTables.length} tables in DB 6\n`);

        console.log('Fetching metadata from Database 10 (ClickHouse)...');
        const newDbMeta = await this.client.getDatabaseMetadata(config.newDbId);
        const newTables: TableInfo[] = newDbMeta.tables;
        console.log(`Found ${newTables.length} tables in DB 10\n`);

        // 2. Generate embeddings for new DB tables (target)
        console.log('Generating embeddings for ClickHouse tables...');
        const newTableEmbeddings = new Map<number, number[]>();

        for (let i = 0; i < newTables.length; i++) {
            const table = newTables[i];
            if (i % 50 === 0) {
                console.log(`  Progress: ${i}/${newTables.length}`);
            }
            const desc = this.createTableDescription(table);
            const embedding = await this.getEmbedding(desc);
            newTableEmbeddings.set(table.id, embedding);

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(`Generated ${newTableEmbeddings.size} embeddings\n`);

        // 3. For each old table, find similar new tables
        console.log('Finding similar tables...');
        const matches: TableMatch[] = [];

        for (let i = 0; i < oldTables.length; i++) {
            const oldTable = oldTables[i];
            if (i % 20 === 0) {
                console.log(`  Progress: ${i}/${oldTables.length}`);
            }

            const oldDesc = this.createTableDescription(oldTable);
            const oldEmbedding = await this.getEmbedding(oldDesc);

            // Calculate similarity with all new tables
            const similarities: Array<{ table: TableInfo; similarity: number; score: number }> = [];

            for (const newTable of newTables) {
                const newEmbedding = newTableEmbeddings.get(newTable.id)!;
                const similarity = this.cosineSimilarity(oldEmbedding, newEmbedding);

                // Bonus score for exact name match
                let score = similarity;
                if (oldTable.name.toLowerCase() === newTable.name.toLowerCase()) {
                    score += 0.3;
                }

                similarities.push({
                    table: newTable,
                    similarity,
                    score
                });
            }

            // Sort by score (descending)
            similarities.sort((a, b) => b.score - a.score);

            matches.push({
                sourceTable: oldTable,
                matches: similarities.slice(0, 5) // Top 5 matches
            });

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 4. Save results
        console.log('\nSaving results...');

        // Human-readable format
        const reportLines: string[] = [];
        reportLines.push('# Table Mapping Recommendations');
        reportLines.push(`Generated: ${new Date().toISOString()}`);
        reportLines.push('');

        for (const match of matches) {
            const source = match.sourceTable;
            reportLines.push(`## ${source.schema}.${source.name} (ID: ${source.id})`);
            reportLines.push(`Display Name: ${source.display_name}`);
            reportLines.push(`Fields: ${source.fields.length}`);
            reportLines.push('');
            reportLines.push('Top matches:');

            for (let i = 0; i < Math.min(5, match.matches.length); i++) {
                const m = match.matches[i];
                const pct = (m.score * 100).toFixed(1);
                reportLines.push(`  ${i + 1}. ${m.table.schema}.${m.table.name} (ID: ${m.table.id}) - ${pct}% match`);
                reportLines.push(`     Display: ${m.table.display_name}`);
            }
            reportLines.push('');
        }

        await fs.writeFile('table_mapping_report.md', reportLines.join('\n'));
        console.log('Saved table_mapping_report.md');

        // Machine-readable format for review
        const mappingWorkflow: any[] = [];
        for (const match of matches) {
            const topMatch = match.matches[0];
            mappingWorkflow.push({
                old_table_id: match.sourceTable.id,
                old_table_name: `${match.sourceTable.schema}.${match.sourceTable.name}`,
                suggested_new_table_id: topMatch.table.id,
                suggested_new_table_name: `${topMatch.table.schema}.${topMatch.table.name}`,
                confidence: topMatch.score,
                alternatives: match.matches.slice(1, 3).map(m => ({
                    table_id: m.table.id,
                    table_name: `${m.table.schema}.${m.table.name}`,
                    score: m.score
                })),
                // User fills this in after review
                confirmed: false,
                final_new_table_id: null
            });
        }

        await fs.writeJson('table_mapping_workflow.json', mappingWorkflow, { spaces: 2 });
        console.log('Saved table_mapping_workflow.json');

        console.log('\nWorkflow complete!');
        console.log('\nNext steps:');
        console.log('1. Review table_mapping_report.md for suggested mappings');
        console.log('2. Edit table_mapping_workflow.json to confirm/adjust mappings');
        console.log('3. Set "confirmed": true and "final_new_table_id" for each mapping');
        console.log('4. Run the migration tool with this mapping file');
    }
}

// Run the workflow
const workflow = new TableMappingWorkflow();
workflow.run().catch(console.error);
