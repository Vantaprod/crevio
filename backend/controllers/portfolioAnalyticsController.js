// =========================================================
// CREVIO — PORTFOLIO ANALYTICS CONTROLLER
// File: backend/controllers/portfolioAnalyticsController.js
// =========================================================
// Read-only endpoint: aggregated view stats for the authed
// user. Never returns raw IPs — only counts.
// =========================================================
const db = require("../../database/db");

function row(sql, ...params) {
    try { return db.prepare(sql).get(...params); }
    catch (e) { return null; }
}
function rows(sql, ...params) {
    try { return db.prepare(sql).all(...params); }
    catch (e) { return []; }
}

// GET /api/portfolio/analytics
exports.getAnalytics = (req, res) => {
    try {
        const uid = req.user.id;

        const total = (row(
            "SELECT COUNT(*) AS c FROM portfolio_views WHERE user_id = ?",
            uid
        ) || {}).c || 0;

        const thisWeek = (row(
            "SELECT COUNT(*) AS c FROM portfolio_views " +
            "WHERE user_id = ? AND created_at >= datetime('now', '-7 days')",
            uid
        ) || {}).c || 0;

        const lastWeek = (row(
            "SELECT COUNT(*) AS c FROM portfolio_views " +
            "WHERE user_id = ? " +
            "  AND created_at >= datetime('now', '-14 days') " +
            "  AND created_at <  datetime('now', '-7 days')",
            uid
        ) || {}).c || 0;

        const uniqueThisWeek = (row(
            "SELECT COUNT(DISTINCT ip_hash) AS c FROM portfolio_views " +
            "WHERE user_id = ? AND created_at >= datetime('now', '-7 days') AND ip_hash IS NOT NULL",
            uid
        ) || {}).c || 0;

        const topPathRow = row(
            "SELECT path, COUNT(*) AS c FROM portfolio_views " +
            "WHERE user_id = ? AND created_at >= datetime('now', '-30 days') " +
            "GROUP BY path ORDER BY c DESC LIMIT 1",
            uid
        );

        // Raw daily counts for last 7 days
        const dailyRows = rows(
            "SELECT strftime('%Y-%m-%d', created_at) AS date, COUNT(*) AS count " +
            "FROM portfolio_views " +
            "WHERE user_id = ? AND created_at >= datetime('now', '-6 days') " +
            "GROUP BY date ORDER BY date ASC",
            uid
        );

        const dailyMap = {};
        dailyRows.forEach(function (d) { dailyMap[d.date] = d.count; });

        // Fill in any missing days with zero, ordered oldest → newest
        const daily = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            daily.push({ date: key, count: dailyMap[key] || 0 });
        }

        res.json({
            success: true,
            analytics: {
                total: total,
                thisWeek: thisWeek,
                lastWeek: lastWeek,
                uniqueThisWeek: uniqueThisWeek,
                topPath: topPathRow ? topPathRow.path : null,
                topPathCount: topPathRow ? topPathRow.c : 0,
                daily: daily
            }
        });
    } catch (err) {
        console.error("portfolioAnalytics error:", err);
        res.status(500).json({ success: false, message: "Failed to load analytics" });
    }
};