import { MetabaseClient } from './MetabaseClient';
import { MetadataMapper } from './MetadataMapper';
import { MbqlMigrator } from './MbqlMigrator';
import { SqlMigrator } from './SqlMigrator';
import { WaitingArea } from './WaitingArea';
import { CardIdMapping } from './CardIdMapping';
import { CardDependencyResolver } from './CardDependencyResolver';
import { config } from '../config';
import fs from 'fs-extra';
import path from 'path';
import { FieldMapperAgent } from './FieldMapperAgent';

export class MigrationManager {
    private client: MetabaseClient;
    private mapper: MetadataMapper;
    private mbqlMigrator: MbqlMigrator;
    private sqlMigrator: SqlMigrator;
    private waitingArea: WaitingArea;
    private cardIdMapping: CardIdMapping;
    private fieldMapperAgent: FieldMapperAgent;

    constructor() {
        this.client = new MetabaseClient();
        this.mapper = new MetadataMapper(this.client);
        this.cardIdMapping = new CardIdMapping();
        this.mbqlMigrator = new MbqlMigrator(this.mapper, this.cardIdMapping.getAll());
        this.sqlMigrator = new SqlMigrator();
        this.waitingArea = new WaitingArea();
        this.fieldMapperAgent = new FieldMapperAgent(this.mapper);
    }

    async initialize() {
        await this.mapper.buildMaps();
        await this.cardIdMapping.load();
        await this.waitingArea.load();
        this.mbqlMigrator.setCardIdMap(this.cardIdMapping.getAll());
    }

    async run(dryRun: boolean, targetCardId?: number) {
        await this.initialize();

        const results: any[] = [];
        if (targetCardId) {
            const result = await this.migrateCardWithDependencies(targetCardId, dryRun);
            results.push(result);
        } else {
            console.log('No target card specified. Provide --card=<id> to migrate a card.');
        }

        await this.waitingArea.save();
        return this.generateReport(results, dryRun);
    }

    async migrateCardWithDependencies(cardId: number, dryRun: boolean = true, visited: Set<number> = new Set(), collectionId: number | null = null, force: boolean = false): Promise<any> {
        if (visited.has(cardId)) {
            return { oldId: cardId, newId: null, status: 'skipped', reason: 'circular dependency detected' };
        }
        visited.add(cardId);

        console.log(`\n=== Migrating card ${cardId} with dependencies ===`);

        // 1. Fetch the card
        const card = await this.client.getCard(cardId);
        console.log(`Fetched card: ${card.name} (ID: ${card.id})`);

        // 2. Extract dependencies
        const dependencies = CardDependencyResolver.extractCardReferences(card.dataset_query);
        console.log(`Dependencies found: ${dependencies.join(', ') || 'none'}`);

        const dependencyResults: any[] = [];

        // 3. Migrate dependencies first
        for (const depId of dependencies) {
            if (!this.cardIdMapping.has(depId)) {
                console.log(`Migrating dependency: card ${depId}`);
                // Don't force dependencies, only the target card
                const depResult = await this.migrateCardWithDependencies(depId, dryRun, visited, collectionId, false);
                dependencyResults.push(depResult);
            } else {
                console.log(`Dependency card ${depId} already migrated to ${this.cardIdMapping.get(depId)}`);
            }
        }

        // 4. Check if this card is already migrated
        if (this.cardIdMapping.has(cardId) && !force) {
            console.log(`Card ${cardId} already migrated to ${this.cardIdMapping.get(cardId)}`);
            return {
                oldId: cardId,
                newId: this.cardIdMapping.get(cardId),
                status: 'already_migrated',
                cardName: card.name,
                originalQuery: card.dataset_query,
                dependencies: dependencyResults
            };
        }

        // 5. Migrate the card itself
        console.log(`Migrating card ${cardId}...`);
        const result = await this.migrateCard(card, dryRun, collectionId, force);

        return {
            ...result,
            cardName: card.name,
            originalQuery: card.dataset_query,
            dependencies: dependencyResults
        };
    }

