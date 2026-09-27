// =========================================================
// CREVIO — PUBLIC CONTACT ROUTES
// File: backend/routes/publicContactRoutes.js
// =========================================================
// Visitor-side endpoints used by the public portfolio
// contact form. No auth middleware — the visitor is anonymous.
// =========================================================
const express = require("express");
const router = express.Router();
const mc = require("../controllers/messageController");

// Visitor submits the contact form
// Body: { creator_id, client_name, client_email, message, source? }
router.post("/start", mc.startConversation);

// Visitor loads their own conversation (via id + email)
// GET /api/public/contact/:id?email=...
router.get("/:id", mc.getVisitorConversation);

// Visitor sends a follow-up message
// Body: { conversation_id, email, message }
router.post("/message", mc.sendVisitorMessage);

module.exports = router;