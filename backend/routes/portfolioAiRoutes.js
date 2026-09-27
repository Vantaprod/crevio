// =========================================================
// CREVIO — PORTFOLIO AI ROUTES
// File: backend/routes/portfolioAiRoutes.js
// =========================================================

const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const controller = require("../controllers/portfolioAiController");
const contentController = require("../controllers/portfolioAiContentController");

// POST /api/portfolio/ai/recommend
router.post("/recommend", auth, controller.recommend);
router.post("/write-title",         auth, contentController.writeTitle);
router.post("/suggest-taglines",    auth, contentController.suggestTaglines);
router.post("/rewrite-description", auth, contentController.rewriteDescription);

module.exports = router;