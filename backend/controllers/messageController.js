// =========================================================
// CREVIO — MESSAGE CONTROLLER
// File: backend/controllers/messageController.js
// =========================================================

const db = require("../../database/db");
const entitlementService = require("../services/entitlementService");
const notificationService = require("../services/notificationService");

function safeGet(sql, ...p) { try { return db.prepare(sql).get(...p); } catch { return null; } }
function safeAll(sql, ...p) { try { return db.prepare(sql).all(...p); } catch { return []; } }
function hasCol(t, c) { try { return db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c); } catch { return false; } }

const C = {
    pinned:          hasCol("conversations","pinned")          ? "c.pinned"          : "0 AS pinned",
    client_pinned:   hasCol("conversations","client_pinned")   ? "c.client_pinned"   : "0 AS client_pinned",
    muted:           hasCol("conversations","muted")           ? "c.muted"           : "0 AS muted",
    manually_unread: hasCol("conversations","manually_unread") ? "c.manually_unread" : "0 AS manually_unread",
    list_name:       hasCol("conversations","list_name")       ? "c.list_name"       : "NULL AS list_name"
};

const M = {
    deleted:     hasCol("messages","deleted")     ? "m.deleted"     : "0 AS deleted",
    edited:      hasCol("messages","edited")      ? "m.edited"      : "0 AS edited",
    pinned:      hasCol("messages","pinned")      ? "m.pinned"      : "0 AS pinned",
    starred:     hasCol("messages","starred")     ? "m.starred"     : "0 AS starred",
    reported:    hasCol("messages","reported")    ? "m.reported"    : "0 AS reported",
    reply_to_id: hasCol("messages","reply_to_id") ? "m.reply_to_id" : "NULL AS reply_to_id",
    reactions:   hasCol("messages","reactions")   ? "m.reactions"   : "NULL AS reactions"
};

// =========================================================
// STATS
// =========================================================

// =========================================================
// BUSINESS-ONLY EMOJI GATE
// Only Business plan users can react with these emojis.
// Clients (visitor side) always get full access.
// =========================================================
const BASIC_EMOJIS = [
    "\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}",
    "\u{1F622}", "\u{1F64F}"
];

function isEmojiAllowedForCreator(plan, emoji) {
    if (plan === "business") return true;
    return BASIC_EMOJIS.indexOf(emoji) >= 0;
}


