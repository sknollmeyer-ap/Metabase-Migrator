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

// GET /api/cards
app.get('/api/cards', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
        const dbId = parseInt(req.query.db as string, 10);
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

// GET /api/card-mappings - Get all card ID mappings
app.get('/api/card-mappings', async (req, res) => {
    try {
        const mgr = await ensureInitialized();
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

// GET /api/metadata/tables
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

// GET /api/metadata/fields
app.get('/api/metadata/fields', async (req, res) => {
    try {
        const dbId = parseInt(req.query.databaseId as string, 10);
        const tableId = parseInt(req.query.tableId as string, 10);

        if (isNaN(dbId) || isNaN(tableId)) {
            return res.status(400).json({ error: 'databaseId and tableId are required' });
        }

        const mgr = await ensureInitialized();
        const client = mgr.getClient();

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

// POST /api/mappings/table
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

// POST /api/mappings/field
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

        // Return the result directly as it matches MigrationResponse interface
        res.json(result);
    } catch (error: any) {
        console.error('Preview error:', error);
        res.status(500).json({
            status: 'failed',
            errorCode: 'UNKNOWN_ERROR',
            message: error.message,
            oldId: parseInt(req.params.cardId, 10),
            cardName: `Card ${req.params.cardId}`,
            originalQuery: {},
            migratedQuery: null,
            warnings: [],
            errors: [error.message]
        });
    }
});

// Export for Vercel serverless
export default async (req: VercelRequest, res: VercelResponse) => {
    // Use the Express app as a request handler
    return new Promise((resolve, reject) => {
        app(req as any, res as any, (err: any) => {
            if (err) {
                reject(err);
            } else {
                resolve(undefined);
            }
        });
    });
};
