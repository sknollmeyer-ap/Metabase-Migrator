import express from 'express';
import cors from 'cors';
import { MigrationManager } from './services/MigrationManager';
import { MetabaseClient } from './services/MetabaseClient';
import { config } from './config';
import { storage } from './services/StorageService';
import { CardDependencyResolver } from './services/CardDependencyResolver';
import fs from 'fs-extra';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Global state
let manager: MigrationManager | null = null;
let initPromise: Promise<MigrationManager> | null = null;
const MIGRATION_TIMEOUT_MS = parseInt(process.env.MIGRATION_TIMEOUT_MS || '300000', 10); // 5 minutes
const PREVIEW_TIMEOUT_MS = parseInt(process.env.PREVIEW_TIMEOUT_MS || '120000', 10); // 2 minutes
const INITIALIZATION_TIMEOUT_MS = parseInt(process.env.INIT_TIMEOUT_MS || '30000', 10); // 30 seconds

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage = 'TIMEOUT'): Promise<T> {
    return await Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs))
    ]);
}

// Initialize on first request
async function ensureInitialized() {
    if (manager) return manager;

    if (!initPromise) {
        initPromise = (async () => {
            console.log('Initializing migration manager (cold start)...');
            const mgr = new MigrationManager();
            await mgr.initialize();
            manager = mgr;
            console.log('Initialization complete');
            return mgr;
        })();
    }

    try {
        return await withTimeout(initPromise, INITIALIZATION_TIMEOUT_MS, 'INIT_TIMEOUT');
    } catch (err) {
        // Reset so next request can try again
        initPromise = null;
        manager = null;
        throw err;
    }
}

// Lightweight health endpoint for connectivity checks
app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

// Test endpoint to verify new server is running
app.get('/api/test', (_req, res) => {
    console.log('🔥 TEST ENDPOINT HIT - NEW SERVER IS RUNNING! 🔥');
    res.json({
        message: 'NEW SERVER IS WORKING!',
        port: 3000,
        timestamp: new Date().toISOString()
    });
});

// GET /api/status
app.get('/api/status', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        res.json({
            initialized: !!manager,
            tablesMapped: Object.keys(mgr.getTableMap()).length,
            fieldsMapped: Object.keys(mgr.getFieldMap()).length,
            missingTables: mgr.getMissingTables().length
        });
    } catch (error: any) {
        console.error('Status endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load status' });
    }
});

// GET /api/cards - List cards (optionally filter by db id)
app.get('/api/cards', async (req, res) => {
    try {
        const dbId = req.query.db ? parseInt(req.query.db as string, 10) : config.oldDbId;
        const client = new MetabaseClient();
        const cards = await client.getAllCards();
        const filtered = Array.isArray(cards)
            ? cards.filter((c: any) => c.dataset_query?.database === dbId)
            : [];
        res.json(filtered.map((c: any) => ({
            id: c.id,
            name: c.name,
            database_id: c.dataset_query?.database,
            collection_id: c.collection_id
        })));
    } catch (error: any) {
        console.error('Cards endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load cards' });
    }
});

// GET /api/card-mappings - Get all card ID mappings
app.get('/api/card-mappings', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        // Access public getter (will be added to MigrationManager)
        const mappings = mgr.getCardIdMapping().getAll();

        // Convert Map to array of objects
        const result = Array.from(mappings.entries()).map(([oldId, newId]) => ({
            oldId,
            newId,
            cardUrl: `${mgr.getClient().getBaseUrl()}/question/${newId}`
        }));

        res.json(result);
    } catch (error: any) {
        console.error('Card mappings endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load card mappings' });
    }
});

