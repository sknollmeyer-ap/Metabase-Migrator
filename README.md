# Metabase Migration Tool (Postgres → ClickHouse)

A comprehensive "Workbench" application designed to assist in migrating Metabase questions (cards) from a PostgreSQL database (Source, DB ID: 6) to a ClickHouse database (Target, DB ID: 10). It handles complex dependencies, translates MBQL and SQL queries, and provides a powerful UI for managing mappings.

## 🚀 Features

*   **Migration Queue**: Automatically fetches all questions from the source database and organizes them by status (Unmigrated, Migrated, On Hold).
*   **Dependency Resolution**: Identifies nested questions (e.g., "Question A filters results from Question B").
    *   **Visual Dependency Graph**: A dedicated "Dependency Resolver" tab to visualize and navigate complex chains of nested questions.
    *   **Recursive Migration**: Automatically prompts to migrate dependency cards before the target card.
*   **Global Table Mapping**:
    *   **Dedicated UI**: A "Table Mappings" tab to map source tables to target tables globally.
    *   **Interactive Search**: Easily find and map tables across schemas.
    *   **Many-to-One Support**: Map multiple source tables to a single target table.
*   **Intelligent Query Translation**:
    *   **MBQL Migrator**: Translates Metabase's visual query language structure, re-mapping table and field IDs.
    *   **SQL Migrator**: Translates native SQL queries using regex and optionally an LLM (Gemini) for complex dialect conversions.
*   **Smart Preview & Verification**:
    *   **Dry Run**: "Check Card & Preview Migration" functionality shows you the generated SQL/MBQL before any changes are made.
    *   **Unmatched Items Handler**: Automatically detects unmapped tables or fields during preview and provides an inline UI to fix them instantly.
    *   **Auto-Verification**: After migration, the tool runs the new question in Metabase to verify it executes without errors. If it fails, it attempts to self-correct using AI.

## 🏗 Architecture

The project is a monorepo consisting of a Node.js/Express backend and a React/Vite frontend.

### Backend (`/src`)
*   **`server.ts`**: Express API server handling requests from the UI.
*   **`MigrationManager.ts`**: The core orchestrator. Manages the lifecycle of a migration (fetch -> resolve dependencies -> translate -> map -> save -> verify).
*   **`MetabaseClient.ts`**: Wrapper for the Metabase REST API.
*   **`MetadataMapper.ts`**: Maintains the state of Table and Field mappings between the two databases.
*   **`MbqlMigrator.ts` & `SqlMigrator.ts`**: Logic for translating queries.
*   **`CardDependencyResolver.ts`**: Analyzes specific query structures to find referenced card IDs.

### Frontend (`/ui`)
*   **`App.tsx`**: Main dashboard controller.
*   **`TableMapper.tsx`**: UI for the "Table Mappings" tab.
*   **`DependencyResolver.tsx`**: UI for the "Dependency Resolver" tab.
*   **`UnmatchedMapping.tsx`**: Reusable component for fixing missing mappings on the fly.
*   **`MetabaseCard.tsx`**: Component for displaying card status and details.

## 🛠 Prerequisites

*   **Node.js**: v18 or higher.
*   **Metabase Instance**: Access to the Metabase instance (URL and API Key).
*   **Databases**: Both the Source (Postgres) and Target (ClickHouse) databases must be connected to Metabase.

## ⚙️ Setup & Configuration

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd MetabaseMigrationTool
    ```

2.  **Install Backend Dependencies**
    ```bash
    npm install
    ```

3.  **Install Frontend Dependencies**
    ```bash
    cd ui
    npm install
    cd ..
    ```

4.  **Environment Variables**
    Create a `.env` file in the root directory:
    ```env
    METABASE_BASE_URL=https://metabase.your-company.com
    METABASE_API_KEY=your_metabase_api_key
    OLD_DB_ID=6  # Postgres
    NEW_DB_ID=10 # ClickHouse
    GEMINI_API_KEY=your_gemini_key # Optional: For AI SQL repair and field suggestions
    ```

## ▶️ Running the Application

You need to run both the backend server and the frontend development server.

**1. Start the Backend API** (Root directory)
```bash
npm run server
```
*The server runs on `http://localhost:3001`.*

**2. Start the Frontend UI** (New terminal, `/ui` directory)
```bash
cd ui
npm run dev
```
*The UI runs on `http://localhost:5173` (or similar).*

## 📖 Usage Guide

### 1. Dashboard (Migration Queue)
*   **Left Pane**: Lists all cards from the source DB.
    *   **Unmigrated**: Pending migration.
    *   **Migrated**: Successfully moved to ClickHouse.
    *   **On Hold**: Cards marked for manual review or skipping.
*   **Right Pane**: Details of the selected card.
*   **Action**: Click "Check Card & Preview Migration" to start.

### 2. Handling Dependencies
If a card depends on another Unmigrated card (e.g., via "Saved Question" source), the tool will block migration and show an error: `DEPENDENCY_NOT_MIGRATED`.
*   Click **"Go to Dependency Card #123"** to navigate to the parent.
*   Migrate the parent(s) first.
*   Return to the original card and migrate it.

### 3. Mapping Tables (Global)
*   Go to the **"Table Mappings"** tab.
*   Use the search bar to find source tables (e.g., `public.users`).
*   Select the corresponding target table (e.g., `default.users`) from the dropdown.
*   These mappings are saved globally and used for all future migrations.

### 4. Resolving Unmatched Items (Inline)
During a "Preview", if the tool encounters a table or field that isn't mapped:
*   An **"⚠️ Missing Mappings"** section appears.
*   Select the correct Target Table or Field from the dropdowns.
*   Click **"AI Suggest"** for field mapping help (if configured).
*   Correct logic refreshes automatically, and you can try the Preview again immediately.

### 5. Migration
*   Once the Preview succeeds (status: `ok` or `ok_with_warnings`), the **"Migrate Card"** button becomes active.
*   Clicking it will:
    1.  Create a NEW card in Metabase (pointing to ClickHouse).
    2.  Verify the card runs successfully.
    3.  If successful, marks the old card as "Migrated" in the local tracking list.
*   **Re-migrate**: If a card was already migrated but needs updates, use "Re-migrate (Overwrite)".

## ❓ Troubleshooting

*   **"Port in use"**: Ensure no other process is using port 3001 (Server) or 5173 (UI).
*   **"Card not found"**: Ensure the card ID exists in Metabase and belongs to the Source DB.
*   **"Circular dependency"**: Use the Dependency Resolver tab to visualize the cycle. Cycles must be broken manually in Metabase or by forcing migration of one node.
*   **"Timeout"**: Large queries or slow Metabase responses might timeout. Use the CLI tool for these specific cards if the UI fails consistently.
