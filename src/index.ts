import { MigrationManager } from './services/MigrationManager';

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--apply');
    const targetCardIdArg = args.find(arg => arg.startsWith('--card='));
    const targetCardId = targetCardIdArg ? parseInt(targetCardIdArg.split('=')[1], 10) : undefined;

    const manager = new MigrationManager();
    await manager.run(dryRun, targetCardId);
}

main().catch(console.error);
