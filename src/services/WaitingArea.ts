import { storage } from './StorageService';

export interface WaitingItem {
    cardId: number;
    cardName: string;
    reason: string;
    missingTables: string[];
    timestamp: string;
}

export class WaitingArea {
    private items: WaitingItem[] = [];
    private storageKey = 'waiting_questions';

    constructor() { }

    add(item: WaitingItem) {
        this.items.push(item);
    }

    getAll(): WaitingItem[] {
        return this.items;
    }

    async save() {
        try {
            await storage.setState(this.storageKey, this.items);
            console.log(`Saved ${this.items.length} waiting items to storage`);
        } catch (error) {
            console.error('Failed to save waiting items:', error);
        }
    }

    async load() {
        try {
            const items = await storage.getState<WaitingItem[]>(this.storageKey);
            if (items) {
                this.items = items;
            }
        } catch (error) {
            console.error('Failed to load waiting items:', error);
        }
    }
}