// POST /api/preview/:cardId - Preview migration (dry-run)
app.post('/api/preview/:cardId', async (req, res) => {
    const cardId = parseInt((req.params as any).cardId, 10);
    try {
        const mgr = await ensureInitialized();

        console.log(`\n========================================`);
        console.log(`Preview request for card ${cardId}`);
        console.log(`========================================`);

        const result = await withTimeout(
            mgr.migrateCardWithDependencies(cardId, true, new Set(), null, false),
            PREVIEW_TIMEOUT_MS
        );

        console.log('Migration result:', JSON.stringify(result, null, 2));

        // Return the result directly as it matches MigrationResponse interface
        res.json(result);
    } catch (error: any) {
        console.error('Preview error:', error);

        if (error?.message === 'INIT_TIMEOUT') {
            return res.status(503).json({
                status: 'failed',
                errorCode: 'INIT_TIMEOUT',
                message: 'Server is still warming up (metadata load). Please retry in a few seconds.',
                oldId: cardId,
                cardName: `Card ${cardId}`,
                originalQuery: {},
                migratedQuery: null,
                warnings: [],
                errors: ['Initialization timeout']
            });
        }

        if (error?.message === 'TIMEOUT') {
            return res.status(504).json({
                status: 'failed',
                errorCode: 'TIMEOUT',
                message: 'Preview timed out. Please try again or run the migration locally for complex queries.',
                oldId: cardId,
                cardName: `Card ${cardId}`,
                originalQuery: {},
                migratedQuery: null,
                warnings: [],
                errors: ['Preview exceeded the timeout limit']
            });
        }

        res.status(500).json({
            status: 'failed',
            errorCode: 'UNKNOWN_ERROR',
            message: error.message,
            oldId: cardId,
            cardName: `Card ${cardId}`,
            originalQuery: {},
            migratedQuery: null,
            warnings: [],
            errors: [error.message]
        });
    }
});

// POST /api/migrate/:id - Actually perform migration
app.post('/api/migrate/:id', async (req, res) => {
    const cardId = parseInt(req.params.id, 10);
    try {
        const mgr = await ensureInitialized();
        const dryRun = req.body.dryRun !== false; // default to true
        const collectionId = req.body.collection_id || null; // optional collection override
        const force = req.body.force === true; // optional force override

        console.log(`\n========================================`);
        console.log(`Migration request for card ${cardId} (dry-run: ${dryRun}, force: ${force})`);
        if (collectionId) console.log(`Target collection: ${collectionId}`);
        console.log(`========================================`);

        const result = await withTimeout(
            mgr.migrateCardWithDependencies(cardId, dryRun, new Set(), collectionId, force),
            MIGRATION_TIMEOUT_MS
        );

        console.log('Migration result:', JSON.stringify(result, null, 2));
        res.json(result);
    } catch (error: any) {
        console.error('Migration error:', error);

        if (error?.message === 'INIT_TIMEOUT') {
            return res.status(503).json({
                status: 'failed',
                errorCode: 'INIT_TIMEOUT',
                message: 'Server is still warming up (metadata load). Please retry in a few seconds.',
                oldId: cardId,
                cardName: `Card ${cardId}`,
                originalQuery: {},
                migratedQuery: null,
                warnings: [],
                errors: ['Initialization timeout']
            });
        }

        if (error?.message === 'TIMEOUT') {
            return res.status(504).json({
                status: 'failed',
                errorCode: 'TIMEOUT',
                message: 'Migration timeout - SQL translation or Metabase API call took too long. Try again or run locally.',
                oldId: cardId,
                cardName: `Card ${cardId}`,
                originalQuery: {},
                migratedQuery: null,
                warnings: [],
                errors: ['Exceeded migration timeout limit']
            });
        }

        res.status(500).json({
            status: 'failed',
            errorCode: 'UNKNOWN_ERROR',
            message: error.message || 'Migration failed with unknown error',
            oldId: cardId,
            cardName: `Card ${cardId}`,
            originalQuery: {},
            migratedQuery: null,
            warnings: [],
            errors: [error.message]
        });
    }
});

// GET /api/report - Get migration report
app.get('/api/report', async (req, res) => {
    try {
        const reportPath = 'migration_report.json';
        if (await fs.pathExists(reportPath)) {
            const report = await fs.readJson(reportPath);
            res.json(report);
        } else {
            res.json({ summary: { total: 0, migrated: 0, waiting: 0 }, details: [] });
        }
    } catch (error: any) {
        console.error('Report endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load report' });
    }
});

// GET /api/mappings - Get card ID mappings
app.get('/api/mappings', async (req, res) => {
    try {
        const mappings = await storage.getCardMappings();
        res.json(Object.fromEntries(mappings));
    } catch (error: any) {
        console.error('Mappings endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load mappings' });
    }
});

// GET /api/table-mappings - Get all table mappings
app.get('/api/table-mappings', async (req, res) => {
    try {
        const rawMappings = await storage.getTableMappings();
        const mappings = rawMappings.map((m: any) => ({
            ...m,
            confirmed: m.confirmed === true,
            ignored: m.ignored === true
        }));

        const confirmed = req.query.confirmed;
        const ignored = req.query.ignored;

        let filtered = mappings;
        if (confirmed === 'true') {
            filtered = filtered.filter((m: any) => m.confirmed === true);
        } else if (confirmed === 'false') {
            filtered = filtered.filter((m: any) => m.confirmed !== true);
        }

        if (ignored === 'true') {
            filtered = filtered.filter((m: any) => m.ignored === true);
        } else if (ignored === 'false') {
            filtered = filtered.filter((m: any) => m.ignored !== true);
        }

        res.json(filtered);
    } catch (error: any) {
        console.error('Table mappings endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load table mappings' });
    }
});

