import fs from 'fs-extra';

async function autoConfirmHighConfidence() {
    const filePath = 'table_mapping_workflow.json';

    console.log('Reading table mapping workflow...');
    const mappings = await fs.readJson(filePath);

    let confirmed = 0;
    let total = mappings.length;

    for (const mapping of mappings) {
        if (mapping.confidence > 0.94) {
            mapping.confirmed = true;
            mapping.final_new_table_id = mapping.suggested_new_table_id;
            confirmed++;
            console.log(`Auto-confirmed: ${mapping.old_table_name} -> ${mapping.suggested_new_table_name} (${(mapping.confidence * 100).toFixed(1)}%)`);
        }
    }

    await fs.writeJson(filePath, mappings, { spaces: 2 });

    console.log(`\nComplete!`);
    console.log(`   Confirmed: ${confirmed}/${total} mappings (${((confirmed / total) * 100).toFixed(1)}%)`);
    console.log(`   Remaining: ${total - confirmed} mappings need manual review`);
    console.log(`\nUpdated file: ${filePath}`);
}

autoConfirmHighConfidence().catch(console.error);
