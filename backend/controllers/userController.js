// =========================================================
// CREVIO — USER CONTROLLER
// File: backend/controllers/userController.js
// Real schema: id, username, email, password_hash, display_name, bio,
//   profile_image, location, phone, role, primary_profession, specialties,
//   email_verified, phone_verified, account_status, created_at, updated_at
// =========================================================

const db = require("../../database/db");
const path = require("path");
const fs = require("fs");

function userCols() {
    try { return db.prepare("PRAGMA table_info(users)").all().map(c => c.name); }
    catch (e) { return []; }
}

const SAFE_FIELDS = [
    "id", "username", "email", "display_name", "bio", "profile_image",
    "location", "phone", "role", "primary_profession", "specialties",
    "email_verified", "phone_verified", "account_status",
    "created_at", "updated_at"
]

function selectUser(id) {
    const cols = userCols();
    const selected = SAFE_FIELDS.filter(f => cols.includes(f));
    if (!selected.length) return null;
    return db.prepare(`SELECT ${selected.join(", ")} FROM users WHERE id = ?`).get(id);
}

// =========================================================
// GET /api/users/me
// =========================================================
exports.getMe = (req, res) => {
    try {
        const user = selectUser(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, user });
    } catch (err) {
        console.error("Get me error:", err);
        res.status(500).json({ success: false, message: "Failed", error: err.message });
    }
};

// =========================================================
// PATCH /api/users/me
// =========================================================
exports.updateMe = (req, res) => {
    try {
        const cols = userCols();
        const allowed = ["display_name", "bio", "location", "phone", "primary_profession", "specialties", "whatsapp_number"];
        const updates = {};

        for (const key of allowed) {
            if (req.body[key] !== undefined && cols.includes(key)) {
                updates[key] = req.body[key];
            }
        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({ success: false, message: "Nothing to update" });
        }

        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
        const values = [...Object.values(updates)];

        let sql = `UPDATE users SET ${setClauses}`;
        if (cols.includes("updated_at")) sql += ", updated_at = CURRENT_TIMESTAMP";
        sql += " WHERE id = ?";
        values.push(req.user.id);

        db.prepare(sql).run(...values);

        const user = selectUser(req.user.id);
        res.json({ success: true, message: "Profile updated", user });
    } catch (err) {
        console.error("Update me error:", err);
        res.status(500).json({ success: false, message: "Failed to update", error: err.message });
    }
};

// =========================================================
// POST /api/users/me/avatar
// (multer puts the file on req.file)
// =========================================================
exports.uploadAvatar = (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        const url = `/uploads/profiles/${req.file.filename}`;
        const cols = userCols();
        if (!cols.includes("profile_image")) {
            return res.status(400).json({ success: false, message: "profile_image column missing" });
        }

        db.prepare("UPDATE users SET profile_image = ? WHERE id = ?").run(url, req.user.id);

        // Optional: delete old avatar file
        try {
            const old = db.prepare("SELECT profile_image FROM users WHERE id = ?").get(req.user.id);
            if (old && old.profile_image && old.profile_image !== url && old.profile_image.startsWith("/uploads/")) {
                const oldPath = path.join(__dirname, "..", "..", old.profile_image.replace(/^\//, ""));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        } catch (e) { /* ignore */ }

        res.json({ success: true, message: "Avatar updated", url });
    } catch (err) {
        console.error("Avatar upload error:", err);
        res.status(500).json({ success: false, message: "Upload failed", error: err.message });
    }
};

// =========================================================
// GET /api/users/:id — public
// =========================================================
exports.getUserById = (req, res) => {
    try {
        const user = selectUser(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        delete user.email;
        delete user.phone;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed", error: err.message });
    }
};