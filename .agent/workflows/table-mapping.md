---
description: Create table mapping between Postgres (DB 6) and ClickHouse (DB 10)
---

# Table Mapping Workflow

This workflow uses AI embeddings to intelligently suggest table mappings between databases.

## Step 1: Generate Table Mapping Suggestions

// turbo
```bash
npm run map-tables
```

This will:
- Fetch all tables from both databases
- Generate embeddings using Gemini's `text-embedding-004` model
- Calculate semantic similarity between tables
- Output two files:
  - `table_mapping_report.md` - Human-readable ranked suggestions
  - `table_mapping_workflow.json` - Machine-readable mapping file

## Step 2: Review Suggestions

Open `table_mapping_report.md` to see:
```markdown
## alt_adyen.account_holder_responses (ID: 1234)
Display Name: Account Holder Responses
Fields: 15

Top matches:
  1. silver.adyen_account_holders (ID: 5678) - 87.5% match
  2. silver.adyen_transactions (ID: 5679) - 65.2% match
  ...
```

## Step 3: Confirm Mappings

Edit `table_mapping_workflow.json`:

```json
{
  "old_table_id": 1234,
  "old_table_name": "alt_adyen.account_holder_responses",
  "suggested_new_table_id": 5678,
  "suggested_new_table_name": "silver.adyen_account_holders",
  "confidence": 0.875,
  "confirmed": true,  ← Set to true
  "final_new_table_id": 5678  ← Confirm or change
}
```

For each mapping:
- Set `"confirmed": true` if you agree
- Set `"final_new_table_id"` to the correct ID
- Or change to one of the alternatives if the suggestion is wrong

## Step 4: Apply Mappings

The migration tool will use `table_mapping_workflow.json` to override automatic matching.

## Notes

- The embedding model considers table names, schemas, field names, and descriptions
- Score includes semantic similarity + name matching bonus
- Review confidence scores - anything below 60% may need manual verification
- You can run this multiple times - it won't overwrite confirmed mappings
