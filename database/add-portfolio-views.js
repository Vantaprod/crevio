// =========================================================
// CREVIO — add portfolio_views table (run once)
// File: database/add-portfolio-views.js
// =========================================================
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS portfolio_views (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    path        TEXT NOT NULL,
    referrer    TEXT,
    user_agent  TEXT,
    ip_hash     TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pv_user_created
    ON portfolio_views(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pv_user_hash
    ON portfolio_views(user_id, ip_hash);
`);

const cols = db.prepare("PRAGMA table_info(portfolio_views)").all().map(function (c) { return c.name; });
console.log("portfolio_views ready — columns:", cols.join(", "));