    private async migrateCard(card: any, dryRun: boolean, collectionId: number | null = null, force: boolean = false): Promise<any> {
        try {
            const warnings: string[] = [];
            const errors: string[] = [];
            let migratedQuery: any;

            if (!card.dataset_query) {
                throw new Error('Card missing dataset_query');
            }

            if (card.dataset_query.type === 'query') {
                const { query, warnings: mbqlWarnings } = this.mbqlMigrator.migrateQuery(card.dataset_query);
                migratedQuery = query;
                warnings.push(...mbqlWarnings);
            } else if (card.dataset_query.type === 'native') {
                const sql = card.dataset_query.native?.query || '';
                if (!sql) {
                    throw new Error('Native query is empty');
                }

                const context = await this.buildSqlContext();
                const translatedSql = await this.sqlMigrator.translateSql(sql, context);

                if (translatedSql.toUpperCase().startsWith('ERROR:')) {
                    errors.push(translatedSql);
                    throw new Error(translatedSql);
                }

                migratedQuery = {
                    database: config.newDbId,
                    type: 'native',
                    native: {
                        query: translatedSql,
                        'template-tags': card.dataset_query.native?.['template-tags'] || {}
                    }
                };
            } else {
                throw new Error(`Unknown query type: ${card.dataset_query.type}`);
            }

            if (warnings.length > 0) {
                console.warn(`Warnings for card ${card.id}:`, warnings.join(' | '));
            }

            if (dryRun) {
                console.log('  [DRY RUN] Would create card with migrated query');
                return {
                    oldId: card.id,
                    newId: null,
                    status: 'dry_run',
                    migratedQuery,
                    warnings,
                    errors
                };
            }

            // Create or Update the new card
            console.log('  Creating/Updating card in Metabase...');
            const newCard = {
                name: `${card.name} [ClickHouse]`,
                description: card.description || `Migrated from card ${card.id}`,
                display: card.display,
                visualization_settings: this.cleanVisualizationSettings(card.visualization_settings),
                dataset_query: migratedQuery,
                collection_id: collectionId !== null ? collectionId : card.collection_id,
                collection_position: card.collection_position
            };

            let created;
            const existingNewId = this.cardIdMapping.get(card.id);

            if (existingNewId && force) {
                console.log(`  Updating existing migrated card ${existingNewId}...`);
                await this.client.updateCard(existingNewId, newCard);
                created = { id: existingNewId };
                console.log(`  ✓ Updated card ${created.id}: ${config.metabaseBaseUrl}/question/${created.id}`);
            } else {
                created = await this.client.createCard(newCard);
                console.log(`  ✓ Created new card ${created.id}: ${config.metabaseBaseUrl}/question/${created.id}`);
            }

            // Test the card and fix any errors
            const fixedCardId = await this.testAndFixCard(created.id, migratedQuery);

            // Save the mapping
            await this.cardIdMapping.set(card.id, fixedCardId);

            return {
                oldId: card.id,
                newId: fixedCardId,
                status: 'migrated',
                cardUrl: `${config.metabaseBaseUrl}/question/${fixedCardId}`,
                migratedQuery,
                warnings,
                errors
            };
        } catch (error: any) {
            const message = error?.message || String(error);
            console.error(`  Failed to migrate card ${card.id}:`, message);
            this.waitingArea.add({
                cardId: card.id,
                cardName: card.name,
                reason: message,
                missingTables: [],
                timestamp: new Date().toISOString()
            });

            return {
                oldId: card.id,
                newId: null,
                status: 'failed',
                error: message,
                warnings: [],
                errors: [message]
            };
        }
    }

    private async testAndFixCard(cardId: number, originalQuery: any, maxRetries: number = 3): Promise<number> {
        console.log(`  Testing card ${cardId}...`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Query the card to check for errors
                const queryResult = await this.client.queryCard(cardId);

                if (queryResult.error) {
                    throw new Error(queryResult.error);
                }

                console.log(`  ✓ Card ${cardId} executed successfully!`);
                return cardId;
            } catch (error: any) {
                const errorMessage = error?.response?.data?.message || error?.message || String(error);
                console.log(`  ✗ Card ${cardId} failed (attempt ${attempt}/${maxRetries}): ${errorMessage}`);

                if (attempt === maxRetries) {
                    console.log(`  Max retries reached. Card ${cardId} still has errors.`);
                    return cardId;
                }

                // Only try to fix SQL for native queries
                if (originalQuery.type !== 'native' || !originalQuery.native?.query) {
                    console.log(`  Cannot auto-fix non-SQL query. Stopping retries.`);
                    return cardId;
                }

                // Try to fix the SQL using Gemini
                const fixedSQL = await this.fixSQLWithAI(originalQuery.native.query, errorMessage);
                if (!fixedSQL) {
                    console.log(`  AI couldn't fix the error. Stopping retries.`);
                    return cardId;
                }

                // Update the card with fixed SQL
                console.log(`  Updating card ${cardId} with corrected SQL...`);
                await this.client.updateCard(cardId, {
                    dataset_query: {
                        ...originalQuery,
                        native: {
                            ...originalQuery.native,
                            query: fixedSQL
                        }
                    }
                });
            }
        }