// PUT /api/table-mappings/:oldId - Update a specific table mapping
app.put('/api/table-mappings/:oldId', async (req, res) => {
    try {
        const oldId = parseInt(req.params.oldId, 10);
        const { confirmed, final_new_table_id, ignored } = req.body;

        const updated = await storage.updateTableMapping(oldId, {
            confirmed,
            final_new_table_id,
            ignored: ignored === true
        });

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/field-mappings - Manually override a field mapping
app.post('/api/field-mappings', async (req, res) => {
    try {
        const { old_field_id, new_field_id } = req.body;
        if (typeof old_field_id !== 'number' || typeof new_field_id !== 'number') {
            return res.status(400).json({ error: 'old_field_id and new_field_id are required numbers' });
        }
        const mgr = await ensureInitialized();
        await mgr.setFieldOverride(old_field_id, new_field_id);
        res.json({ old_field_id, new_field_id, status: 'ok' });
    } catch (error: any) {
        console.error('Field mapping override error:', error);
        res.status(500).json({ error: error.message || 'Failed to set field override' });
    }
});

// GET /api/field-candidates/:oldFieldId - Get candidate new fields for an old field
app.get('/api/field-candidates/:oldFieldId', async (req, res) => {
    try {
        const oldFieldId = parseInt(req.params.oldFieldId, 10);
        if (Number.isNaN(oldFieldId)) {
            return res.status(400).json({ error: 'oldFieldId must be a number' });
        }
        const mgr = await ensureInitialized();
        const candidates = mgr.getFieldCandidates(oldFieldId) || [];
        res.json(candidates);
    } catch (error: any) {
        console.error('Field candidates error:', error);
        res.status(500).json({ error: error.message || 'Failed to load field candidates' });
    }
});

// POST /api/suggest-field-mapping - Get AI suggestion for a field mapping
app.post('/api/suggest-field-mapping', async (req, res) => {
    try {
        const { old_field_id } = req.body;
        if (typeof old_field_id !== 'number') {
            return res.status(400).json({ error: 'old_field_id is required and must be a number' });
        }
        const mgr = await ensureInitialized();
        const suggestion = await mgr.suggestFieldMapping(old_field_id);
        res.json(suggestion || { found: false });
    } catch (error: any) {
        console.error('Field suggestion error:', error);
        res.status(500).json({ error: error.message || 'Failed to get suggestion' });
    }
});

// GET /api/metadata/tables - Get all tables for a database
app.get('/api/metadata/tables', async (req, res) => {
    try {
        const dbId = parseInt(req.query.databaseId as string, 10);
        if (isNaN(dbId)) {
            return res.status(400).json({ error: 'databaseId is required' });
        }

        const mgr = await ensureInitialized();
        const client = mgr.getClient();
        const metadata = await client.getDatabaseMetadata(dbId);

        const tables = (metadata.tables || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            schema: t.schema,
            display_name: t.display_name
        }));

        res.json(tables);
    } catch (error: any) {
        console.error('Metadata tables error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/metadata/fields - Get all fields for a table
app.get('/api/metadata/fields', async (req, res) => {
    try {
        const dbId = parseInt(req.query.databaseId as string, 10);
        const tableId = parseInt(req.query.tableId as string, 10);

        if (isNaN(dbId) || isNaN(tableId)) {
            return res.status(400).json({ error: 'databaseId and tableId are required' });
        }

        const mgr = await ensureInitialized();
        const client = mgr.getClient();

        // We might need to fetch full DB metadata if getTable doesn't exist or is slow
        // But getDatabaseMetadata is cached usually
        const metadata = await client.getDatabaseMetadata(dbId);
        const table = metadata.tables?.find((t: any) => t.id === tableId);

        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }

        const fields = (table.fields || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            display_name: f.display_name,
            base_type: f.base_type,
            table_id: tableId
        }));

        res.json(fields);
    } catch (error: any) {
        console.error('Metadata fields error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/mappings/table - Manually set table mapping
app.post('/api/mappings/table', async (req, res) => {
    try {
        const { sourceTableId, targetTableId } = req.body;
        if (typeof sourceTableId !== 'number' || typeof targetTableId !== 'number') {
            return res.status(400).json({ error: 'sourceTableId and targetTableId are required numbers' });
        }

        const mgr = await ensureInitialized();
        await mgr.getMapper().setTableMapping(sourceTableId, targetTableId);

        res.json({ status: 'ok', sourceTableId, targetTableId });
    } catch (error: any) {
        console.error('Table mapping error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/mappings/field - Manually set field mapping
app.post('/api/mappings/field', async (req, res) => {
    try {
        const { sourceFieldId, targetFieldId } = req.body;
        if (typeof sourceFieldId !== 'number' || typeof targetFieldId !== 'number') {
            return res.status(400).json({ error: 'sourceFieldId and targetFieldId are required numbers' });
        }

        const mgr = await ensureInitialized();
        await mgr.setFieldOverride(sourceFieldId, targetFieldId);

        res.json({ status: 'ok', sourceFieldId, targetFieldId });
    } catch (error: any) {
        console.error('Field mapping error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/on-hold - Get list of on-hold card IDs
app.get('/api/on-hold', async (req, res) => {
    try {
        const ids = await storage.getState<number[]>('on_hold_cards');
        res.json(ids || []);
    } catch (error: any) {
        console.error('On-hold endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to load on-hold cards' });
    }
});

// POST /api/on-hold - Update list of on-hold card IDs
app.post('/api/on-hold', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'ids must be an array of numbers' });
        }
        await storage.setState('on_hold_cards', ids);
        res.json({ status: 'ok', count: ids.length });
    } catch (error: any) {
        console.error('On-hold update error:', error);
        res.status(500).json({ error: error.message || 'Failed to update on-hold cards' });
    }
});

// POST /api/reinitialize - Force reload of metadata
app.post('/api/reinitialize', async (req, res) => {
    try {
        console.log('Force reinitializing migration manager...');
        manager = null;
        initPromise = null;
        const mgr = await ensureInitialized();
        await updateGlobalOnHoldList(mgr);
        res.json({ status: 'ok', message: 'Migration manager reinitialized and On-Hold list updated' });
    } catch (error: any) {
        console.error('Reinitialization error:', error);
        res.status(500).json({ error: error.message || 'Failed to reinitialize' });
    }
});

// Helper to update the global "On Hold" list based on unmigrated native SQL dependencies
async function updateGlobalOnHoldList(mgr: MigrationManager) {
    try {
        console.log('Recalculating On-Hold list...');
        // 1. Get all cards & mappings
        const allCards = await mgr.getClient().getAllCards();
        // Ensure mappings are fresh
        await mgr.getCardIdMapping().load();
        const mappings = mgr.getCardIdMapping().getAll();

        // 2. Identify UNMAPPED native SQL cards
        const unmappedNativeIds = new Set<number>();
        for (const card of allCards) {
            if (card.dataset_query?.type === 'native' && !mappings.has(card.id)) {
                unmappedNativeIds.add(card.id);
            }
        }

        // 3. Find dependents (Consumer -> Provider is standard, we need Provider -> Consumer)
        const reverseGraph = CardDependencyResolver.buildReverseDependencyGraph(allCards);
        const onHold = new Set<number>(unmappedNativeIds);

        // Propagate "On Hold" status to anything that depends on an unmapped native SQL card
        const queue = Array.from(unmappedNativeIds);
        while (queue.length > 0) {
            const id = queue.shift()!;
            const dependents = reverseGraph.get(id) || [];
            for (const depId of dependents) {
                // If it's already mapped, it doesn't need to be on hold even if it depends on something broken (maybe?)
                // User rule: "If the native SQL card is migrated / mapped: The dependent card can proceed"
                // Implicit rule: If the dependent card ITSELF is already migrated, it shouldn't be on hold.
                if (!mappings.has(depId) && !onHold.has(depId)) {
                    onHold.add(depId);
                    queue.push(depId);
                }
            }
        }

        // 4. Save to storage
        const onHoldList = Array.from(onHold).sort((a, b) => a - b);
        await storage.setState('on_hold_cards', onHoldList);
        console.log(`Updated On-Hold list: ${onHoldList.length} cards.`);
        return onHoldList;
    } catch (err) {
        console.error('Failed to update global on-hold list:', err);
        return [];
    }
}

// GET /api/dependencies - Get cards with their dependent counts (Tasks 3)
app.get('/api/dependencies', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const client = new MetabaseClient();
        const allCards = await client.getAllCards();

        // Ensure we have latest mappings to exclude them
        await mgr.getCardIdMapping().load();
        const mappings = mgr.getCardIdMapping().getAll();

        const reverseGraph = CardDependencyResolver.buildReverseDependencyGraph(allCards);

        // Filter: only show cards that HAVE dependents AND are NOT yet mapped
        const meaningful = allCards
            .filter((c: any) => !mappings.has(c.id)) // Task 3: Remove already mapped cards
            .map((c: any) => ({
                id: c.id,
                name: c.name,
                type: c.dataset_query?.type,
                dependentCount: (reverseGraph.get(c.id) || []).length
            }))
            .filter((c: any) => c.dependentCount > 0)
            .sort((a: any, b: any) => b.dependentCount - a.dependentCount);

        res.json(meaningful);
    } catch (error: any) {
        console.error('Dependencies endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/cards/status - Get all cards with their calculated status
app.get('/api/cards/status', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const client = mgr.getClient();

        // Use cached cards if possible? No, we want fresh list usually, but metadata call is heavy.
        // We can trust client.getAllCards() which acts as a proxy (maybe uncached).
        // For performance, we might want to cache this in manager if it's too slow.
        const allCards = await client.getAllCards();

        const statuses = await mgr.getCardStatuses(allCards);
        res.json(statuses);
    } catch (error: any) {
        console.error('Card status endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to calculate card statuses' });
    }
});

// POST /api/migrate/safe-batch - Migrate all "ready" cards safe-to-go
app.post('/api/migrate/safe-batch', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const client = mgr.getClient();
        const allCards = await client.getAllCards();

        const statuses = await mgr.getCardStatuses(allCards);
        const readyCards = statuses.filter(s => s.status === 'ready');

        console.log(`\n=== BATCH MIGRATION START: ${readyCards.length} cards ===`);

        const results = [];
        let successCount = 0;
        let failCount = 0;

        // Process sequentially to respect order/dependencies? 
        // "ready" implies all dependencies are migrated. However, if A depends on B, and both are 'ready'?
        // Impossible. If A depends on B, and B is 'ready' (unmigrated), then A is 'on_hold' (dependency unmigrated).
        // So 'ready' implies leaf nodes of the remaining tree (or independent nodes).
        // So strictly safe to parallelize? Maybe, but Metabase API might rate limit. sequential is safer.

        for (const cardStatus of readyCards) {
            console.log(`Safe-Batch: Migrating card ${cardStatus.id} (${cardStatus.name})...`);
            try {
                // Actually perform migration (force=false, dryRun=false)
                // migrateCardWithDependencies will check dependencies again (should be fine) and perform migration.
                // We pass empty visited set.
                // We use the same timeout logic?
                const result = await withTimeout(
                    mgr.migrateCardWithDependencies(cardStatus.id, false, new Set(), null, false),
                    PREVIEW_TIMEOUT_MS
                );

                results.push({ id: cardStatus.id, status: result.status, result });
                if (result.status === 'ok' || result.status === 'already_migrated') {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err: any) {
                console.error(`Safe-Batch: Failed to migrate ${cardStatus.id}:`, err);
                results.push({ id: cardStatus.id, status: 'failed', error: err.message });
                failCount++;
            }
        }

        console.log(`=== BATCH MIGRATION END: ${successCount} OK, ${failCount} FAILED ===\n`);

        res.json({
            summary: {
                total: readyCards.length,
                success: successCount,
                failed: failCount
            },
            results
        });

    } catch (error: any) {
        console.error('Batch migrate error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/resolve-dependency - Map old card to new card and update state (Tasks 2 & 4)
app.post('/api/resolve-dependency', async (req, res) => {
    try {
        const { oldCardId, newCardId } = req.body;
        if (!oldCardId || !newCardId) {
            return res.status(400).json({ error: 'oldCardId and newCardId are required' });
        }

        const mgr = await ensureInitialized();

        // 1. Save the mapping
        await storage.saveCardMapping(oldCardId, newCardId);

        // 2. Recalculate On Hold List (Dynamic State)
        const newOnHoldList = await updateGlobalOnHoldList(mgr);

        // 3. Identify what was released (for UI feedback)
        // We can't easily track exactly what was released without diffing, but we can return the new list count

        res.json({
            status: 'ok',
            message: 'Dependency resolved and On-Hold list updated',
            onHoldCount: newOnHoldList.length
        });

    } catch (error: any) {
        console.error('Resolve dependency error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Ready to migrate Metabase cards!`);
});
