import fs from 'fs-extra';

const m = fs.readJsonSync('table_mapping_workflow.json');
console.log('Total:', m.length);
console.log('Confirmed:', m.filter((x: any) => x.confirmed === true).length);
console.log('Unconfirmed:', m.filter((x: any) => x.confirmed !== true).length);
console.log('\nFirst unconfirmed:', m.find((x: any) => x.confirmed !== true));
