// =========================================================
// CREVIO — PORTFOLIO AI CONTENT CONTROLLER
// File: backend/controllers/portfolioAiContentController.js
// =========================================================
// Business-only. Uses the user's own workspace data (profession,
// specialties, location, published project titles) as context so
// the AI's output is grounded in reality — not generic filler.
// =========================================================
const db = require("../../database/db");
const entitlementService = require("../services/entitlementService");

// ---------- Data gathering ----------
function safeGet(sql, ...params) {
    try { return db.prepare(sql).get(...params); } catch (e) { return null; }
}
function safeAll(sql, ...params) {
    try { return db.prepare(sql).all(...params); } catch (e) { return []; }
}

function loadUserContext(userId) {
    const user = safeGet(
        "SELECT id, username, display_name, bio, location, primary_profession, specialties FROM users WHERE id = ?",
        userId
    ) || {};

    const projects = safeAll(
        "SELECT name, category FROM projects WHERE user_id = ? AND published = 1 ORDER BY created_at DESC LIMIT 8",
        userId
    );

    const services = safeAll(
        "SELECT name FROM services WHERE user_id = ? LIMIT 6",
        userId
    );

    return {
        name: user.display_name || user.username || "",
        username: user.username || "",
        profession: user.primary_profession || "",
        specialties: user.specialties || "",
        location: user.location || "",
        existingBio: user.bio || "",
        projectTitles: projects.map(function (p) { return p.name; }).filter(Boolean),
        projectCategories: Array.from(new Set(projects.map(function (p) { return p.category; }).filter(Boolean))),
        serviceNames: services.map(function (s) { return s.name; }).filter(Boolean)
    };
}

function contextBlock(ctx) {
    const lines = [];
    if (ctx.name) lines.push("Name: " + ctx.name);
    if (ctx.profession) lines.push("Profession: " + ctx.profession);
    if (ctx.specialties) lines.push("Specialties: " + ctx.specialties);
    if (ctx.location) lines.push("Location: " + ctx.location);
    if (ctx.existingBio) lines.push("Existing bio (may be rough): " + ctx.existingBio);
    if (ctx.projectTitles.length) lines.push("Published project titles: " + ctx.projectTitles.join(", "));
    if (ctx.projectCategories.length) lines.push("Project categories: " + ctx.projectCategories.join(", "));
    if (ctx.serviceNames.length) lines.push("Services offered: " + ctx.serviceNames.join(", "));
    return lines.join("\n");
}

// ---------- Gemini ----------
async function callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured on the server");

    const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
                model + ":generateContent?key=" + encodeURIComponent(apiKey);

    const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.75, maxOutputTokens: 600, topP: 0.95 }
    };

    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
        const msg = (data && data.error && data.error.message) || ("Gemini error " + resp.status);
        throw new Error(msg);
    }
    const candidates = (data && data.candidates) || [];
    if (!candidates.length) throw new Error("Gemini returned no candidates");

    const parts = (candidates[0].content && candidates[0].content.parts) || [];
    const text = parts.map(function (p) { return p.text || ""; }).join("").trim();
    if (!text) throw new Error("Gemini returned empty text");
    return text;
}

