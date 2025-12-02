// Vercel Serverless Function Entry Point
import { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import cors from 'cors';
import { MigrationManager } from '../src/services/MigrationManager';
import { MetabaseClient } from '../src/services/MetabaseClient';
import { config } from '../src/config';
import { storage } from '../src/services/StorageService';
import fs from 'fs-extra';

const app = express();

app.use(cors());
app.use(express.json());

// Global state
let manager: MigrationManager | null = null;

const ensureInitialized = async (): Promise<MigrationManager> => {
    if (!manager) {
        // MigrationManager now initializes its own client internally or we can pass one if needed,
        // but the constructor takes 0 arguments in the current implementation.
        // However, we might want to pass config if the constructor supports it.
        // Checking MigrationManager.ts, constructor takes 0 args.
        manager = new MigrationManager();
        await manager.initialize();
    }
    return manager;
};

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

// Test endpoint
app.get('/api/test', (_req, res) => {
    console.log('🔥 TEST ENDPOINT HIT - SERVER IS RUNNING! 🔥');
    res.json({
        message: 'SERVER IS WORKING!',
        timestamp: new Date().toISOString()
    });
});

// GET /api/status
app.get('/api/status', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const mapper = mgr.getMapper();

        res.json({
            initialized: true,
            tablesMapped: Object.keys(mapper.tableMap).length,
            fieldsMapped: Object.keys(mapper.fieldMap).length,
            missingTables: mgr.getMissingTables().length
        });
    } catch (error: any) {
        console.error('Status endpoint error:', error);
        res.status(500).json({ error: error.message || 'Failed to get status' });
    }
});

// GET /api/cards/:dbId
app.get('/api/cards/:dbId', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const dbId = parseInt(req.params.dbId, 10);
        const allCards = await mgr.getClient().getAllCards();
        const filtered = allCards.filter((c: any) => c.dataset_query?.database === dbId);

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

// POST /api/preview/:cardId
app.post('/api/preview/:cardId', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const cardId = parseInt(req.params.cardId, 10);

        console.log(`\n========================================`);
        console.log(`Preview request for card ${cardId}`);
        console.log(`========================================`);

        const result = await mgr.migrateCardWithDependencies(cardId, true, new Set(), null, false);

        console.log('Migration result:', JSON.stringify(result, null, 2));

        // Transform to match frontend CardPreview interface
        const preview = {
            cardId: result.oldId || cardId,
            cardName: result.cardName || `Card ${cardId}`,
            original: result.originalQuery || {},
            migrated: result.migratedQuery || null,
            warnings: result.warnings || [],
            errors: result.errors || [],
            status: result.status,
            newId: result.newId,
            cardUrl: result.cardUrl
        };

        console.log('Sending preview response:', JSON.stringify(preview, null, 2));

        res.json(preview);
    } catch (error: any) {
        console.error('Preview error:', error);
        res.status(500).json({
            error: error.message,
            cardId: parseInt(req.params.cardId, 10),
            cardName: `Card ${req.params.cardId}`,
            original: {},
            migrated: null,
            warnings: [],
            errors: [error.message]
        });
    }
});

// POST /api/migrate/:id
app.post('/api/migrate/:id', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const cardId = parseInt(req.params.id, 10);
        const dryRun = req.body.dryRun !== false;
        const collectionId = req.body.collection_id || null;
        const force = req.body.force === true;

        console.log(`\n========================================`);
        console.log(`Migration request for card ${cardId} (dry-run: ${dryRun}, force: ${force})`);
        if (collectionId) console.log(`Target collection: ${collectionId}`);
        console.log(`========================================`);

        const result = await mgr.migrateCardWithDependencies(cardId, dryRun, new Set(), collectionId, force);

        res.json(result);
    } catch (error: any) {
        console.error('Migration error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/table-mappings
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
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/table-mappings/:oldId
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

// Export for Vercel
export default app;
