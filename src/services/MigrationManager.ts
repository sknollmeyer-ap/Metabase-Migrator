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
import { MigrationResponse, MigrationErrorCode, UnmatchedTable, UnmatchedField, CardStatus, NativeSqlStatus } from '../types';

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
        this.sqlMigrator = new SqlMigrator(this.mapper);
        this.waitingArea = new WaitingArea();
        this.fieldMapperAgent = new FieldMapperAgent(this.mapper);
    }

    async initialize() {
        await this.mapper.buildMaps();
        await this.cardIdMapping.load();
        await this.waitingArea.load();
        this.mbqlMigrator.setCardIdMap(this.cardIdMapping.getAll());
        this.sqlMigrator.setMapper(this.mapper);
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

    public getClient(): MetabaseClient {
        return this.client;
    }

    public getMapper(): MetadataMapper {
        return this.mapper;
    }

    public getCardIdMapping(): CardIdMapping {
        return this.cardIdMapping;
    }

    public getMbqlMigrator(): MbqlMigrator {
        return this.mbqlMigrator;
    }

    async getCardStatuses(cards: any[]): Promise<Array<{ id: number; name: string; status: CardStatus; is_native: boolean }>> {
        const statuses: Array<{ id: number; name: string; status: CardStatus; is_native: boolean }> = [];

        const migratedIds = new Set(this.cardIdMapping.getAll().keys());

        for (const card of cards) {
            let status: CardStatus = 'unmigrated';
            const isNative = card.dataset_query.type === 'native';

            if (migratedIds.has(card.id)) {
                status = 'migrated';
            } else {
                const dependencies = CardDependencyResolver.extractCardReferences(card.dataset_query);
                let depsResolved = true;

                for (const depId of dependencies) {
                    if (!migratedIds.has(depId)) {
                        depsResolved = false;
                        break;
                    }
                }

                if (!depsResolved) {
                    status = 'on_hold';
                } else {
                    status = 'ready';
                }
            }

            statuses.push({
                id: card.id,
                name: card.name,
                status,
                is_native: isNative
            });
        }
        return statuses;
    }

    async migrateCardWithDependencies(cardId: number, dryRun: boolean = true, visited: Set<number> = new Set(), collectionId: number | null = null, force: boolean = false): Promise<MigrationResponse> {
        await this.cardIdMapping.load();
        this.mbqlMigrator.setCardIdMap(this.cardIdMapping.getAll());

        if (visited.has(cardId)) {
            return { status: 'failed', errorCode: MigrationErrorCode.UNKNOWN_ERROR, message: 'Circular dependency detected' };
        }
        visited.add(cardId);

        console.log(`\n=== Migrating card ${cardId} with dependencies ===`);

        let card;
        try {
            card = await this.client.getCard(cardId);
            console.log(`Fetched card: ${card.name} (ID: ${card.id})`);
        } catch (error: any) {
            return { status: 'failed', errorCode: MigrationErrorCode.METABASE_API_ERROR, message: `Failed to fetch card ${cardId}: ${error.message}` };
        }

        const dependencies = CardDependencyResolver.extractCardReferences(card.dataset_query);
        const dependencyResults: any[] = [];

        for (const depId of dependencies) {
            if (!this.cardIdMapping.has(depId)) {
                console.log(`Migrating dependency: card ${depId}`);
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
            }
        }

        if (this.cardIdMapping.has(cardId) && !force) {
            const newCardId = this.cardIdMapping.get(cardId)!;
            console.log(`Card ${cardId} already migrated to ${newCardId}`);
            return {
                status: 'already_migrated',
                oldId: cardId,
                cardName: card.name,
                newId: newCardId,
                originalQuery: card.dataset_query,
                cardUrl: `${this.client.getBaseUrl()}/question/${newCardId}`,
                details: { dependencies: dependencyResults }
            };
        }

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
            let migratedQuery: any;
            let unmatchedTables: UnmatchedTable[] = [];
            let unmatchedFields: UnmatchedField[] = [];
            let isNativeSql = false;
            let autoFixApplied = false;
            let nativeSqlStatus: NativeSqlStatus = 'ok';

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
                isNativeSql = true;
                const sql = card.dataset_query.native?.query || '';
                if (!sql) {
                    return { status: 'failed', errorCode: MigrationErrorCode.UNKNOWN_ERROR, message: 'Native query is empty' };
                }

                // pipeline
                const transformedSql = this.sqlMigrator.applyTransforms(sql);
                let finalSql = transformedSql;

                // Validate using regex heuristic or AI check if we want safety
                // We trust transforms for now.

                migratedQuery = {
                    database: config.newDbId,
                    type: 'native',
                    native: {
                        query: finalSql,
                        'template-tags': card.dataset_query.native?.['template-tags'] || {}
                    }
                };
            } else {
                return { status: 'failed', errorCode: MigrationErrorCode.UNKNOWN_ERROR, message: `Unknown query type: ${card.dataset_query.type}` };
            }

            if (unmatchedTables.length > 0 || unmatchedFields.length > 0) {
                await this.enrichUnmatchedItems(unmatchedTables, unmatchedFields);
            }

            if (unmatchedTables.length > 0) {
                return {
                    status: 'failed',
                    errorCode: MigrationErrorCode.MISSING_MAPPING_TABLE,
                    message: 'Unmatched tables found',
                    unmatchedTables,
                    unmatchedFields,
                    originalQuery: card.dataset_query,
                    migratedQuery
                };
            }

            if (unmatchedFields.length > 0) {
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

            if (dryRun) {
                return {
                    status: 'ok',
                    originalQuery: card.dataset_query,
                    migratedQuery,
                    warnings,
                    isNativeSql,
                    autoFixApplied,
                    nativeSqlStatus
                };
            }

            // Create/Update Logic
            const cardName = card.name.includes('[ClickHouse]') ? card.name : `${card.name} [ClickHouse]`;
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
                    await this.client.updateCard(existingNewId, newCard);
                    created = { id: existingNewId };
                    console.log(`  ✓ Updated card ${created.id}`);
                } else {
                    created = await this.client.createCard(newCard);
                    console.log(`  ✓ Created new card ${created.id}`);
                }
            } catch (err: any) {
                return {
                    status: 'failed',
                    errorCode: MigrationErrorCode.METABASE_API_ERROR,
                    message: `Metabase API error: ${err.message}`,
                    originalQuery: card.dataset_query,
                    migratedQuery
                };
            }

            // Verify
            const fixedCardId = await this.testAndFixCard(created.id, migratedQuery);
            await this.cardIdMapping.set(card.id, fixedCardId);

            return {
                status: 'ok',
                newId: fixedCardId,
                cardUrl: `${config.metabaseBaseUrl}/question/${fixedCardId}`,
                originalQuery: card.dataset_query,
                migratedQuery,
                warnings,
                isNativeSql,
                autoFixApplied,
                nativeSqlStatus
            };
        } catch (error: any) {
            return {
                status: 'failed',
                errorCode: MigrationErrorCode.UNKNOWN_ERROR,
                message: String(error),
                originalQuery: card.dataset_query
            };
        }
    }

    private async enrichUnmatchedItems(tables: UnmatchedTable[], fields: UnmatchedField[]) {
        for (const t of tables) {
            if (t.sourceTableName.startsWith('Table ') || t.sourceTableName === 'Unknown') {
                try {
                    const meta = await this.client.getTableMetadata(t.sourceTableId);
                    if (meta) {
                        t.sourceTableName = meta.display_name || meta.name || t.sourceTableName;
                        if (meta.schema) t.schema = meta.schema;
                    }
                } catch (e) { }
            }
        }
        for (const f of fields) {
            if (f.sourceFieldName.startsWith('Field ') || f.sourceFieldName === 'Unknown' || f.sourceTableName === 'Unknown Table' || f.sourceTableId === 0) {
                try {
                    const meta = await this.client.getField(f.sourceFieldId);
                    if (meta) {
                        f.sourceFieldName = meta.display_name || meta.name || f.sourceFieldName;

                        if (meta.table && meta.table.name) {
                            f.sourceTableName = meta.table.display_name || meta.table.name;
                            f.sourceTableId = meta.table.id;
                            if (meta.table.schema) {
                                f.sourceTableName = `${meta.table.schema}.${f.sourceTableName}`;
                            }
                        } else if (meta.table_id) {
                            f.sourceTableId = meta.table_id;
                            try {
                                const tableMeta = await this.client.getTableMetadata(meta.table_id);
                                if (tableMeta) {
                                    const tableName = tableMeta.display_name || tableMeta.name;
                                    f.sourceTableName = tableMeta.schema ? `${tableMeta.schema}.${tableName}` : tableName;
                                }
                            } catch (err) {
                                console.warn(`Could not fetch table ${meta.table_id} for field ${f.sourceFieldId}`);
                            }
                        }

                        // Ensure populate candidates if possible now that we know the table
                        if (f.sourceTableId) {
                            await this.mapper.ensureCandidates(f.sourceFieldId, f.sourceTableId);
                        }
                    }
                } catch (e) {
                    // console.warn(`Could not fetch field metadata for ${f.sourceFieldId}`, e);
                }
            }
        }
    }

    private async testAndFixCard(cardId: number, originalQuery: any, maxRetries: number = 3): Promise<number> {
        console.log(`  Testing card ${cardId}...`);
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const queryResult = await this.client.queryCard(cardId);
                if (queryResult.error) throw new Error(queryResult.error);
                console.log(`  ✓ Card ${cardId} executed successfully!`);
                return cardId;
            } catch (error: any) {
                const errorMessage = error?.response?.data?.message || error?.message || String(error);
                console.log(`  ✗ Card ${cardId} failed (attempt ${attempt}/${maxRetries}): ${errorMessage}`);

                if (attempt === maxRetries) return cardId;

                if (originalQuery.type !== 'native' || !originalQuery.native?.query) return cardId;

                const context = await this.buildSqlContext();
                const fixedSQL = await this.sqlMigrator.fixWithAI(originalQuery.native.query, originalQuery.native.query, errorMessage, context);

                if (!fixedSQL) {
                    console.log(`  AI couldn't fix the error.`);
                    return cardId;
                }

                console.log(`  Updating card ${cardId} with corrected SQL...`);
                await this.client.updateCard(cardId, {
                    dataset_query: {
                        ...originalQuery,
                        native: { ...originalQuery.native, query: fixedSQL }
                    }
                });
            }
        }
        return cardId;
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

        try {
            const oldDbMetadata = await this.client.getDatabaseMetadata(config.oldDbId);
            const newDbMetadata = await this.client.getDatabaseMetadata(config.newDbId);

            const oldTablesById = new Map(oldDbMetadata.tables.map((t: any) => [t.id, t]));
            const newTablesById = new Map(newDbMetadata.tables.map((t: any) => [t.id, t]));

            const oldTablesByName = new Map<string, any>();
            oldDbMetadata.tables.forEach((t: any) => {
                oldTablesByName.set(`${t.schema}.${t.name}`, t);
            });

            for (const [oldId, newId] of Object.entries(this.mapper.tableMap)) {
                const oldTable: any = oldTablesById.get(Number(oldId));
                const newTable: any = newTablesById.get(Number(newId));

                if (!oldTable || !newTable) continue;

                context.push(`OLD TABLE: ${oldTable.schema}.${oldTable.name} (ID: ${oldId})`);
                context.push(`  Columns: ${oldTable.fields?.map((f: any) => `${f.name}:${f.base_type}`).join(', ') || ''}`);
                context.push(`  ↓ MAPS TO ↓`);
                context.push(`NEW TABLE: ${newTable.schema}.${newTable.name} (ID: ${newId})`);
                context.push(`  Columns: ${newTable.fields?.map((f: any) => `${f.name}:${f.base_type}`).join(', ') || ''}`);
                context.push('');
            }
        } catch (e) {
            console.warn('Error building full SQL context:', e);
        }

        return context.join('\n');
    }

    getTableMap() { return this.mapper.tableMap; }
    getFieldMap() { return this.mapper.fieldMap; }
    getMissingTables() { return this.mapper.missingTables; }
    async setFieldOverride(oldFieldId: number, newFieldId: number) { await this.mapper.setFieldOverride(oldFieldId, newFieldId); }
    getFieldCandidates(oldFieldId: number) { return this.mapper.getFieldCandidates(oldFieldId); }
    async suggestFieldMapping(oldFieldId: number) { return this.fieldMapperAgent.suggestMapping(oldFieldId); }

    private cleanVisualizationSettings(settings: any): any {
        if (!settings) return {};
        const clean = { ...settings };
        if (clean.column_settings) delete clean.column_settings;
        if (clean['table.columns']) delete clean['table.columns'];
        if (clean['graph.dimensions']) delete clean['graph.dimensions'];
        if (clean['graph.metrics']) delete clean['graph.metrics'];
        if (clean.click_behavior) delete clean.click_behavior;
        return clean;
    }
}
