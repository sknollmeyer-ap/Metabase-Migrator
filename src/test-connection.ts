import { MetabaseClient } from './services/MetabaseClient';

async function main() {
    const client = new MetabaseClient();
    console.log('Testing connection...');
    const connected = await client.validateConnection();

    if (connected) {
        console.log('Connection successful!');

        try {
            console.log('Fetching card 4094...');
            const card = await client.getCard(4094);
            console.log('Card fetched successfully:');
            console.log(JSON.stringify(card.dataset_query, null, 2));
        } catch (error) {
            console.error('Failed to fetch card 4094');
        }
    } else {
        console.error('Connection failed.');
    }
}

main();
