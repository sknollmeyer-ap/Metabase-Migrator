import { MigrationManager } from './services/MigrationManager';

async function main() {
    const mgr = new MigrationManager();
    await mgr.initialize();

    console.log('\n=== DRY RUN MODE ===\n');

    // Migrate card 4094 with all its dependencies
    const result = await mgr.migrateCardWithDependencies(4094, true);

    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));

    // Generate report
    await mgr.generateReport([result], true);
}

main().catch(console.error);
