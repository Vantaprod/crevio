// =========================================================
// CREVIO — PORTFOLIO ROUTES
// File: backend/routes/portfolioRoutes.js
// =========================================================

const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const portfolioController = require("../controllers/portfolioController");
const portfolioAnalyticsController = require("../controllers/portfolioAnalyticsController");

// Public (no auth) — must come BEFORE the /:id style routes
router.get("/public/:slug", portfolioController.getPublicPortfolio);

// Protected
router.get("/config",     auth, portfolioController.getConfig);
router.put("/config",     auth, portfolioController.saveConfig);
router.post("/publish",   auth, portfolioController.publish);
router.get("/templates",  auth, portfolioController.getTemplates);
router.get("/analytics", auth, portfolioAnalyticsController.getAnalytics);

module.exports = router;