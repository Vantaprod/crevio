// =========================================================
// CREVIO — PORTFOLIO RENDER CONTROLLER (server-side)
// File: backend/controllers/portfolioRenderController.js
// =========================================================
// Replaces the client-rendered portfolio.html when the user
// has picked a template. Falls through (calls next()) if:
//   - user not found
//   - portfolio not published
//   - no template chosen
//   - engine or payload throws
//   - owner's current plan no longer unlocks the stored template
//     (Phase 1E — after downgrade, fall back to "minimal")
// Result: existing legacy portfolio.html is the safety net.
// =========================================================
const db = require("../../database/db");
const engine = require("../templates/portfolio/_engine");
const payloadBuilder = require("../templates/portfolio/_payload");
const entitlementService = require("../services/entitlementService");
const crypto = require("crypto");

// ---------- View logging (privacy-friendly) ----------
// Bots and link-preview scrapers hit /p/:slug to generate
// preview cards — we must not count those as real views.
const BOT_REGEX = /bot|crawler|spider|preview|facebookexternalhit|twitterbot|slackbot|whatsapp|telegram|discord|linkedinbot|pinterest|skype|embed|headless/i;

function isBot(ua) {
    if (!ua) return true;
    return BOT_REGEX.test(ua);
}

function hashIp(ip) {
    const secret = process.env.JWT_SECRET || "crevio-dev-salt";
    return crypto.createHash("sha256").update(ip + ":" + secret).digest("hex").slice(0, 16);
}

function logPortfolioView(userId, req) {
    try {
        const ua = req.get("user-agent") || "";
        if (isBot(ua)) return;

        const referrer = (req.get("referer") || "").slice(0, 500) || null;
        const ip = req.ip || (req.connection && req.connection.remoteAddress) || "";
        const ipHash = ip ? hashIp(ip) : null;
        const path = req.path;

        db.prepare(
            "INSERT INTO portfolio_views (user_id, path, referrer, user_agent, ip_hash) VALUES (?, ?, ?, ?, ?)"
        ).run(userId, path, referrer, ua.slice(0, 500), ipHash);
    } catch (e) {
        // Fire-and-forget — analytics must never break rendering
        console.warn("[portfolioView] log failed:", e.message);
    }
}

const FALLBACK_TEMPLATE = "minimal";

function safeGet(sql, ...params) {
    try { return db.prepare(sql).get(...params); } catch (e) { return null; }
}

function resolveTemplateSlug(config) {
    if (!config || !config.theme_settings) return null;
    let settings = config.theme_settings;
    if (typeof settings === "string") {
        try { settings = JSON.parse(settings); } catch (e) { return null; }
    }
    return (settings && settings.template) || null;
}

function doRender(req, res, next, mode) {

    try {
        const slug = req.params.slug;
        if (!slug) return next();

        const user = safeGet(
            "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)",
            slug
        );
        if (!user) return next();

        const config = safeGet(
            "SELECT * FROM portfolio_config WHERE user_id = ? LIMIT 1",
            user.id
        );
        if (!config || !config.published) return next();

        // Log this view (bot-filtered, IP-hashed, non-blocking)
        logPortfolioView(user.id, req);

        const templateSlug = resolveTemplateSlug(config);
        if (!templateSlug) return next();

        // ---- Phase 1E — plan-aware fallback ----
        // If the owner downgraded and their current plan no longer
        // unlocks the stored template, render the fallback template
        // instead. Prevents Pro/Business templates from leaking to
        // Free-tier owners after a downgrade.
        let effectiveSlug = templateSlug;
        try {
            const ownerPlan = entitlementService.getUserPlan(user.id);
            if (!entitlementService.canUseTemplate(ownerPlan, templateSlug)) {
                console.warn(
                    "[portfolioRender] plan '" + ownerPlan +
                    "' does not unlock template '" + templateSlug +
                    "' for user " + user.id +
                    " — falling back to '" + FALLBACK_TEMPLATE + "'"
                );
                effectiveSlug = FALLBACK_TEMPLATE;
            }
        } catch (e) {
            // If entitlement check fails for any reason, don't block rendering.
            // Continue with stored template so an unrelated bug can't take
            // down every published portfolio.
            console.warn("[portfolioRender] entitlement check failed:", e.message);
        }

        const tpl = engine.loadTemplate(effectiveSlug);
        if (!tpl) {
            console.warn("[portfolioRender] template not found: " + effectiveSlug);
            return next();
        }

        const data = payloadBuilder.build(user.id, { templateMeta: tpl.meta, mode: mode, baseUrl: req.protocol + "://" + req.get("host") });
        if (!data) return next();

        const html = engine.render(effectiveSlug, data);
        if (!html) return next();

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control",
        process.env.NODE_ENV === "production"
            ? "public, max-age=60"
            : "no-store, no-cache, must-revalidate, private");
        return res.send(html);
    } catch (e) {
        console.error("[portfolioRender] failed:", e.message);
        return next();
    }
}

exports.renderPublicPortfolio = (req, res, next) => doRender(req, res, next, "portfolio");
exports.renderTestimonialsPage = (req, res, next) => doRender(req, res, next, "testimonials");