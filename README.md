# Metabase Migration Tool Architecture

This project is a specialized tool for migrating Metabase questions (cards) from a PostgreSQL database (ID: 6) to a ClickHouse database (ID: 10). It handles SQL translation, field mapping, dependency resolution, and persistent state management.

## Core Architecture

The system is built as a Node.js/TypeScript application with a React frontend. It can run locally (Express) or on Vercel (Serverless Functions).

### 📂 Service Layer (`src/services/`)

The core logic is distributed across several specialized services:

#### 1. `MigrationManager.ts` (The Orchestrator)
- **Role**: Central controller that coordinates the entire migration process.
- **Key Responsibilities**:
  - Orchestrates the flow: Check Dependencies → Migrate Dependencies → Migrate Card.
  - Handles "dry runs" (preview) vs. actual migration.
  - Manages the "Waiting Area" for cards that need manual review.
  - Integrates all other services (Client, Mappers, Migrators).
- **Key Methods**: `migrateCardWithDependencies`, `migrateCard`, `getMigrationStatus`.

#### 2. `MetabaseClient.ts` (API Layer)
- **Role**: Wrapper around the Metabase API.
- **Key Responsibilities**:
  - Fetches card details, database metadata, and collection info.
  - Creates and updates cards in Metabase.
  - Validates connection and handles API authentication.
- **Key Methods**: `getCard`, `createCard`, `updateCard`, `getAllCards`.

#### 3. `MetadataMapper.ts` (Schema Translation)
- **Role**: Manages the mapping between Postgres tables/fields and ClickHouse tables/fields.
- **Key Responsibilities**:
  - Loads and caches table and field mappings.
  - Translates Table IDs (e.g., Postgres Table 15 → ClickHouse Table 50).
  - Translates Field IDs (e.g., Postgres Field 100 → ClickHouse Field 500).
  - Handles "virtual" fields and special mapping overrides.

#### 4. `MbqlMigrator.ts` (Query Translator)
- **Role**: Translates Metabase Query Language (MBQL) objects.
- **Key Responsibilities**:
  - Recursively traverses MBQL JSON structures.
  - Replaces old Table IDs with new Table IDs.
  - Replaces old Field IDs with new Field IDs.
  - Updates source-table references in joins, filters, and aggregations.

#### 5. `SqlMigrator.ts` (Native SQL Translator)
- **Role**: Translates raw SQL queries using AI.
- **Key Responsibilities**:
  - Uses Google Gemini AI to rewrite Postgres SQL dialect to ClickHouse SQL dialect.
  - Preserves query logic while adjusting syntax (e.g., date functions, type casting).

#### 6. `FieldMapperAgent.ts` (AI Assistant)
- **Role**: AI agent for suggesting field mappings.
- **Key Responsibilities**:
  - Analyzes source and target table schemas.
  - Uses Gemini AI to suggest the best matching field in ClickHouse for a given Postgres field.
  - Returns confidence scores and reasoning.

#### 7. `CardIdMapping.ts` (State Tracking)
- **Role**: Tracks the relationship between old and new cards.
- **Key Responsibilities**:
  - Maps `Old_Card_ID` → `New_Card_ID`.
  - Prevents duplicate migrations by checking if a card has already been migrated.
  - Used for resolving dependencies (e.g., "Question 10" uses "Question 5", so "Question 5" must be migrated first).

#### 8. `CardDependencyResolver.ts`
- **Role**: Analyzes migration order.
- **Key Responsibilities**:
  - Detects if a card depends on other cards (e.g., via "Saved Question" source).
  - Builds a dependency graph to ensure prerequisites are migrated first.

#### 9. `StorageService.ts` (Persistence)
- **Role**: Abstract storage layer for mappings and state.
- **Key Responsibilities**:
  - **Primary**: Uses Supabase (Postgres) for persistent storage in production/Vercel.
  - **Fallback**: Uses local JSON files (`.data/`) for local development.
  - Stores: Table Mappings, Field Mappings, Card ID Mappings, Migration State.

#### 10. `WaitingArea.ts`
- **Role**: Queue for cards requiring manual intervention.
- **Key Responsibilities**:
  - Stores cards that failed migration or were flagged for review.
  - Allows re-processing cards later.

---

## 🚀 Entry Points

### `api/index.ts` (Vercel Serverless)
- The production entry point deployed to Vercel.
- Exports a serverless function handler.
- Routes:
  - `GET /api/cards`: List all cards.
  - `POST /api/preview/:id`: Generate migration preview (dry-run).
  - `POST /api/migrate/:id`: Execute migration.
  - `GET /api/status`: System health and mapping stats.

### `src/server.ts` (Local Dev)
- Express server for local development.
- Mirrors the API routes of the Vercel function.

## 🔄 Data Flow

1. **User** selects a Card ID in the UI.
2. **Frontend** calls `/api/preview/:id`.
3. **MigrationManager** fetches the card from **MetabaseClient**.
4. **MigrationManager** checks **CardDependencyResolver** for prerequisites.
5. **MbqlMigrator** translates the query using **MetadataMapper**.
6. **MetadataMapper** looks up Table/Field IDs via **StorageService** (Supabase).
7. **MigrationManager** returns the `original` vs `migrated` query to UI.
8. **User** clicks "Migrate".
9. **MigrationManager** calls `client.createCard()` with the new query.
10. **CardIdMapping** saves the new ID to **StorageService**.
