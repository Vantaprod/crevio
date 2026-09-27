// =========================================================
// CREVIO — SERVER
// File: backend/server.js
// =========================================================

// 1. Load environment variables
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const path    = require("path");
const fs      = require("fs");
const cors    = require("cors");
const seoRoutes          = require("./routes/seoRoutes");
const publicContactRoutes = require("./routes/publicContactRoutes");

const app  = express();
const PORT = process.env.PORT || 3000;

// 2. Core middleware
app.use(cors());

// =========================================================
// Paystack webhook — MUST receive the raw body for HMAC
// signature verification. Mounted BEFORE express.json()
// because express.json() would consume the raw buffer.
// =========================================================
app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json" }),
    require("./controllers/billingController").paystackWebhook
);

app.use(express.json({ limit: "10mb" }));

// SEO — sitemap.xml + robots.txt (must be before static middleware)
app.use("/", seoRoutes);
app.use("/api/public/contact", publicContactRoutes);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 2b. Ensure upload folders exist
[
    "uploads",
    "uploads/covers",
    "uploads/media",
    "uploads/thumbnails",
    "uploads/profiles"
].forEach(dir => {
    const full = path.join(__dirname, "..", dir);
    if (!fs.existsSync(full)) {
        fs.mkdirSync(full, { recursive: true });
        console.log(`📁 Created folder: ${dir}`);
    }
});

// 3. Static file serving
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/admin",     express.static(path.join(__dirname, "..", "admin")));
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));
app.use("/uploads",   express.static(path.join(__dirname, "..", "uploads")));

// 4. Load routes
const authRoutes         = require("./routes/authRoutes");
const userRoutes         = require("./routes/userRoutes");
const dashboardRoutes    = require("./routes/dashboardRoutes");
const projectRoutes      = require("./routes/projectRoutes");
const serviceRoutes      = require("./routes/serviceRoutes");
const skillRoutes        = require("./routes/skillRoutes");
const mediaRoutes        = require("./routes/mediaRoutes");
const messageRoutes      = require("./routes/messageRoutes");
const socialLinksRoutes  = require("./routes/socialLinksRoutes");
const portfolioRoutes    = require("./routes/portfolioRoutes");
const portfolioAiRoutes  = require("./routes/portfolioAiRoutes");
const billingRoutes      = require("./routes/billingRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const securityRoutes     = require("./routes/securityRoutes");
const accountRoutes      = require("./routes/accountRoutes");
const botRoutes          = require("./routes/botRoutes");
const verificationRoutes = require("./routes/verificationRoutes");
const twoFactorRoutes    = require("./routes/twoFactorRoutes");
const uploadRoutes       = require("./routes/uploadRoutes");
const webhookRoutes      = require("./routes/webhookRoutes");
const testimonialRoutes  = require("./routes/testimonialRoutes");

// 5. Mount routes
app.use("/api/auth",          authRoutes);
app.use("/api/users",         userRoutes);
app.use("/api/dashboard",     dashboardRoutes);
app.use("/api/projects",      projectRoutes);
app.use("/api/services",      serviceRoutes);
app.use("/api/skills",        skillRoutes);
app.use("/api/media",         mediaRoutes);
app.use("/api/messages",      messageRoutes);
app.use("/api/socials",       socialLinksRoutes);
app.use("/api/portfolio",     portfolioRoutes);
app.use("/api/portfolio/ai", portfolioAiRoutes);
app.use("/api/billing",       billingRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/security",      securityRoutes);
app.use("/api/account",       accountRoutes);
app.use("/api/bot",           botRoutes);
app.use("/api/verification",  verificationRoutes);
app.use("/api/2fa",           twoFactorRoutes);
app.use("/api/upload",        uploadRoutes);
app.use("/api/webhooks",      webhookRoutes);
app.use("/api/testimonials",   testimonialRoutes);

// =========================================================
// 6. Public routes
// =========================================================

// Service detail — must come BEFORE /p/:slug
app.get("/p/:slug/services/:serviceId", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "service.html"));
});

// Portfolio home — SSR via template engine (Phase 1C + 1E)
// Dedicated testimonials page — same template, more testimonials shown
app.get(
    "/p/:slug/testimonials",
    require("./controllers/portfolioRenderController").renderTestimonialsPage,
    (req, res) => {
        res.sendFile(path.join(__dirname, "..", "public", "portfolio.html"));
    }
);

// Phase 29 -- standalone visitor chat page
app.get(
    "/p/:slug/chat",
    require("./controllers/portfolioRenderController").renderVisitorChat
);

app.get(
    "/p/:slug",
    require("./controllers/portfolioRenderController").renderPublicPortfolio,
    (req, res) => {
        res.sendFile(path.join(__dirname, "..", "public", "portfolio.html"));
    }
);

// Legacy portfolio URL
app.get("/public/:username", (req, res) => {
    const username = req.params.username;
    if (!username || username.includes("..") || username.includes("/")) {
        return res.status(400).send("Invalid username");
    }
    res.sendFile(path.join(__dirname, "..", "public", "index.html"), (err) => {
        if (err) {
            console.error("Portfolio serve error:", err);
            res.status(404).send("Portfolio page not found.");
        }
    });
});

app.use("/public", express.static(path.join(__dirname, "..", "public")));

// Root
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// 7. API 404
app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ success: false, message: "API endpoint not found" });
    }
    next();
});

// 8. Global error handler
app.use((err, req, res, next) => {
    console.error("Server error:", err);
    res.status(500).json({ success: false, message: "Internal server error", error: err.message });
});

// 9. START SERVER
// Sync portfolio template registry into the templates table on boot.
// Reads backend/templates/portfolio/*/meta.json and upserts each row.
// Idempotent + fail-safe — a broken meta.json never crashes the server.
try {
    require("./templates/portfolio/_registry").syncAll();
} catch (e) { console.error("[server] template registry sync failed:", e.message); }

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   Local:   http://localhost:${PORT}`);
    try {
        const os = require("os");
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === "IPv4" && !net.internal) {
                    console.log(`   Network: http://${net.address}:${PORT}  ← use this on your phone`);
                }
            }
        }
    } catch (e) { /* ignore */ }
});

// Start subscription crons
try {
    const subCron = require("./services/subscriptionCronService");
    subCron.start();
    const lifecycleCron = require("./services/subscriptionLifecycleCron");
    lifecycleCron.start();
} catch (e) { console.error("[server] subCron start failed:", e.message); }
