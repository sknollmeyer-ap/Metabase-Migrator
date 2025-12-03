// Test the migrated SQL for card 1774
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const migratedSql = `SELECT 
    inv.ALT_INVOICE_ID AS ALT_INVOICE_ID,
    inv.PARTNER_ID AS PARTNER_ID, 
    inv.CUSTOMER_ID AS CUSTOMER_ID, 
    inv.CREATED_BY_CUSTOMER AS CREATED_BY_CUSTOMER, 
    inv.AMOUNT / 100 AS AMOUNT, 
    inv.DUE_DATE AS DUE_DATE, 
    inv.PRODUCT_NAME AS PRODUCT_NAME, 
    inv.INVOICE_NUMBER AS INVOICE_NUMBER, 
    inv.EXTERNAL_ID AS EXTERNAL_ID, 
    inv.EXTERNAL_TYPE AS EXTERNAL_TYPE, 
    inv.EXTERNAL_INVOICE_NUMBER AS EXTERNAL_INVOICE_NUMBER,
    inv.RECURRING_PAYMENT_ID AS RECURRING_PAYMENT_ID,
    inv.LAST_STATUS AS LAST_STATUS,
    inv.LAST_REMINDED_AT AS LAST_REMINDED_AT,
    inv.SVC_CREATED_AT AS SVC_CREATED_AT,
    inv.SVC_UPDATED_AT AS SVC_UPDATED_AT,
    part.NAME AS Partner__NAME,
    cust.NAME AS Customer__NAME,
    toDate(today()) AS Today,
    toInt64(dateDiff('day', inv.DUE_DATE, toDate(today()))) AS AR_AGING_TIME
FROM 
    default.alt_invoice_invoices inv
LEFT JOIN 
    default.alt_partner_partners part ON part.id = inv.PARTNER_ID
LEFT JOIN 
    default.alt_customer_customers cust ON cust.id = inv.CUSTOMER_ID
WHERE 
    inv.LAST_STATUS = 'overdue'
LIMIT 10`;

async function testSql() {
    const metabaseUrl = process.env.METABASE_BASE_URL;
    const apiKey = process.env.METABASE_API_KEY;
    const newDbId = parseInt(process.env.NEW_DB_ID || '10');

    if (!metabaseUrl || !apiKey) {
        throw new Error('Missing METABASE_BASE_URL or METABASE_API_KEY in .env');
    }

    console.log('✅ Using Metabase API Key\n');
    console.log('🔍 Testing migrated SQL against ClickHouse (DB ID: ' + newDbId + ')...\n');
    console.log('SQL Query:');
    console.log('----------------------------------------');
    console.log(migratedSql);
    console.log('----------------------------------------\n');

    try {
        const queryResponse = await axios.post(
            `${metabaseUrl}/api/dataset`,
            {
                database: newDbId,
                type: 'native',
                native: {
                    query: migratedSql
                }
            },
            {
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ SQL executed successfully!');
        console.log(`📊 Rows returned: ${queryResponse.data.row_count || 0}`);
        console.log(`📋 Columns: ${queryResponse.data.data?.cols?.length || 0}`);

        if (queryResponse.data.data?.cols) {
            console.log('\nColumn names:');
            queryResponse.data.data.cols.forEach((col: any, idx: number) => {
                console.log(`  ${idx + 1}. ${col.name} (${col.base_type})`);
            });
        }

        if (queryResponse.data.data?.rows && queryResponse.data.data.rows.length > 0) {
            console.log(`\nFirst row sample:`);
            console.log(JSON.stringify(queryResponse.data.data.rows[0], null, 2));
        }

    } catch (error: any) {
        console.error('❌ SQL execution failed!');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Error:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
        throw error;
    }
}

testSql().catch(console.error);
