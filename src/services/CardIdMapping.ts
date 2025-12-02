import { storage } from './StorageService';

export class CardIdMapping {
    private mapping: Map<number, number>;

    constructor() {
        this.mapping = new Map();
    }

    async load() {
        try {
            this.mapping = await storage.getCardMappings();
            console.log(`Loaded ${this.mapping.size} card ID mappings`);
        } catch (error) {
            console.error('Error loading card ID mapping:', error);
        }
    }

    async save() {
        // No-op: Individual saves happen in set()
        // This is kept for backward compatibility
    }

    async set(oldId: number, newId: number) {
        this.mapping.set(oldId, newId);
        try {
            await storage.saveCardMapping(oldId, newId);
        } catch (error) {
            console.error(`Error saving card mapping ${oldId} -> ${newId}:`, error);
        }
    }

    get(oldId: number): number | undefined {
        return this.mapping.get(oldId);
    }

    has(oldId: number): boolean {
        return this.mapping.has(oldId);
    }

    getAll(): Map<number, number> {
        return new Map(this.mapping);
    }

    clear() {
        this.mapping.clear();
    }
}
