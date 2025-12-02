"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
require("./App.css");
function App() {
    const [view, setView] = (0, react_1.useState)('dashboard');
    const [status, setStatus] = (0, react_1.useState)(null);
    const [preview, setPreview] = (0, react_1.useState)(null);
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [mappings, setMappings] = (0, react_1.useState)([]);
    const [currentMappingIndex, setCurrentMappingIndex] = (0, react_1.useState)(0);
    (0, react_1.useEffect)(() => {
        fetchStatus();
    }, []);
    (0, react_1.useEffect)(() => {
        if (view === 'mappings') {
            fetchUnconfirmedMappings();
        }
    }, [view]);
    const fetchStatus = () => __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield fetch('http://localhost:3001/api/status');
            const data = yield res.json();
            setStatus(data);
        }
        catch (error) {
            console.error('Failed to fetch status:', error);
        }
    });
    const fetchUnconfirmedMappings = () => __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield fetch('http://localhost:3001/api/table-mappings?confirmed=false');
            const data = yield res.json();
            setMappings(data);
        }
        catch (error) {
            console.error('Failed to fetch mappings:', error);
        }
    });
    const updateMapping = (oldId, confirmed, finalTableId) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield fetch(`http://localhost:3001/api/table-mappings/${oldId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmed, final_new_table_id: finalTableId })
            });
            // Move to next mapping
            if (currentMappingIndex < mappings.length - 1) {
                setCurrentMappingIndex(currentMappingIndex + 1);
            }
            else {
                // Refresh the list
                fetchUnconfirmedMappings();
                setCurrentMappingIndex(0);
            }
        }
        catch (error) {
            console.error('Failed to update mapping:', error);
        }
    });
    const previewCard = (cardId) => __awaiter(this, void 0, void 0, function* () {
        setLoading(true);
        try {
            const res = yield fetch(`http://localhost:3001/api/preview/${cardId}`, { method: 'POST' });
            const data = yield res.json();
            setPreview(data);
            setView('preview');
        }
        catch (error) {
            console.error('Failed to preview card:', error);
        }
        finally {
            setLoading(false);
        }
    });
    return (<div className="app">
      <header className="header">
        <h1>Metabase Migration Tool</h1>
        <p>Postgres -> ClickHouse</p>
      </header>

      <nav className="nav">
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>
          Dashboard
        </button>
        <button className={view === 'preview' ? 'active' : ''} onClick={() => previewCard(4094)} disabled={loading}>
          {loading ? 'Loading...' : 'Preview Card 4094'}
        </button>
        <button className={view === 'mappings' ? 'active' : ''} onClick={() => setView('mappings')}>
          Table Mappings
        </button>
      </nav>

      <main className="main">
        {view === 'dashboard' && status && (<div className="dashboard">
            <h2>Migration Status</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Tables Mapped</div>
                <div className="stat-value">{status.tablesMapped}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Fields Mapped</div>
                <div className="stat-value">{status.fieldsMapped}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Missing Tables</div>
                <div className="stat-value warning">{status.missingTables}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Status</div>
                <div className="stat-value success">
                  {status.initialized ? 'Ready' : 'Initializing'}
                </div>
              </div>
            </div>

            <div className="info-box">
              <h3>Quick Start</h3>
              <ol>
                <li>Click "Preview Card 4094" to see migration preview</li>
                <li>Review the before/after comparison</li>
                <li>Check for warnings or errors</li>
                <li>Manually approve or reject the migration</li>
              </ol>
            </div>
          </div>)}

        {view === 'preview' && preview && (<div className="preview">
            <h2>Card Preview: {preview.cardName}</h2>

            {preview.warnings.length > 0 && (<div className="warnings">
                <h3>Warnings</h3>
                <ul>
                  {preview.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              </div>)}

            {preview.errors.length > 0 && (<div className="errors">
                <h3>Errors</h3>
                <ul>
                  {preview.errors.map((e, i) => (<li key={i}>{e}</li>))}
                </ul>
              </div>)}

            <div className="comparison">
              <div className="comparison-column">
                <h3>Original (Postgres DB 6)</h3>
                <pre>{JSON.stringify(preview.original, null, 2)}</pre>
              </div>
              <div className="comparison-column">
                <h3>Migrated (ClickHouse DB 10)</h3>
                {preview.migrated ? (<pre>{JSON.stringify(preview.migrated, null, 2)}</pre>) : (<div className="empty-state">Migration failed or incomplete</div>)}
              </div>
            </div>

            <div className="actions">
              <button className="btn-approve" disabled>
                Approve & Migrate (Coming Soon)
              </button>
              <button className="btn-reject" onClick={() => setView('dashboard')}>
                Reject & Back to Dashboard
              </button>
            </div>
          </div>)}

        {view === 'mappings' && mappings.length > 0 && (<div className="mappings">
            <h2>Table Mapping Review</h2>
            <div className="mapping-progress">
              Reviewing {currentMappingIndex + 1} of {mappings.length} unmapped tables
            </div>

            {mappings[currentMappingIndex] && (<div className="mapping-card">
                <div className="mapping-header">
                  <h3>Source Table (Postgres DB 6)</h3>
                  <div className="table-name">{mappings[currentMappingIndex].old_table_name}</div>
                  <div className="table-id">ID: {mappings[currentMappingIndex].old_table_id}</div>
                </div>

                <div className="mapping-suggestion">
                  <h3>Suggested Match ({(mappings[currentMappingIndex].confidence * 100).toFixed(1)}% confidence)</h3>
                  <div className="table-name suggested">{mappings[currentMappingIndex].suggested_new_table_name}</div>
                  <div className="table-id">ID: {mappings[currentMappingIndex].suggested_new_table_id}</div>

                  <div className="mapping-actions">
                    <button className="btn-confirm" onClick={() => updateMapping(mappings[currentMappingIndex].old_table_id, true, mappings[currentMappingIndex].suggested_new_table_id)}>
                      Confirm This Mapping
                    </button>
                    <button className="btn-skip" onClick={() => {
                    if (currentMappingIndex < mappings.length - 1) {
                        setCurrentMappingIndex(currentMappingIndex + 1);
                    }
                }}>
                      Skip for Now
                    </button>
                  </div>
                </div>

                {mappings[currentMappingIndex].alternatives && mappings[currentMappingIndex].alternatives.length > 0 && (<div className="mapping-alternatives">
                    <h3>Alternative Matches</h3>
                    {mappings[currentMappingIndex].alternatives.map((alt, idx) => (<div key={idx} className="alternative-option">
                        <div className="alt-info">
                          <div className="table-name">{alt.table_name}</div>
                          <div className="table-id">ID: {alt.table_id} ({(alt.score * 100).toFixed(1)}%)</div>
                        </div>
                        <button className="btn-select-alt" onClick={() => updateMapping(mappings[currentMappingIndex].old_table_id, true, alt.table_id)}>
                          Use This Instead
                        </button>
                      </div>))}
                  </div>)}

                <div className="mapping-navigation">
                  <button disabled={currentMappingIndex === 0} onClick={() => setCurrentMappingIndex(currentMappingIndex - 1)}>
                    <Previous />
                  </button>
                  <button disabled={currentMappingIndex === mappings.length - 1} onClick={() => setCurrentMappingIndex(currentMappingIndex + 1)}>
                    Next >
                  </button>
                </div>
              </div>)}
          </div>)}

        {view === 'mappings' && mappings.length === 0 && (<div className="empty-state">
            <h2>All Mappings Confirmed!</h2>
            <p>All table mappings have been reviewed and confirmed.</p>
          </div>)}
      </main>

      <footer className="footer">
        <p>Migration Tool v1.0 | Dry-run mode active</p>
      </footer>
    </div>);
}
exports.default = App;