        return cardId;
    }

    private async fixSQLWithAI(originalSQL: string, errorMessage: string): Promise<string | null> {
        const prompt = `
You are fixing a ClickHouse SQL query that failed with an error.

ORIGINAL SQL:
${originalSQL}

ERROR:
${errorMessage}

Instructions:
1) Analyze the error message carefully
2) Fix the SQL to resolve the error
3) Common fixes:
   - Remove columns that don't exist in the table
   - Fix column name typos
   - Adjust JOIN conditions
   - Fix data type issues
4) Return ONLY the corrected SQL (no markdown, no explanations)
5) If you can't fix it, return: CANNOT_FIX

CORRECTED SQL:
        `.trim();

        try {
            const result = await this.sqlMigrator['model'].generateContent(prompt);
            const response = await result.response;
            let text = response.text().replace(/```sql/gi, '').replace(/```/g, '').trim();

            if (text.includes('CANNOT_FIX')) {
                return null;
            }

            return text;
        } catch (error: any) {
            console.error('AI fix failed:', error?.message);
            return null;
        }
    }

    async generateReport(results: any[], dryRun: boolean) {
        const report = {
            summary: {
                total: results.length,
                migrated: results.filter(r => r.status === 'migrated').length,
                waiting: this.waitingArea.getAll().length,
                alreadyMigrated: results.filter(r => r.status === 'already_migrated').length,
                dryRun
            },
            cardMappings: Object.fromEntries(this.cardIdMapping.getAll()),
            details: results,
            waiting: this.waitingArea.getAll()
        };

        const reportPath = path.resolve(process.cwd(), 'migration_report.json');
        await fs.writeJson(reportPath, report, { spaces: 2 });
        await this.waitingArea.save();
        console.log(`\nReport saved to ${reportPath}`);

        return report;
    }

    private async buildSqlContext(): Promise<string> {
        const context: string[] = [
            `Old DB ID: ${config.oldDbId}`,
            `New DB ID: ${config.newDbId}`,
            '',
            '=== TABLE MAPPINGS WITH SCHEMAS ===',
            ''
        ];

        // Get full metadata for both databases
        const oldDbMetadata = await this.client.getDatabaseMetadata(config.oldDbId);
        const newDbMetadata = await this.client.getDatabaseMetadata(config.newDbId);

        const oldTablesById = new Map(oldDbMetadata.tables.map((t: any) => [t.id, t]));
        const newTablesById = new Map(newDbMetadata.tables.map((t: any) => [t.id, t]));

        // Map table names to IDs for quick lookup
        const oldTablesByName = new Map<string, any>();
        oldDbMetadata.tables.forEach((t: any) => {
            oldTablesByName.set(`${t.schema}.${t.name}`, t);
        });

        // Build detailed mappings
        for (const [oldId, newId] of Object.entries(this.mapper.tableMap)) {
            const oldTable: any = oldTablesById.get(Number(oldId));
            const newTable: any = newTablesById.get(Number(newId));

            if (!oldTable || !newTable) continue;

            context.push(`OLD TABLE: ${oldTable.schema}.${oldTable.name} (ID: ${oldId})`);
            context.push(`  Columns: ${oldTable.fields.map((f: any) => `${f.name}:${f.base_type}`).join(', ')}`);
            context.push(`  ↓ MAPS TO ↓`);
            context.push(`NEW TABLE: ${newTable.schema}.${newTable.name} (ID: ${newId})`);
            context.push(`  Columns: ${newTable.fields.map((f: any) => `${f.name}:${f.base_type}`).join(', ')}`);
            context.push('');
        }

        context.push('=== UNMAPPED TABLES ===');
        this.mapper.missingTables.forEach(tableName => {
            const table = oldTablesByName.get(tableName);
            if (table) {
                context.push(`${tableName} (ID: ${table.id})`);
                context.push(`  Columns: ${table.fields.map((f: any) => `${f.name}:${f.base_type}`).join(', ')}`);
            } else {
                context.push(tableName);
            }
        });

        return context.join('\n');
    }

    // Expose mapping info for status endpoints without leaking internals elsewhere
    getTableMap() {
        return this.mapper.tableMap;
    }

    getFieldMap() {
        return this.mapper.fieldMap;
    }

    getMissingTables() {
        return this.mapper.missingTables;
    }

    async setFieldOverride(oldFieldId: number, newFieldId: number) {
        await this.mapper.setFieldOverride(oldFieldId, newFieldId);
    }

    getFieldCandidates(oldFieldId: number) {
        return this.mapper.getFieldCandidates(oldFieldId);
    }

    async suggestFieldMapping(oldFieldId: number) {
        return this.fieldMapperAgent.suggestMapping(oldFieldId);
    }

    private cleanVisualizationSettings(settings: any): any {
        if (!settings) return {};
        const clean = { ...settings };

        // Remove column settings as they reference specific field IDs
        if (clean.column_settings) {
            delete clean.column_settings;
        }

        // Remove table columns configuration
        if (clean['table.columns']) {
            delete clean['table.columns'];
        }

        // Remove specific graph settings that might reference fields
        if (clean['graph.dimensions']) {
            delete clean['graph.dimensions'];
        }
        if (clean['graph.metrics']) {
            delete clean['graph.metrics'];
        }

        // Remove click behavior if it references fields
        if (clean.click_behavior) {
            delete clean.click_behavior;
        }

        return clean;
    }

    // Helper methods for API
    getClient() {
        return this.client;
    }

    getMapper() {
        return this.mapper;
    }
}
