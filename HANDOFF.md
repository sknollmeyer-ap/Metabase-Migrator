# Metabase Migration Tool - Project Handoff Guide

## 📌 Project Overview
**Goal:** Migrate Metabase questions (cards) from a PostgreSQL database (Source, DB ID: 6) to a ClickHouse database (Target, DB ID: 10).

**Core Philosophy:** This is an "Assisted Migration" tool (Workbench). It does not blindly migrate everything at once. Instead, it empowers a human operator to review, fix, and approve migrations card-by-card. This approach is necessary because:
1.  **Logic Changes:** Postgres logic (e.g. `jsonb` handling) differs fundamentally from ClickHouse logic.
2.  **Data Structure Changes:** Field names or types might have drifted between the two databases.
3.  **Human Verification:** Business logic needs to be verified to ensure the numbers match.

---

## 🏗 System Architecture & Design

The project is a monorepo containing a full-stack Javascript/TypeScript application.

### 1. The Stack
*   **Runtime:** Node.js (v18+)
*   **Language:** TypeScript (Strict mode enabled)
*   **Backend Framework:** Express.js
*   **Frontend Framework:** React (Vite build tool)
*   **State Management:** Local JSON files (No external database required for the tool itself).

### 2. Backend (`/src`)
The backend is the brain. It runs as a persistent process on port **3001**.
The entry point is `src/server.ts`, which initializes the `MigrationManager` singleton.

**Key Services Deep Dive:**

#### **A. `MigrationManager.ts` (The Orchestrator)**
This is the most critical file. It manages the entire lifecycle of a single card's migration.
*   **Initialization:** On startup, it loads all existing mappings from `card_id_mapping.json` and `table_mapping_workflow.json` into memory.
*   **`previewCard(id)`**:
    1.  Fetches build metadata for the card from Metabase.
    2.  Check for dependencies (calls `CardDependencyResolver`).
    3.  If dependencies exist and are unmigrated -> **STOP**. Return `DEPENDENCY_NOT_MIGRATED`.
    4.  If Native SQL -> Calls `SqlMigrator`.
    5.  If MBQL -> Calls `MbqlMigrator`.
    6.  If the Migrator returns "Missing Mappings" -> **STOP**. Return Unmatched UI payload.
    7.  If Translation succeeds -> Run a DRY RUN query against ClickHouse to verify syntax.
    8.  Return the Diff (Old Query vs New Query) to the UI.
*   **`migrateCard(id)`**:
    1.  Actually POSTs the new card payload to the Metabase API.
    2.  If successful, records the new ID in `card_id_mapping.json`.

#### **B. `MetadataMapper.ts` (The Map)**
Maintains the "Rosetta Stone" between DB 6 and DB 10.
*   It caches the schemas of both databases in memory on startup.
*   **Table Mapping Strategy**:
    1.  Look for confirmed mappings in `table_mapping_workflow.json`.
    2.  Look for exact matches (`schema.table`).
    3.  Look for fuzzy name matches (`table_name` ignoring schema).
*   **Field Mapping Strategy**:
    1.  Look for manual overrides in `field_mapping_overrides.json`.
    2.  Look for exact name matches.
    3.  Look for normalized matches (ignoring case and underscores).
    4.  Ask AI (optional) if no match found.

#### **C. `SqlMigrator.ts` (The Translator)**
The hardest part of the migration.
*   **Regex Replacements**: handles simple things like `::date` -> `toDate()`, `ILIKE` -> `ILIKE`, `now()` -> `now()`.
*   **AI Fallback**: If Regex isn't enough (or if the Dry Run fails), it sends the query + the error message to Google Gemini (if configured). Gemini returns a fixed SQL query. This self-healing loop is critical for complex queries.

### 3. Frontend (`/ui`)
The frontend is the control panel. It runs on port **5173**.

**Key Components Deep Dive:**

#### **A. `App.tsx` (The Controller)**
*   **State**: Holds the list of `Unmigrated`, `Migrated`, and `On Hold` cards.
*   **Communication**: Polls the backend or triggers specific endpoints.
*   **Logic**:
    *   If `preview.status === 'failed'`, it checks `errorCode`.
    *   If `errorCode === 'DEPENDENCY_NOT_MIGRATED'`, it renders the "Go to Dependency" button.
    *   If payload includes `unmatchedTables`, it renders `<UnmatchedMapping />`.

