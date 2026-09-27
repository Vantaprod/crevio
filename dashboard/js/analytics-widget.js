// =========================================================
// CREVIO — PORTFOLIO ANALYTICS WIDGET
// File: dashboard/js/analytics-widget.js
// =========================================================
// Self-contained: injects its own card into the Overview
// page's <main>, fetches /api/portfolio/analytics, and renders
// the summary. Nothing else needs to know it exists.
// =========================================================
(function () {
    if (window.__crevioAnalyticsWidgetInstalled) return;
    window.__crevioAnalyticsWidgetInstalled = true;

    // ---------- DOM helpers ----------
    function findMain() {
        return document.querySelector("main.main") ||
               document.querySelector("main") ||
               document.querySelector(".main") ||
               document.body;
    }

    function injectCard() {
        if (document.getElementById("analyticsWidget")) {
            return document.getElementById("analyticsWidget");
        }
        const main = findMain();
        if (!main) return null;

        const card = document.createElement("div");
        card.className = "card";
        card.id = "analyticsWidget";
        card.style.cssText = "margin-bottom:20px;";
        card.innerHTML =
            '<h2 style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;margin-bottom:16px;">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent);">' +
                    '<path d="M3 3v18h18"/><path d="M7 15l4-4 4 4 5-5"/>' +
                '</svg>' +
                'Portfolio views' +
            '</h2>' +
            '<div id="analyticsLoading" style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">Loading analytics…</div>' +
            '<div id="analyticsContent" style="display:none;"></div>';

        // Prefer to sit right below the page header
        const header = main.querySelector(".header");
        if (header && header.parentNode === main && header.nextSibling) {
            main.insertBefore(card, header.nextSibling);
        } else if (header && header.parentNode === main) {
            main.appendChild(card);
        } else {
            main.insertBefore(card, main.firstChild);
        }
        return card;
    }

    // ---------- Formatting ----------
    function dayLabel(iso) {
        const parts = iso.split("-");
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return d.toLocaleDateString(undefined, { weekday: "short" });
    }

    function escHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    // ---------- Render ----------
    function renderAnalytics(data) {
        const loading = document.getElementById("analyticsLoading");
        const content = document.getElementById("analyticsContent");
        if (!content) return;

        const a = data.analytics || {};
        const total    = a.total || 0;
        const thisWeek = a.thisWeek || 0;
        const lastWeek = a.lastWeek || 0;
        const unique   = a.uniqueThisWeek || 0;
        const daily    = Array.isArray(a.daily) ? a.daily : [];

        // Delta line
        let deltaHtml = "";
        if (lastWeek === 0 && thisWeek > 0) {
            deltaHtml = '<span style="color:var(--success);font-weight:600;">New this week</span>';
        } else if (lastWeek > 0 && thisWeek !== lastWeek) {
            const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
            const sign = pct > 0 ? "+" : "";
            const color = pct > 0 ? "var(--success)" : "var(--danger)";
            deltaHtml = '<span style="color:' + color + ';font-weight:600;">' + sign + pct + '%</span> vs last week';
        } else {
            deltaHtml = '<span style="color:var(--text-muted);">No change vs last week</span>';
        }

        // Sparkline — 7 bars
        const maxCount = Math.max.apply(null, daily.map(function (d) { return d.count; }).concat([1]));
        const sparkline = daily.map(function (d) {
            const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
            const height = Math.max(6, pct) + "%";
            const opacity = d.count > 0 ? 1 : 0.25;
            return '<div title="' + escHtml(d.date) + ': ' + d.count + '" ' +
                'style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;">' +
                    '<div style="width:100%;height:48px;display:flex;align-items:flex-end;">' +
                        '<div style="width:100%;height:' + height + ';background:var(--accent);border-radius:4px 4px 0 0;opacity:' + opacity + ';transition:height 0.3s ease;"></div>' +
                    '</div>' +
                    '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;">' + escHtml(dayLabel(d.date)) + '</span>' +
                '</div>';
        }).join("");

        // Top path line
        let topHtml = "";
        if (a.topPath) {
            const pct = total > 0 ? Math.round((a.topPathCount / total) * 100) : 0;
            topHtml = '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border-color);font-size:12px;color:var(--text-muted);">' +
                'Top page: <a href="' + escHtml(a.topPath) + '" target="_blank" rel="noopener" ' +
                    'style="color:var(--accent);text-decoration:none;font-weight:600;">' + escHtml(a.topPath) + '</a> ' +
                    '(' + (a.topPathCount || 0) + ' views · ' + pct + '%)' +
            '</div>';
        }

        content.innerHTML =
            '<div style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end;">' +
                '<div>' +
                    '<div style="font-size:38px;font-weight:700;line-height:1;color:var(--text-primary);">' + thisWeek + '</div>' +
                    '<div style="font-size:13px;color:var(--text-secondary);margin-top:6px;">views this week</div>' +
                    '<div style="font-size:12px;color:var(--text-muted);margin-top:10px;">' + deltaHtml + '</div>' +
                '</div>' +
                '<div style="font-size:12px;color:var(--text-muted);text-align:right;line-height:1.7;">' +
                    '<div><strong style="color:var(--text-primary);font-size:16px;">' + total + '</strong> total</div>' +
                    '<div><strong style="color:var(--text-primary);font-size:16px;">' + unique + '</strong> unique this week</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;margin-top:20px;">' + sparkline + '</div>' +
            topHtml;

        if (loading) loading.style.display = "none";
        content.style.display = "block";
    }

    // ---------- Load ----------
    async function loadAnalytics() {
        try {
            const res = await window.apiFetch("/api/portfolio/analytics");
            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Failed to load");
            renderAnalytics(data);
        } catch (e) {
            const loading = document.getElementById("analyticsLoading");
            if (loading) {
                loading.style.color = "var(--danger)";
                loading.textContent = "Could not load analytics: " + e.message;
            }
        }
    }

    function init() {
        const card = injectCard();
        if (!card) return;
        loadAnalytics();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();