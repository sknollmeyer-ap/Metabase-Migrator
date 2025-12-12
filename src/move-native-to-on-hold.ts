
import { MetabaseClient } from './services/MetabaseClient';
import { CardDependencyResolver } from './services/CardDependencyResolver';
import { storage } from './services/StorageService';
import { config } from './config';

async function moveNativeToOnHold() {
    console.log('Initializing...');
    const client = new MetabaseClient();

    // 1. Fetch all cards
    console.log('Fetching all cards from Metabase...');
    const allCards = await client.getAllCards();
    console.log(`Fetched ${allCards.length} cards.`);

    const cardsById = new Map(allCards.map((c: any) => [c.id, c]));

    // 2. Identify Native SQL cards
    const nativeCardIds = new Set<number>();
    allCards.forEach((card: any) => {
        if (card.dataset_query && card.dataset_query.type === 'native') {
            nativeCardIds.add(card.id);
        }
    });
    console.log(`Found ${nativeCardIds.size} native SQL cards.`);

    // 3. Build Dependents Graph (Provider -> Consumers)
    const dependentsGraph = new Map<number, number[]>();

    // Initialize graph
    allCards.forEach((card: any) => {
        const deps = CardDependencyResolver.extractCardReferences(card.dataset_query);
        deps.forEach((depId) => {
            if (!dependentsGraph.has(depId)) {
                dependentsGraph.set(depId, []);
            }
            dependentsGraph.get(depId)!.push(card.id);
        });
    });

    // 4. Propagate "On Hold" status
    const onHoldSet = new Set<number>(nativeCardIds);
    const queue = Array.from(nativeCardIds);

    while (queue.length > 0) {
        const currentId = queue.shift()!;

        // Find who depends on this card
        const consumers = dependentsGraph.get(currentId) || [];

        for (const consumerId of consumers) {
            if (!onHoldSet.has(consumerId)) {
                // If the consumer is in our known cards list (just to be safe)
                if (cardsById.has(consumerId)) {
                    onHoldSet.add(consumerId);
                    queue.push(consumerId);
                    // console.log(`Card ${consumerId} (${cardsById.get(consumerId).name}) is on hold because it depends on ${currentId}`);
                }
            }
        }
    }

    console.log(`Total cards identified to be ON HOLD: ${onHoldSet.size}`);

    if (onHoldSet.size === 0) {
        console.log('No cards to put on hold.');
        return;
    }

    // 5. Get existing on-hold cards (to merge, or should we overwrite? User said "move...", implying these should be added or set)
    // Let's assume we want to ensure these are on hold. Merging seems safer.
    const EXISTING_KEY = 'on_hold_cards'; // Changed to match likely convention or new key
    let existingOnHold: number[] = [];
    try {
        const stored = await storage.getState<number[]>(EXISTING_KEY);
        if (Array.isArray(stored)) {
            existingOnHold = stored;
        }
    } catch (e) {
        console.warn('Could not read existing existing on-hold state, starting fresh.');
    }

    // Merge
    const finalSet = new Set([...existingOnHold, ...onHoldSet]);
    const finalList = Array.from(finalSet).sort((a, b) => a - b);

    console.log(`Updating Supabase with ${finalList.length} on-hold cards (merged with existing)...`);

    await storage.setState(EXISTING_KEY, finalList);
    console.log('✅ Successfully updated Supabase with on-hold cards.');

    // Also verify what we did by reading it back?
    // const verify = await storage.getState(EXISTING_KEY);
    // console.log('Current state in DB:', verify?.length);
}

moveNativeToOnHold().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