#### **B. `DependencyResolver.tsx`**
*   Visualizes the tree of questions.
*   Uses a recursive algorithm to fetch the parent of a parent of a parent.
*   Allows you to jump to the "leaf" node or the "root" node of a problem.

---

## 📂 Comprehensive File Manifest

Understanding where code lives is half the battle.

### Configuration & State
*   `/.env`: API Keys. **NEVER COMMIT THIS**.
*   `/tsconfig.json`: TypeScript compiler settings.
*   `/package.json`: Backend dependencies.
*   `/ui/package.json`: Frontend dependencies.

### Persistence Layer (`/`)
*   `card_id_mapping.json`: **[DO NOT DELETE]** The database of what has been done.
    *   Format: `[["112", 5040], ["113", 5041]]` (OldID -> NewID).
*   `table_mapping_workflow.json`: **[DO NOT DELETE]** Confirmed table links.
*   `field_mapping_overrides.json`: Field-level specific overrides.

### Backend Core (`/src`)
*   `server.ts`: The HTTP Interface.
*   `types.ts`: Shared interfaces (`MigrationResponse`, `UnmatchedTable`, etc.).

### Services (`/src/services`)
*   `MigrationManager.ts`: The main controller class.
*   `MetabaseClient.ts`: Axios wrapper for Metabase API calls (GET/POST/PUT).
*   `MbqlMigrator.ts`: Logic for traversing the deep JSON tree of a Metabase query.
*   `SqlMigrator.ts`: Logic for string manipulation of raw SQL.
*   `CardDependencyResolver.ts`: Helper to parse `card__id` references.
*   `FieldMapperAgent.ts`: Specialized service that uses LLMs to guess field names (e.g. `cust_id` ~= `customerId`).

### UI Source (`/ui/src`)
*   `main.tsx`: React entry point.
*   `App.tsx`: The monolithic dashboard component.
*   `components/TableMapper.tsx`: The complex table mapping grid.
*   `components/UnmatchedMapping.tsx`: The inline "fix-it" modal.

---

## 🔄 Exact Workflow step-by-step

### Phase 1: Setup
1.  **Clean State**: optionally archive old `.json` files if starting a fresh project, but usually you keep them.
2.  **Install**:
    ```bash
    npm install
    cd ui && npm install && cd ..
    ```
3.  **Boot**:
    ```bash
    npm run server
    # New Tab
    cd ui && npm run dev
    ```

### Phase 2: Global Configuration (The Table Mapper)
Before checking individual cards, it helps to map the big tables.
1.  Open the **"Table Mappings"** tab.
2.  The system lists all DB 6 tables on the left.
3.  Filter for `public`.
4.  Map them to `default` keys in DB 10.
5.  This writes to `table_mapping_workflow.json` immediately.
6.  *Why?* Because if you don't do this, every single card will ask you "Where is table Users?", "Where is table Orders?". Doing it once globally saves hours.

### Phase 3: The Queue (Daily Operation)
1.  **Select a Card**: Pick the top card from "Unmigrated".
2.  **Preview**: Click **"Check Card"**.
3.  **Dependency Trap**:
    *   *Scenario*: Card 100 uses Card 99. Card 99 is Unmigrated.
    *   *Result*: UI blocks you. Shows "Go to Card 99".
    *   *Action*: You click "Go to Card 99". You migrate Card 99. You verify it works. You return to Card 100.
    *   *Result*: Card 100 Preview now works (because Card 99 exists in the mapping file).
4.  **Unmatched Field Trap**:
    *   *Scenario*: Postgres has `user_id`, ClickHouse has `userId`.
    *   *Result*: UI shows "⚠️ Missing Mapping: user_id".
    *   *Action*: Select `userId` from dropdown.
    *   *System*: Saves this to `field_mapping_overrides.json`.
    *   *Result*: The query is re-generated instantly with `userId`.
5.  **SQL Error Trap**:
    *   *Scenario*: "Syntax error: Unknown function date_trunc".
    *   *System*: Backend catches error. Backend calls Gemini AI: "Fix this ClickHouse SQL: [Query] Error: [Error]".
    *   *Result*: AI returns fixed SQL using `toStartOfInterval`.
    *   *UI*: Shows valid SQL. Warning: "AI modified this query".
6.  **Migrate**:
    *   Click **"Migrate Card"**.
    *   Success message appears. Card moves to "Migrated" list.

---

## 🐛 Troubleshooting Guide (The "Nook and Cranny" details)