exports.getStats = (req, res) => {
    try {
        const uid = req.user.id;
        const total    = safeGet("SELECT COUNT(*) AS c FROM conversations WHERE creator_id=? AND (archived=0 OR archived IS NULL)", uid)?.c || 0;
        const unread   = safeGet(`SELECT COUNT(DISTINCT c.id) AS c FROM conversations c
                                  JOIN messages m ON m.conversation_id=c.id
                                  WHERE c.creator_id=? AND m.sender_type='client'
                                    AND m.read_at IS NULL AND (c.archived=0 OR c.archived IS NULL)
                                    AND (c.muted=0 OR c.muted IS NULL)`, uid)?.c || 0;
        const starred  = safeGet("SELECT COUNT(*) AS c FROM conversations WHERE creator_id=? AND starred=1", uid)?.c || 0;
        const archived = safeGet("SELECT COUNT(*) AS c FROM conversations WHERE creator_id=? AND archived=1", uid)?.c || 0;
        res.json({ success: true, stats: { total, unread, starred, archived } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// LIST CONVERSATIONS
// Sort: creator-pinned â†’ client-pinned â†’ recent
// =========================================================
exports.getConversations = (req, res) => {
    try {
        const uid = req.user.id;
        const filter = (req.query.filter || "all").toLowerCase();
        const search = (req.query.search || "").trim().toLowerCase();

        let sql = `
            SELECT c.*, ${C.pinned}, ${C.client_pinned}, ${C.muted}, ${C.manually_unread}, ${C.list_name},
                (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
                (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND sender_type='client' AND read_at IS NULL) AS unread_count,
                s.title AS context_service_title, s.id AS context_service_id,
                p.name  AS context_project_title, p.id AS context_project_id
            FROM conversations c
            LEFT JOIN services s ON s.id = c.service_id
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.creator_id = ?
        `;
        const params = [uid];

        if (filter === "archived") sql += " AND c.archived = 1";
        else {
            sql += " AND (c.archived = 0 OR c.archived IS NULL)";
            if (filter === "starred") sql += " AND c.starred = 1";
        }
        if (search) {
            sql += " AND (LOWER(COALESCE(c.client_name,'')) LIKE ? OR LOWER(COALESCE(c.client_email,'')) LIKE ?)";
            params.push(`%${search}%`, `%${search}%`);
        }
        sql += ` ORDER BY COALESCE(c.pinned,0) DESC, COALESCE(c.client_pinned,0) DESC, COALESCE(c.updated_at,c.created_at) DESC`;

        let rows = safeAll(sql, ...params);
        if (filter === "unread") rows = rows.filter(r => r.unread_count > 0 || r.manually_unread === 1);

        res.json({
            success: true,
            conversations: rows.map(r => ({
                ...r,
                other_user_name: r.client_name || "Client",
                other_user_email: r.client_email || null,
                title: r.client_name || "Client"
            }))
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// GET ONE CONVERSATION + ITS MESSAGES
// =========================================================
exports.getConversation = (req, res) => {
    try {
        const uid = req.user.id;
        const conv = safeGet(`
            SELECT c.*, ${C.pinned}, ${C.client_pinned}, ${C.muted}, ${C.manually_unread}, ${C.list_name},
                s.title AS context_service_title, s.id AS context_service_id,
                p.name  AS context_project_title, p.id AS context_project_id
            FROM conversations c
            LEFT JOIN services s ON s.id = c.service_id
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.id = ? AND c.creator_id = ?
        `, req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });

        const messages = safeAll(`
            SELECT m.id, m.conversation_id, m.sender_type, m.content, m.attachments, m.read_at, m.delivered_at, m.pinned_until, m.created_at,
                   ${M.deleted}, ${M.edited}, ${M.pinned}, ${M.starred}, ${M.reported}, ${M.reply_to_id}, ${M.reactions},
                   CASE WHEN m.sender_type='creator' THEN 1 ELSE 0 END AS is_mine
            FROM messages m WHERE m.conversation_id = ? AND (m.deleted_for_creator = 0 OR m.deleted_for_creator IS NULL) ORDER BY m.created_at ASC
        `, req.params.id);

        try {
            db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND sender_type='client' AND read_at IS NULL").run(req.params.id);
            db.prepare("UPDATE conversations SET manually_unread=0 WHERE id=?").run(req.params.id);
        } catch {}

        res.json({
            success: true,
            conversation: {
                ...conv, manually_unread: 0,
                other_user_name: conv.client_name || "Client",
                other_user_email: conv.client_email || null,
                title: conv.client_name || "Client"
            },
            messages
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// SEND REPLY
// =========================================================
exports.sendMessage = (req, res) => {
    try {
        const uid = req.user.id;
        const text = (req.body.body || req.body.content || "").trim();
        if (!text) return res.status(400).json({ success: false, message: "Message required" });

        // Plan-based length enforcement (creator messages only)
        if (req.user && req.user.id) {
            const maxLength = entitlementService.limitFor(req.user.id, "messages.max_length");
            const cap = entitlementService.isUnlimited(maxLength)
                ? entitlementService.TECHNICAL_CAPS.message_length
                : maxLength;
            if (text.length > cap) {
                const planId = entitlementService.getUserPlan(req.user.id);
                const cfg = entitlementService.getPlanConfig(planId);
                const upgradeTo = cfg && cfg.upgradeTo
                    ? entitlementService.getPlanConfig(cfg.upgradeTo)
                    : null;
                return res.status(403).json({
                    success: false,
                    message: upgradeTo
                        ? ("Message is " + text.length + " characters - your " + cfg.name + " plan allows " + cap + ". Upgrade to " + upgradeTo.name + " for longer messages.")
                        : ("Message exceeds the technical limit of " + cap + " characters."),
                    code: "MESSAGE_TOO_LONG",
                    limit: cap,
                    current: text.length,
                    plan: planId,
                    upgradeTo: upgradeTo ? upgradeTo.id : null
                });
            }
        } else if (text.length > entitlementService.TECHNICAL_CAPS.message_length) {
            return res.status(400).json({ success: false, message: "Message too long" });
        }
        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });

        const replyToId = req.body.reply_to_id || null;
        const cols = ["conversation_id","sender_type","content"];
        const vals = [req.params.id, "creator", text];
        if (hasCol("messages","reply_to_id")) { cols.splice(3,0,"reply_to_id"); vals.splice(3,0,replyToId); }

        const r = db.prepare(`INSERT INTO messages (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).run(...vals);
        try { db.prepare("UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id); } catch {}

        const message = safeGet(`
            SELECT m.*, m.delivered_at, ${M.deleted}, ${M.edited}, ${M.pinned}, ${M.starred}, ${M.reported}, ${M.reply_to_id}, ${M.reactions}, 1 AS is_mine
            FROM messages m WHERE m.id=?
        `, r.lastInsertRowid);
        res.json({ success: true, message });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// UPDATE CONVERSATION (star, pin, mute, etc.)
// =========================================================
exports.updateConversation = (req, res) => {
    try {
        const uid = req.user.id;
        const ex = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!ex) return res.status(404).json({ success: false, message: "Not found" });

        const allowed = ["status","starred","archived","notes","pinned","muted","manually_unread","list_name","client_pinned"];
        const updates = {};
        for (const k of allowed) {
            if (req.body[k] === undefined) continue;
            if (!hasCol("conversations", k)) continue;
            if (["starred","archived","pinned","muted","manually_unread","client_pinned"].includes(k)) {
                updates[k] = req.body[k] ? 1 : 0;
            } else if (k === "list_name") {
                updates[k] = req.body[k] ? String(req.body[k]).slice(0,80) : null;
            } else {
                updates[k] = req.body[k];
            }
        }
        if (!Object.keys(updates).length) return res.json({ success: true, message: "Nothing to update" });

        const set = Object.keys(updates).map(k => `${k}=?`).join(", ");
        const vals = Object.values(updates);
        let sql = `UPDATE conversations SET ${set}`;
        if (hasCol("conversations","updated_at")) sql += ", updated_at=CURRENT_TIMESTAMP";
        sql += " WHERE id=? AND creator_id=?";
        vals.push(req.params.id, uid);
        db.prepare(sql).run(...vals);
        res.json({ success: true, conversation: safeGet("SELECT * FROM conversations WHERE id=?", req.params.id) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// UPDATE SINGLE MESSAGE (pin/star/report/delete/edit)
// =========================================================
exports.updateMessage = (req, res) => {
    try {
        const uid = req.user.id;
        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });
        const msg = safeGet("SELECT * FROM messages WHERE id=? AND conversation_id=?", req.params.msgId, req.params.id);
        if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

        // ===== EDIT RESTRICTIONS =====
        if (req.body.content !== undefined) {
            if (msg.sender_type !== "creator") {
                return res.status(403).json({ success: false, message: "You can only edit your own messages" });
            }
            const editPlan = getUserPlan(uid);
            if (editPlan !== "pro" && editPlan !== "business") {
                return res.status(403).json({
                    success: false,
                    message: "Editing messages is only available on Pro and Business plans",
                    plan: editPlan,
                    upgrade_required: true
                });
            }
            const EDIT_WINDOW_MS = 10 * 60 * 1000;
            const sentRaw = String(msg.created_at || "");
            const sentIso = sentRaw.includes("T") ? sentRaw : sentRaw.replace(" ", "T");
            const sentWithZ = sentIso.endsWith("Z") ? sentIso : sentIso + "Z";
            const sentAt = new Date(sentWithZ).getTime();
            if (!isNaN(sentAt) && (Date.now() - sentAt) > EDIT_WINDOW_MS) {
                return res.status(403).json({
                    success: false,
                    message: "Messages can only be edited within 10 minutes of sending"
                });
            }
        }
        // ===== END EDIT RESTRICTIONS =====

        const allowed = ["pinned","starred","reported","deleted","content"];
        const updates = {};
        for (const k of allowed) {
            if (req.body[k] === undefined) continue;
            if (!hasCol("messages", k)) continue;
            if (["pinned","starred","reported","deleted"].includes(k)) updates[k] = req.body[k] ? 1 : 0;
            else updates[k] = String(req.body[k]);
        }
        if (req.body.content !== undefined && hasCol("messages","edited")) updates.edited = 1;
        if (!Object.keys(updates).length) return res.json({ success: true, message: "Nothing to update" });

        const set = Object.keys(updates).map(k => `${k}=?`).join(", ");
        const vals = Object.values(updates);
        vals.push(req.params.msgId, req.params.id);
        db.prepare(`UPDATE messages SET ${set} WHERE id=? AND conversation_id=?`).run(...vals);

        const updated = safeGet(`
            SELECT m.*, m.delivered_at, ${M.deleted}, ${M.edited}, ${M.pinned}, ${M.starred}, ${M.reported}, ${M.reply_to_id}, ${M.reactions},
                   CASE WHEN m.sender_type='creator' THEN 1 ELSE 0 END AS is_mine
            FROM messages m WHERE m.id=?
        `, req.params.msgId);
        res.json({ success: true, message: updated });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// TOGGLE REACTION — single reaction per user per message
// Picking a new emoji replaces the old one. Clicking the same one removes it.
// =========================================================
exports.toggleReaction = (req, res) => {
    try {
        const uid = req.user.id;
        const { emoji, side } = req.body;
        if (!emoji) return res.status(400).json({ success: false, message: "emoji required" });
        const who = side === "client" ? "client" : "creator";

        // Plan gate: only Business plan creators can use premium emojis.
        // Clients always get full access.
        if (who === "creator") {
            const plan = getUserPlan(uid);
            if (!isEmojiAllowedForCreator(plan, emoji)) {
                return res.status(403).json({
                    success: false,
                    message: "Upgrade to Business plan to use this emoji",
                    upgrade: true,
                    plan: plan
                });
            }
        }

        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });
        if (!hasCol("messages","reactions")) return res.status(400).json({ success: false, message: "Run migration first" });

        const msg = safeGet("SELECT * FROM messages WHERE id=? AND conversation_id=?", req.params.msgId, req.params.id);
        if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

        let reactions = {};
        try { reactions = msg.reactions ? JSON.parse(msg.reactions) : {}; } catch { reactions = {}; }

        // Was user already on THIS emoji?
        const alreadyHere = Array.isArray(reactions[emoji]) && reactions[emoji].includes(who);

        // Remove user from every emoji
        for (const e of Object.keys(reactions)) {
            if (!Array.isArray(reactions[e])) { delete reactions[e]; continue; }
            const i = reactions[e].indexOf(who);
            if (i >= 0) reactions[e].splice(i, 1);
            if (reactions[e].length === 0) delete reactions[e];
        }

        // If they weren't already on this exact emoji, add them (single reaction rule)
        if (!alreadyHere) {
            if (!Array.isArray(reactions[emoji])) reactions[emoji] = [];
            reactions[emoji].push(who);
        }

        db.prepare("UPDATE messages SET reactions=? WHERE id=?").run(JSON.stringify(reactions), req.params.msgId);
        res.json({ success: true, reactions });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// SOFT-DELETE SINGLE MESSAGE
// =========================================================
exports.deleteMessage = (req, res) => {
    try {
        const uid = req.user.id;
        const scope = (req.query.scope || "everyone").toLowerCase();
        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });

        if (scope === "me") {
            if (hasCol("messages","deleted_for_creator")) {
                db.prepare("UPDATE messages SET deleted_for_creator=1 WHERE id=? AND conversation_id=?").run(req.params.msgId, req.params.id);
            } else {
                db.prepare("DELETE FROM messages WHERE id=? AND conversation_id=?").run(req.params.msgId, req.params.id);
            }
        } else {
            if (hasCol("messages","deleted")) {
                db.prepare("UPDATE messages SET deleted=1, content='' WHERE id=? AND conversation_id=?").run(req.params.msgId, req.params.id);
            } else {
                db.prepare("DELETE FROM messages WHERE id=? AND conversation_id=?").run(req.params.msgId, req.params.id);
            }
        }
        res.json({ success: true, scope });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// DELETE CONVERSATION (with its messages)
// =========================================================
exports.deleteConversation = (req, res) => {
    try {
        const uid = req.user.id;
        const r = db.prepare("DELETE FROM conversations WHERE id=? AND creator_id=?").run(req.params.id, uid);
        if (!r.changes) return res.status(404).json({ success: false, message: "Not found" });
        try { db.prepare("DELETE FROM messages WHERE conversation_id=?").run(req.params.id); } catch {}
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// CLEAR ALL MESSAGES IN A CONVERSATION
// =========================================================
exports.clearMessages = (req, res) => {
    try {
        const uid = req.user.id;
        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });
        db.prepare("DELETE FROM messages WHERE conversation_id=?").run(req.params.id);
        try { db.prepare("UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id); } catch {}
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// CLIENT PIN (public — for the visitor's side)
// =========================================================
exports.clientPinConversation = (req, res) => {
    try {
        const { email, pin } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "email required" });
        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND LOWER(client_email)=LOWER(?)", req.params.id, email);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });
        if (!hasCol("conversations","client_pinned")) return res.status(400).json({ success: false, message: "Run migration first" });
        const val = (pin === false || pin === 0) ? 0 : 1;
        db.prepare("UPDATE conversations SET client_pinned=? WHERE id=?").run(val, req.params.id);
        res.json({ success: true, client_pinned: val });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// MARK ALL AS READ
// =========================================================
exports.markAllRead = (req, res) => {
    try {
        const uid = req.user.id;
        db.prepare(`UPDATE messages SET read_at=CURRENT_TIMESTAMP
                    WHERE sender_type='client' AND read_at IS NULL
                      AND conversation_id IN (SELECT id FROM conversations WHERE creator_id=?)`).run(uid);
        try { db.prepare("UPDATE conversations SET manually_unread=0 WHERE creator_id=?").run(uid); } catch {}
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// PUBLIC — START CONVERSATION
// =========================================================
exports.startConversation = (req, res) => {
    try {
        const { creator_id, client_name, client_email, service_id, project_id, source, budget, timeline, notes, message } = req.body;
        if (!creator_id || !client_email) return res.status(400).json({ success: false, message: "creator_id and client_email required" });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(client_email)) return res.status(400).json({ success: false, message: "Invalid email" });

        let conv = service_id
            ? safeGet("SELECT * FROM conversations WHERE creator_id=? AND client_email=? AND service_id=? LIMIT 1", creator_id, client_email, service_id)
            : safeGet("SELECT * FROM conversations WHERE creator_id=? AND client_email=? LIMIT 1", creator_id, client_email);

        if (!conv) {
            const r = db.prepare(`
                INSERT INTO conversations (creator_id, client_name, client_email, service_id, project_id, status, source, budget, timeline, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(creator_id, client_name || "Anonymous", client_email, service_id || null, project_id || null, source || "portfolio", budget || null, timeline || null, notes || null);
            conv = { id: r.lastInsertRowid };
        }
        if (message && message.trim()) {
            db.prepare("INSERT INTO messages (conversation_id, sender_type, content, created_at) VALUES (?, 'client', ?, CURRENT_TIMESTAMP)")
              .run(conv.id, message.trim());
        }
        try {
            const __who = (client_name && String(client_name).trim()) || "a client";
            const __prev = message && String(message).trim()
                ? String(message).trim().slice(0, 180)
                : "New inquiry received.";
            notificationService.create({
                userId: creator_id,
                type: "message",
                title: "New message from " + __who,
                message: __prev,
                entityType: "conversation",
                entityId: conv.id
            });
        } catch (e) { /* silent */ }

        res.json({ success: true, conversation_id: conv.id });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// PUBLIC — visitor side of a conversation
// Body: { email }
// Marks creator-sent messages as delivered + read
// =========================================================
exports.getVisitorConversation = (req, res) => {
    try {
        const email = (req.body.email || req.query.email || "").trim();
        if (!email) return res.status(400).json({ success: false, message: "email required" });

        const conv = safeGet(
            "SELECT * FROM conversations WHERE id=? AND LOWER(client_email)=LOWER(?)",
            req.params.id, email
        );
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });

        // Mark all creator messages as delivered + read for this visitor
        try {
            db.prepare("UPDATE messages SET delivered_at=COALESCE(delivered_at, CURRENT_TIMESTAMP) WHERE conversation_id=? AND sender_type='creator'").run(req.params.id);
            db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND sender_type='creator' AND read_at IS NULL").run(req.params.id);
        } catch {}

        const messages = safeAll(`
            SELECT m.id, m.conversation_id, m.sender_type, m.content, m.attachments, m.read_at, m.delivered_at, m.created_at,
                   ${M.deleted}, ${M.edited}, ${M.pinned}, ${M.starred}, ${M.reported}, ${M.reply_to_id}, ${M.reactions},
                   CASE WHEN m.sender_type='creator' THEN 1 ELSE 0 END AS is_mine
            FROM messages m
            WHERE m.conversation_id = ? AND (m.deleted_for_creator = 0 OR m.deleted_for_creator IS NULL)
            ORDER BY m.created_at ASC
        `, req.params.id);

        res.json({ success: true, conversation: conv, messages });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// =========================================================
// PLAN-BASED CHARACTER LIMITS
// =========================================================
// Pin durations are in HOURS: 24h = 1 day, 168h = 7 days, 720h = 30 days
const PIN_CONFIG = {
    free:     { durations: [24],           maxPerChat: 2 },
    pro:      { durations: [24, 168],      maxPerChat: 3 },
    business: { durations: [24, 168, 720], maxPerChat: 4 }
};

function getPinConfig(plan) {
    return PIN_CONFIG[plan] || PIN_CONFIG.free;
}

function pinLabel(hours) {
    if (hours < 48)  return hours + " hours";
    if (hours < 720) return Math.round(hours / 24) + " days";
    return "30 days";
}

const PLAN_LIMITS = {
    free:     1000,
    pro:      5000,
    business: Infinity
};

function getUserPlan(userId) {
    try {
        // 1) Preferred: read from subscriptions (same source as Billing page)
        try {
            const sub = db.prepare(
                "SELECT plan, status FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
            ).get(userId);
            if (sub && sub.plan && (sub.status === "active" || !sub.status)) {
                const raw = String(sub.plan).toLowerCase().trim();
                if (raw.includes("business") || raw.includes("enterprise")) return "business";
                if (raw.includes("pro") || raw.includes("premium"))         return "pro";
                if (raw) return "free";
            }
        } catch (e) { /* no subscriptions table — fall through */ }

        // 2) Fallback: users.plan column
        const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
        const planCol = ["plan","subscription_plan","plan_type","tier"].find(c => cols.includes(c));
        if (planCol) {
            const row = db.prepare(`SELECT ${planCol} AS p FROM users WHERE id = ?`).get(userId);
            const raw = (row && row.p) ? String(row.p).toLowerCase().trim() : "free";
            if (raw.includes("business") || raw.includes("enterprise")) return "business";
            if (raw.includes("pro") || raw.includes("premium"))         return "pro";
        }
        return "free";
    } catch (e) { return "free"; }
}

function getPlanLimit(plan) {
    return PLAN_LIMITS[plan] !== undefined ? PLAN_LIMITS[plan] : PLAN_LIMITS.free;
}

exports.getMyPlanLimit = (req, res) => {
    const plan = getUserPlan(req.user.id);
    const limit = getPlanLimit(plan);
    res.json({
        success: true,
        plan,
        limit: limit === Infinity ? null : limit,   // null = unlimited
        unlimited: limit === Infinity
    });
};


// =========================================================
// GET /api/messages/pin-options
// Returns durations + maxPerChat for the current plan.
// =========================================================
exports.getPinOptions = (req, res) => {
    try {
        const plan = getUserPlan(req.user.id);
        const cfg = getPinConfig(plan);
        res.json({
            success: true,
            plan,
            durations: cfg.durations.map(h => ({ hours: h, label: pinLabel(h) })),
            maxPerChat: cfg.maxPerChat
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// =========================================================
// POST /api/messages/conversations/:id/messages/:msgId/pin
// Body: { hours: 24 | 168 | 720 }
// =========================================================
exports.pinMessage = (req, res) => {
    try {
        const uid = req.user.id;
        const hours = parseInt(req.body.hours, 10);

        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });

        const msg = safeGet("SELECT * FROM messages WHERE id=? AND conversation_id=?", req.params.msgId, req.params.id);
        if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

        const plan = getUserPlan(uid);
        const cfg = getPinConfig(plan);

        if (!cfg.durations.includes(hours)) {
            return res.status(403).json({
                success: false,
                message: "Your plan does not allow a " + hours + "-hour pin. Upgrade to unlock longer durations.",
                plan,
                allowed: cfg.durations
            });
        }

        // Expire old pins first so we count accurately
        try {
            db.prepare("UPDATE messages SET pinned=0, pinned_until=NULL WHERE pinned=1 AND pinned_until IS NOT NULL AND pinned_until < CURRENT_TIMESTAMP").run();
        } catch (e) {}

        // Count active pins in this conversation (excluding this message)
        const activePins = safeAll(
            "SELECT id FROM messages WHERE conversation_id=? AND pinned=1 AND id != ?",
            req.params.id, req.params.msgId
        );

        if (activePins.length >= cfg.maxPerChat) {
            return res.status(403).json({
                success: false,
                message: "Your " + plan + " plan allows up to " + cfg.maxPerChat + " pinned messages per chat. Unpin one first or upgrade.",
                plan,
                maxPerChat: cfg.maxPerChat,
                current: activePins.length
            });
        }

        db.prepare(
            "UPDATE messages SET pinned=1, pinned_until=datetime('now', '+' || ? || ' hours') WHERE id=?"
        ).run(hours, req.params.msgId);

        const updated = safeGet(`
            SELECT m.*, ${M.deleted}, ${M.edited}, ${M.pinned}, ${M.starred}, ${M.reported}, ${M.reply_to_id}, ${M.reactions},
                   m.pinned_until,
                   CASE WHEN m.sender_type='creator' THEN 1 ELSE 0 END AS is_mine
            FROM messages m WHERE m.id=?
        `, req.params.msgId);

        res.json({ success: true, message: updated, pinned_until: updated.pinned_until });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// =========================================================
// DELETE /api/messages/conversations/:id/messages/:msgId/pin
// Unpins a message immediately.
// =========================================================
exports.unpinMessage = (req, res) => {
    try {
        const uid = req.user.id;
        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND creator_id=?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });

        db.prepare("UPDATE messages SET pinned=0, pinned_until=NULL WHERE id=? AND conversation_id=?").run(req.params.msgId, req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// =========================================================
// POST /api/messages/forward
// Body: { message_ids: [1,2,...], conversation_ids: [3,5,...], note?: "hi" }
// Sends each message to each conversation as a creator message.
// Returns { sent: N } where N = message_ids × conversation_ids.
// =========================================================
exports.forwardMessage = (req, res) => {
    try {
        const uid = req.user.id;
        const messageIds  = Array.isArray(req.body.message_ids)  ? req.body.message_ids.slice(0, 100)  : [];
        const convIds     = Array.isArray(req.body.conversation_ids) ? req.body.conversation_ids.slice(0, 50) : [];
        const note        = (req.body.note || "").trim();

        if (!messageIds.length)  return res.status(400).json({ success: false, message: "message_ids required" });
        if (!convIds.length)     return res.status(400).json({ success: false, message: "conversation_ids required" });

        // Load the messages being forwarded
        const placeholders = messageIds.map(() => "?").join(",");
        const msgs = safeAll(
            `SELECT id, content, sender_type FROM messages WHERE id IN (${placeholders})`,
            ...messageIds
        );
        if (!msgs.length) return res.status(404).json({ success: false, message: "No messages found" });

        // Verify each target conversation belongs to this user
        const owned = safeAll(
            `SELECT id FROM conversations WHERE creator_id = ? AND id IN (${convIds.map(() => "?").join(",")})`,
            uid, ...convIds
        );
        const allowedIds = owned.map(o => o.id);
        if (!allowedIds.length) return res.status(403).json({ success: false, message: "No valid conversations" });

        let sent = 0;
        const timestamp = new Date().toISOString();

        const insertStmt = db.prepare(
            "INSERT INTO messages (conversation_id, sender_type, content, created_at) VALUES (?, 'creator', ?, CURRENT_TIMESTAMP)"
        );

        for (const convId of allowedIds) {
            for (const m of msgs) {
                let body = m.content || "";
                if (note) body = note + "\n\n" + body;
                // Mark as forwarded in content so recipient knows
                body = "↪ Forwarded\n" + body;
                try {
                    insertStmt.run(convId, body);
                    sent++;
                } catch (e) {}
            }
            try { db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(convId); } catch (e) {}
        }

        res.json({ success: true, sent, conversations: allowedIds.length, messages: msgs.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// =========================================================
// GET /api/messages/conversations/:id/context
// Returns rich context for the panel: client stats, related inquiries, notes
// =========================================================
exports.getConversationContext = (req, res) => {
    try {
        const uid = req.user.id;
        const conv = safeGet("SELECT * FROM conversations WHERE id = ? AND creator_id = ?", req.params.id, uid);
        if (!conv) return res.status(404).json({ success: false, message: "Not found" });

        // Message stats
        const stats = safeGet(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN sender_type = 'creator' THEN 1 ELSE 0 END) AS mine,
                SUM(CASE WHEN sender_type = 'client'  THEN 1 ELSE 0 END) AS theirs,
                MIN(created_at) AS first_at,
                MAX(created_at) AS last_at
            FROM messages
            WHERE conversation_id = ?
              AND (deleted_for_creator = 0 OR deleted_for_creator IS NULL)
        `, req.params.id) || {};

        // Other conversations from the same client
        let related = [];
        if (conv.client_email) {
            related = safeAll(`
                SELECT c.id, c.status, c.created_at,
                    (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at ASC LIMIT 1) AS first_message
                FROM conversations c
                WHERE c.creator_id = ? AND LOWER(c.client_email) = LOWER(?) AND c.id != ?
                ORDER BY c.created_at DESC LIMIT 5
            `, uid, conv.client_email, req.params.id);
        }

        // Related service/project titles
        let serviceTitle = null, projectTitle = null;
        if (conv.service_id) {
            const s = safeGet("SELECT title FROM services WHERE id = ?", conv.service_id);
            if (s) serviceTitle = s.title;
        }
        if (conv.project_id) {
            const p = safeGet("SELECT name FROM projects WHERE id = ?", conv.project_id);
            if (p) projectTitle = p.name;
        }

        const firstAt = stats.first_at ? new Date(stats.first_at.replace(" ", "T") + "Z") : null;
        const ageDays = firstAt ? Math.max(0, Math.floor((Date.now() - firstAt.getTime()) / 86400000)) : 0;

        // Client label
        const clientName = conv.client_name || "Client";
        const initial = clientName.charAt(0).toUpperCase();

        // "New" vs "Returning" — based on total conversations from this email
        let convCount = 1;
        if (conv.client_email) {
            const row = safeGet(
                "SELECT COUNT(*) AS c FROM conversations WHERE creator_id = ? AND LOWER(client_email) = LOWER(?)",
                uid, conv.client_email
            );
            if (row) convCount = row.c;
        }

        res.json({
            success: true,
            context: {
                client: {
                    name: clientName,
                    email: conv.client_email || "",
                    initial: initial,
                    badge: convCount > 1 ? "Returning client" : "New client",
                    conversation_count: convCount
                },
                stats: {
                    total: stats.total || 0,
                    mine: stats.mine || 0,
                    theirs: stats.theirs || 0,
                    age_days: ageDays,
                    first_message_at: stats.first_at || null,
                    last_message_at: stats.last_at || null
                },
                meta: {
                    source: conv.source || "portfolio",
                    service_title: serviceTitle,
                    project_title: projectTitle,
                    budget: conv.budget || null,
                    timeline: conv.timeline || null
                },
                related: related.map(function (r) {
                    return {
                        id: r.id,
                        status: r.status || "new",
                        created_at: r.created_at,
                        preview: (r.first_message || "").slice(0, 80)
                    };
                }),
                notes: conv.notes || ""
            }
        });
    } catch (err) {
        console.error("Context error:", err);
        res.status(500).json({ success: false, message: "Failed", error: err.message });
    }
};

// =========================================================
// PUBLIC — visitor sends a follow-up message
// Body: { conversation_id, email, message }
// =========================================================
exports.sendVisitorMessage = (req, res) => {
    try {
        const conversationId = parseInt(req.body.conversation_id, 10);
        const email = (req.body.email || "").trim();
        const message = (req.body.message || "").trim();

        if (!conversationId) return res.status(400).json({ success: false, message: "conversation_id required" });
        if (!email) return res.status(400).json({ success: false, message: "email required" });
        if (!message) return res.status(400).json({ success: false, message: "message required" });
        if (message.length > 2000) return res.status(400).json({ success: false, message: "Message too long (max 2000 chars)" });

        const conv = safeGet("SELECT * FROM conversations WHERE id=? AND LOWER(client_email)=LOWER(?)", conversationId, email);
        if (!conv) return res.status(404).json({ success: false, message: "Conversation not found" });

        const r = db.prepare("INSERT INTO messages (conversation_id, sender_type, content, created_at) VALUES (?, 'client', ?, CURRENT_TIMESTAMP)").run(conversationId, message);

        try { db.prepare("UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversationId); } catch (e) {}

        try {
            notificationService.create({
                userId: conv.creator_id,
                type: "message",
                title: "New message from " + (conv.client_name || "a client"),
                message: message.slice(0, 180),
                entityType: "conversation",
                entityId: conversationId
            });
        } catch (e) {}

        const saved = safeGet("SELECT * FROM messages WHERE id=?", r.lastInsertRowid);
        res.json({ success: true, message: saved });
    } catch (err) {
        console.error("sendVisitorMessage:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};
