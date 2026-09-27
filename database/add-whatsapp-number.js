// =========================================================
// CREVIO — add whatsapp_number to users (run once)
// File: database/add-whatsapp-number.js
// =========================================================
const db = require("./db");

const cols = db.prepare("PRAGMA table_info(users)").all().map(function (c) { return c.name; });

if (cols.includes("whatsapp_number")) {
    console.log("whatsapp_number already exists on users");
} else {
    db.prepare("ALTER TABLE users ADD COLUMN whatsapp_number TEXT").run();
    console.log("Added users.whatsapp_number");
}

console.log("users columns now include whatsapp_number:", db.prepare("PRAGMA table_info(users)").all().some(function (c) { return c.name === "whatsapp_number"; }));