function parseList(raw) {
    // Strip markdown fences + numbered lists + bullets, then split by newline
    let s = String(raw || "").trim();
    s = s.replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const lines = s.split(/\r?\n/);
    const items = [];
    lines.forEach(function (line) {
        const t = line
            .replace(/^\s*[\-\*•]\s*/, "")
            .replace(/^\s*\d+[.)]\s*/, "")
            .replace(/^["'`]|["'`]$/g, "")
            .trim();
        if (t && t.length >= 3) items.push(t);
    });
    return items;
}

// ---------- Plan gate ----------
function gateBusiness(req, res) {
    const plan = entitlementService.getUserPlan(req.user.id);
    if (plan !== "business") {
        res.status(403).json({
            success: false,
            message: "AI content writing is a Business plan feature.",
            required_plan: "business"
        });
        return false;
    }
    return true;
}

// ---------- POST /api/portfolio/ai/write-title ----------
exports.writeTitle = async (req, res) => {
    try {
        if (!gateBusiness(req, res)) return;

        const ctx = loadUserContext(req.user.id);
        if (!ctx.profession && !ctx.specialties && !ctx.projectTitles.length) {
            return res.status(400).json({
                success: false,
                message: "Add a profession, skills, or at least one published project first."
            });
        }

        const tone = ["professional","confident","friendly","minimal"].includes(req.body.tone)
            ? req.body.tone : "professional";

        const prompt = [
            "You are Crevio's portfolio copywriter.",
            "",
            "Write 3 short portfolio TITLES for the following creator. Each title is",
            "a single line — name + a tight descriptor of what they do. Max 60 chars each.",
            "",
            "Tone: " + tone,
            "",
            "Creator data:",
            contextBlock(ctx),
            "",
            "Return ONLY 3 lines, one per title. No numbering, no bullets, no explanation.",
            "Do not wrap in quotes. Do not use emojis."
        ].join("\n");

        const raw = await callGemini(prompt);
        const titles = parseList(raw).slice(0, 3);
        if (!titles.length) {
            return res.status(502).json({ success: false, message: "AI returned no usable titles." });
        }
        res.json({ success: true, titles: titles });
    } catch (err) {
        console.error("aiContent.writeTitle:", err.message);
        res.status(500).json({ success: false, message: err.message || "AI request failed" });
    }
};

// ---------- POST /api/portfolio/ai/suggest-taglines ----------
exports.suggestTaglines = async (req, res) => {
    try {
        if (!gateBusiness(req, res)) return;

        const ctx = loadUserContext(req.user.id);
        if (!ctx.profession && !ctx.specialties) {
            return res.status(400).json({
                success: false,
                message: "Add a profession or skills first so the AI knows what you do."
            });
        }

        let count = parseInt(req.body.count, 10);
        if (!count || count < 3 || count > 8) count = 5;

        const prompt = [
            "You are Crevio's portfolio copywriter.",
            "",
            "Write " + count + " TAGLINES for the creator below.",
            "A tagline is one short sentence (max 100 chars) that lives under their name",
            "and tells a visitor what they do and who they help.",
            "",
            "Rules:",
            "- Be specific to their niche. No generic phrases like 'passionate creator'.",
            "- No emojis. No hashtags. No quotes.",
            "- Each tagline should feel distinct in angle (benefit, method, audience, tone).",
            "",
            "Creator data:",
            contextBlock(ctx),
            "",
            "Return ONLY the " + count + " taglines, one per line. No numbering, no bullets."
        ].join("\n");

        const raw = await callGemini(prompt);
        const taglines = parseList(raw).slice(0, count);
        if (!taglines.length) {
            return res.status(502).json({ success: false, message: "AI returned no usable taglines." });
        }
        res.json({ success: true, taglines: taglines });
    } catch (err) {
        console.error("aiContent.suggestTaglines:", err.message);
        res.status(500).json({ success: false, message: err.message || "AI request failed" });
    }
};

// ---------- POST /api/portfolio/ai/rewrite-description ----------
exports.rewriteDescription = async (req, res) => {
    try {
        if (!gateBusiness(req, res)) return;

        const text = String(req.body.text || "").trim();
        if (text.length < 10) {
            return res.status(400).json({ success: false, message: "Paste a description to rewrite (min 10 characters)." });
        }
        if (text.length > 3000) {
            return res.status(400).json({ success: false, message: "Text too long (max 3000 characters)." });
        }

        const kind = ["project","service","bio","general"].includes(req.body.kind)
            ? req.body.kind : "general";

        const ctx = loadUserContext(req.user.id);

        const prompt = [
            "You are Crevio's portfolio copywriter.",
            "",
            "Rewrite the following " + kind + " description to be sharper, more specific,",
            "and more professional. Keep the same first-person voice if present.",
            "Preserve all factual details. Remove filler. Cut clichés.",
            "Aim for 2-4 sentences unless the original is longer.",
            "",
            "Creator context (for tone matching only — do not add facts not in the original):",
            contextBlock(ctx),
            "",
            "Original text:",
            text,
            "",
            "Return ONLY the rewritten text. No preamble, no quotes, no markdown."
        ].join("\n");

        const raw = await callGemini(prompt);
        let rewritten = String(raw || "").trim();
        rewritten = rewritten.replace(/^```(?:text)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        if (!rewritten) {
            return res.status(502).json({ success: false, message: "AI returned empty text." });
        }
        res.json({ success: true, rewritten: rewritten, original: text });
    } catch (err) {
        console.error("aiContent.rewriteDescription:", err.message);
        res.status(500).json({ success: false, message: err.message || "AI request failed" });
    }
};