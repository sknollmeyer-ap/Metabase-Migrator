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
import { MigrationResponse, MigrationErrorCode, UnmatchedTable, UnmatchedField } from '../types';

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

    async migrateCardWithDependencies(cardId: number, dryRun: boolean = true, visited: Set<number> = new Set(), collectionId: number | null = null, force: boolean = false): Promise<MigrationResponse> {
        if (visited.has(cardId)) {
            return { status: 'failed', errorCode: MigrationErrorCode.UNKNOWN_ERROR, message: 'Circular dependency detected' };
        }
        visited.add(cardId);

        console.log(`\n=== Migrating card ${cardId} with dependencies ===`);

        // 1. Fetch the card
        let card;
        try {
            card = await this.client.getCard(cardId);
            console.log(`Fetched card: ${card.name} (ID: ${card.id})`);
        } catch (error: any) {
            return { status: 'failed', errorCode: MigrationErrorCode.METABASE_API_ERROR, message: `Failed to fetch card ${cardId}: ${error.message}` };
        }

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

                if (depResult.status === 'failed') {
                    return {
                        status: 'failed',
                        errorCode: MigrationErrorCode.DEPENDENCY_NOT_MIGRATED,
                        message: `Dependency card ${depId} failed to migrate`,
                        details: depResult
                    };
                }
            } else {
                console.log(`Dependency card ${depId} already migrated to ${this.cardIdMapping.get(depId)}`);
            }
        }

        // 4. Check if this card is already migrated
        if (this.cardIdMapping.has(cardId) && !force) {
            const newCardId = this.cardIdMapping.get(cardId)!;
            console.log(`Card ${cardId} already migrated to ${newCardId}`);

            // Fetch the migrated card to show its query
            let migratedQuery = null;
            try {
                const migratedCard = await this.client.getCard(newCardId);
                migratedQuery = migratedCard.dataset_query;
            } catch (err) {
                console.warn(`Could not fetch migrated card ${newCardId}:`, err);
            }

            return {
                status: 'already_migrated',
                oldId: cardId,
                cardName: card.name,
                newId: newCardId,
                originalQuery: card.dataset_query,
                migratedQuery: migratedQuery,
                cardUrl: `${this.client.getBaseUrl()}/question/${newCardId}`,
                details: { dependencies: dependencyResults }
            };
        }

        // 5. Migrate the card itself
        console.log(`Migrating card ${cardId}...`);
        const result = await this.migrateCard(card, dryRun, collectionId, force);

        return {
            ...result,
            oldId: cardId,
            cardName: card.name,
            originalQuery: card.dataset_query,
            details: { ...result.details, dependencies: dependencyResults }
        };
    }

    private async migrateCard(card: any, dryRun: boolean, collectionId: number | null = null, force: boolean = false): Promise<MigrationResponse> {
        try {
            const warnings: string[] = [];
            const errors: string[] = [];
            let migratedQuery: any;
            let unmatchedTables: UnmatchedTable[] = [];
            let unmatchedFields: UnmatchedField[] = [];

            if (!card.dataset_query) {
                return { status: 'failed', errorCode: MigrationErrorCode.UNKNOWN_ERROR, message: 'Card missing dataset_query' };
            }

            if (card.dataset_query.type === 'query') {
                const result = this.mbqlMigrator.migrateQuery(card.dataset_query);
                migratedQuery = result.query;
                warnings.push(...result.warnings);
                unmatchedTables = result.unmatchedTables;
                unmatchedFields = result.unmatchedFields;
            } else if (card.dataset_query.type === 'native') {
                console.log(`  Processing native SQL query for card ${card.id}...`);
                const sql = card.dataset_query.native?.query || '';
                if (!sql) {
                    return {
                        status: 'failed',
                        errorCode: MigrationErrorCode.UNKNOWN_ERROR,
                        message: 'Native query is empty',
                        originalQuery: card.dataset_query
                    };
                }

                console.log(`  Original SQL length: ${sql.length} characters`);
                const context = await this.buildSqlContext();

                try {
                    const translatedSql = await this.sqlMigrator.translateSql(sql, context);
                    console.log(`  Translated SQL length: ${translatedSql.length} characters`);

                    if (translatedSql.toUpperCase().startsWith('ERROR:')) {
                        console.error(`  SQL translation failed: ${translatedSql}`);
                        return {
                            status: 'failed',
                            errorCode: MigrationErrorCode.SQL_TRANSLATION_ERROR,
                            message: `SQL Translation Error: ${translatedSql}`,
                            originalQuery: card.dataset_query,
                            details: { originalSql: sql, translationError: translatedSql }
                        };
                    }

                    console.log(`  ✓ SQL translation successful`);
                    migratedQuery = {
                        database: config.newDbId,
                        type: 'native',
                        native: {
                            query: translatedSql,
                            'template-tags': card.dataset_query.native?.['template-tags'] || {}
                        }
                    };
                } catch (error: any) {
                    console.error(`  SQL migration error:`, error);
                    return {
                        status: 'failed',
                        errorCode: MigrationErrorCode.SQL_TRANSLATION_ERROR,
                        message: `SQL migration failed: ${error.message}`,
                        originalQuery: card.dataset_query,
                        details: { originalSql: sql, error: error.message }
                    };
                }
            } else {
                return { status: 'failed', errorCode: MigrationErrorCode.UNKNOWN_ERROR, message: `Unknown query type: ${card.dataset_query.type}` };
            }

            if (warnings.length > 0) {
                console.warn(`Warnings for card ${card.id}:`, warnings.join(' | '));
            }

            // Check for unmatched items
            if (unmatchedTables.length > 0) {
                return {
                    status: 'failed',
                    errorCode: MigrationErrorCode.MISSING_MAPPING_TABLE,
                    message: 'Unmatched tables found',
                    unmatchedTables,
                    unmatchedFields,
                    originalQuery: card.dataset_query,
                    migratedQuery // Return partial migration
                };
            }

            if (unmatchedFields.length > 0) {
                // We might want to allow migration with warnings for fields, but for now let's be strict or warn
                // The requirement says "surface these unmatched elements".
                // If it's a dry run, we definitely want to show them.
                // If it's a real run, maybe we fail?
                // Let's treat it as a failure/warning state that prevents auto-migration unless forced (but force logic isn't fully here for fields)
                // Actually, let's return them so the UI can show them.
                if (dryRun) {
                    // For dry run, we return them but status might be 'ok' or 'failed' depending on strictness.
                    // Let's return status 'failed' so the UI highlights it, but provide the query.
                    return {
                        status: 'failed',
                        errorCode: MigrationErrorCode.MISSING_MAPPING_FIELD,
                        message: 'Unmatched fields found',
                        unmatchedTables,
                        unmatchedFields,
                        originalQuery: card.dataset_query,
                        migratedQuery
                    };
                } else {
                    // For real migration, if we have unmapped fields, the query will likely fail in Metabase.
                    // So we should probably fail.
                    return {
                        status: 'failed',
                        errorCode: MigrationErrorCode.MISSING_MAPPING_FIELD,
                        message: 'Unmatched fields found',
                        unmatchedTables,
                        unmatchedFields,
                        originalQuery: card.dataset_query,
                        migratedQuery
                    };
                }
            }

            if (dryRun) {
                console.log('  [DRY RUN] Would create card with migrated query');
                return {
                    status: 'ok',
                    originalQuery: card.dataset_query,
                    migratedQuery,
                    warnings
                };
            }

            // Create or Update the new card
            console.log('  Creating/Updating card in Metabase...');

            // Check if card name already has [ClickHouse] suffix to avoid duplication
            const cardName = card.name.includes('[ClickHouse]')
                ? card.name
                : `${card.name} [ClickHouse]`;

            const newCard = {
                name: cardName,
                description: card.description || `Migrated from card ${card.id}`,
                display: card.display,
                visualization_settings: this.cleanVisualizationSettings(card.visualization_settings),
                dataset_query: migratedQuery,
                collection_id: collectionId !== null ? collectionId : card.collection_id,
                collection_position: card.collection_position
            };

            let created;
            const existingNewId = this.cardIdMapping.get(card.id);

            try {
                if (existingNewId && force) {
                    console.log(`  Updating existing migrated card ${existingNewId}...`);
                    await this.client.updateCard(existingNewId, newCard);
                    created = { id: existingNewId };
                    console.log(`  ✓ Updated card ${created.id}: ${config.metabaseBaseUrl}/question/${created.id}`);
                } else {
                    console.log(`  Creating new card with name: "${cardName}"`);
                    created = await this.client.createCard(newCard);
                    console.log(`  ✓ Created new card ${created.id}: ${config.metabaseBaseUrl}/question/${created.id}`);
                }
            } catch (err: any) {
                console.error(`  ✗ Failed to create/update card:`, err);
                const errorMessage = err.response?.data?.message || err.message || 'Unknown error';
                const errorDetails = err.response?.data || {};
                return {
                    status: 'failed',
                    errorCode: MigrationErrorCode.METABASE_API_ERROR,
                    message: `Metabase API error: ${errorMessage}`,
                    details: {
                        error: errorMessage,
                        apiResponse: errorDetails,
                        cardName: cardName
                    },
                    originalQuery: card.dataset_query,
                    migratedQuery
                };
            }

            // Test the card and fix any errors
            const fixedCardId = await this.testAndFixCard(created.id, migratedQuery);

            // Save the mapping
            await this.cardIdMapping.set(card.id, fixedCardId);

            return {
                status: 'ok',
                newId: fixedCardId,
                cardUrl: `${config.metabaseBaseUrl}/question/${fixedCardId}`,
                originalQuery: card.dataset_query,
                migratedQuery,
                warnings
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
                status: 'failed',
                errorCode: MigrationErrorCode.UNKNOWN_ERROR,
                message: message,
                originalQuery: card.dataset_query
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
                migrated: results.filter(r => r.status === 'ok').length,
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
        this.mapper.missingTables.forEach(table => {
            const t = oldTablesByName.get(`${table.schema}.${table.sourceTableName}`);
            if (t) {
                context.push(`${table.schema}.${table.sourceTableName} (ID: ${t.id})`);
                context.push(`  Columns: ${t.fields.map((f: any) => `${f.name}:${f.base_type}`).join(', ')}`);
            } else {
                context.push(`${table.schema}.${table.sourceTableName}`);
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

    getCardIdMapping() {
        return this.cardIdMapping;
    }
}
