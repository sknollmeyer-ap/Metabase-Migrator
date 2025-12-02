# Migration Workbench

The Migration Workbench is a new UI for the Metabase Migration Tool that provides a streamlined, interactive workflow for migrating cards from PostgreSQL to ClickHouse.

## Features

- **Master-Detail Layout**: Browse all cards on the left, view details and actions on the right.
- **Interactive Mapping**: Identify and fix missing table and field mappings directly in the UI.
- **Side-by-Side Preview**: Compare original PostgreSQL queries with the generated ClickHouse queries.
- **Structured Error Handling**: Clear error messages with specific codes and details.
- **Persistence**: Mappings are saved to Supabase and reused for future migrations.

## How to Use

1.  **Select a Card**: Click on a card in the left list.
2.  **Check & Preview**: Click "Check Card & Preview Migration".
3.  **Resolve Issues**:
    *   If there are **Unmatched Tables** or **Unmatched Fields**, a mapping UI will appear.
    *   Select the correct target table/field from the dropdowns.
    *   The preview will automatically refresh after you make a selection.
4.  **Migrate**: Once the preview looks good (no errors), click "Migrate Card".
5.  **Verify**: The card is created in Metabase. Click the link to view it.

## Development

- **Frontend**: `ui/src/App.tsx`, `ui/src/components/UnmatchedMapping.tsx`
- **Backend**: `src/services/MigrationManager.ts`, `src/services/MbqlMigrator.ts`
- **API**: `src/server.ts` (local), `api/index.ts` (Vercel)

## API Endpoints

- `GET /api/metadata/tables`: List tables in target DB.
- `GET /api/metadata/fields`: List fields in a target table.
- `POST /api/mappings/table`: Save a table mapping.
- `POST /api/mappings/field`: Save a field mapping.
- `POST /api/preview/:id`: Generate migration preview with unmatched item detection.