### 1. "The server says Circular Dependency"
**Symptoms:** You try to preview Card A, it sends you to Card B. You preview Card B, it sends you to Card A.
**Root Cause:** The Metabase analysts created a loop. B filters by A, A filters by B. This is valid in Postgres sometimes but impossible to migrate sequentially.
**Fix:**
*   Open Metabase.
*   Edit Card A to remove the filter on Card B.
*   Back in the Tool: Migrate Card A.
*   Back in Metabase: Add the filter back (pointing to the *new* Card B once B is migrated).

### 2. "Dropdown is empty in Table Mapper"
**Symptoms:** You click "Select Target Table" but nothing shows up.
**Root Cause:** The backend failed to fetch DB 10 metadata, or the frontend didn't load it.
**Fix:**
*   Check the server console logs for "Error fetching metadata".
*   Restart the server (`Ctrl+C` -> `npm run server`). Metadata is cached on startup.

### 3. "AI is hallucinating functions"
**Symptoms:** The generated SQL looks plausible but fails with "Unknown function 'magic_date_fix'".
**Root Cause:** LLMs sometimes guess.
**Fix:**
*   You can't edit SQL in the *Preview* pane (feature request pending).
*   **Workaround:** Migrate the card as-is (broken). Then open the new card in Metabase and manually fix the SQL. The tool is an *assistant*, not a magician.

### 4. "My mapppings aren't saving"
**Symptoms:** You map a table, but next time you preview, it asks again.
**Root Cause:** `fs-extra` write permission or race condition.
**Fix:**
*   Ensure the process has write access to the root directory.
*   Check `table_mapping_workflow.json` content manually to see if it's valid JSON.

### 5. "Preview spins forever"
**Symptoms:** "Processing..." for > 30 seconds.
**Root Cause:** The query is extremely heavy (e.g. `SELECT * FROM huge_table`). The tool runs a real query to test validity.
**Fix:**
*   Look at the server logs. If it says "Querying Metabase...", it's waiting on DB 10.
*   You might need to manually migrate this specific card if it's too heavy to run in the tool's 2-minute timeout window.

---

## 🔌 API Reference (Internal)

If you need to extend the tool, here are the endpoints available in `server.ts`.

### GET `/api/cards`
*   **Query Params**: `db` (Database ID)
*   **Returns**: List of all cards summary `{ id, name, collection_id }`.

### POST `/api/preview/:id`
*   **Body**: `{ sourceTableId: number, targetTableId: number }` (Optional mapping override).
*   **Returns**: `MigrationResponse`
    *   `status`: 'ok' | 'failed'
    *   `originalQuery`: JSON/String
    *   `migratedQuery`: JSON/String
    *   `unmatchedTables`: Array of missing mappings.

### POST `/api/migrate/:id`
*   **Body**: `{ force: boolean }`
*   **Returns**: `{ newId: number, status: 'ok' }`
*   **Side Effects**: Creates card in Metabase, updates `card_id_mapping.json`.

### POST `/api/mappings/table`
*   **Body**: `{ sourceTableId, targetTableId }`
*   **Action**: Updates local JSON mapping file and refreshes in-memory cache.

### GET `/api/metadata/tables`
*   **Query Params**: `databaseId`
*   **Returns**: Full schema dump of that DB. Heavy payload.

---

## 🧬 Extending the Tool (Dev Guide)

**How to add a new "Auto-Fix" rule:**
1.  Go to `src/services/SqlMigrator.ts`.
2.  Find the `basicFixes` array or `applyRegexFixes` method.
3.  Add your regex.
    *   *Example:* `sql = sql.replace(/FROM "public"/g, 'FROM "default"');`
4.  Restart server.

**How to change the UI Theme:**
1.  Go to `ui/src/App.css`.
2.  Modify the `:root` variables for colors.

**How to add a new Tab:**
1.  Go to `ui/src/App.tsx`.
2.  Add a state option: `activeTab`.
3.  Add a button in the header.
4.  Create a component in `ui/src/components/`.
5.  Render it conditionally in the main render loop.

---

## 📜 Checklist for Handoff

*   [ ] Verify the new user has access to the Metabase instance (Credentials).
*   [ ] Verify Node.js v18+ is installed on their machine.
*   [ ] Zip up the entire folder **excluding** `node_modules`.
*   [ ] ensure `.env` is securely shared (Password manager), **NOT** via email/chat.
*   [ ] Walk them through `HANDOFF.md` (this file).
*   [ ] Do one "Live Migration" together to prove it works.

**Good luck! This tool turns a 6-month manual migration nightmare into a manageable 2-week workflow.**
