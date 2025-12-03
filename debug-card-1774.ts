import { MigrationManager } from './src/services/MigrationManager';
import { config } from './src/config';

async function debugCard() {
    console.log('Initializing MigrationManager...');
    const mgr = new MigrationManager();
    await mgr.initialize();

    const cardId = 1774;
    console.log(`\nFetching card ${cardId}...`);

    try {
        const card = await mgr.getClient().getCard(cardId);
        console.log(`Card Name: ${card.name}`);
        console.log(`Query Type: ${card.dataset_query.type}`);

        if (card.dataset_query.type === 'native') {
            const sql = card.dataset_query.native?.query;
            console.log('\nOriginal SQL:');
            console.log('----------------------------------------');
            console.log(sql);
            console.log('----------------------------------------');

            console.log('\nAttempting migration...');
            const result = await mgr.migrateCardWithDependencies(cardId, true); // dryRun = true

            console.log('\nMigration Result:');
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('Card is not a native query.');
        }

    } catch (error: any) {
        console.error('Error:', error);
    }
}

debugCard();
