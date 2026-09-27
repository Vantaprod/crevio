// =========================================================
// CREVIO — PORTFOLIO PAYLOAD BUILDER
// File: backend/templates/portfolio/_payload.js
// =========================================================
// Converts real DB rows into the shape templates expect.
// No hardcoded content. Empty sections yield empty arrays
// and has* flags for the template to handle.
// =========================================================
const db = require("../../../database/db");
const entitlementService = require("../../services/entitlementService");
const fontCatalog = require("./_fonts");

// ---------- Helpers ----------
function cols(table) {
    try { return db.prepare("PRAGMA table_info(" + table + ")").all().map(function (c) { return c.name; }); }
    catch (e) { return []; }
}
function hasCol(table, col) { return cols(table).indexOf(col) !== -1; }
function safeAll(sql, ...params) {
    try { return db.prepare(sql).all(...params); } catch (e) { return []; }
}
function safeGet(sql, ...params) {
    try { return db.prepare(sql).get(...params); } catch (e) { return null; }
}
function isNonEmpty(v) { return v !== null && v !== undefined && String(v).trim() !== ""; }

// ---------- Profile ----------
function buildProfile(user) {
    if (!user) return null;
    const headline = user.primary_profession || user.specialties || null;
    const image = user.profile_image || null;
    var __waDigits = (user.whatsapp_number || "").replace(/[^0-9]/g, "");
    return {
        user_id: user.id,
        name: user.display_name || user.username || "Unnamed",
        username: user.username || null,
        headline: headline,
        bio: user.bio || null,
        image: image,
        location: user.location || null,
        email: user.email || null,
        whatsapp_number: user.whatsapp_number || null,
        whatsapp_link: __waDigits ? ("https://wa.me/" + __waDigits) : null
    };
}

// ---------- Projects ----------
function buildProjects(userId) {
    const cap = entitlementService.limitFor(userId, "projects");
    const capNum = entitlementService.isUnlimited(cap) ? 9999 : cap;

    const rows = safeAll(
        "SELECT id, name, description, category, thumbnail_url, created_at " +
        "FROM projects WHERE user_id = ? AND published = 1 " +
        "ORDER BY created_at DESC LIMIT ?",
        userId, capNum
    );

    return rows.map(function (p, idx) {
        return {
            id: p.id,
            title: p.name || "Untitled",
            description: p.description || null,
            category: p.category || null,
            thumbnail: p.thumbnail_url || null,
            url: "/dashboard/pages/project-edit.html?id=" + p.id,
            date: p.created_at || null,
            is_first: idx === 0,
            index: idx
        };
    });
}

// ---------- Services ----------
function buildServices(userId) {
    const cap = entitlementService.limitFor(userId, "services");
    const capNum = entitlementService.isUnlimited(cap) ? 9999 : cap;

    const serviceCols = cols("services");
    const hasStatus = serviceCols.indexOf("status") !== -1;
    const hasIsActive = serviceCols.indexOf("is_active") !== -1;

    let where = "user_id = ?";
    if (hasStatus) where += " AND status = 'published'";
    else if (hasIsActive) where += " AND is_active = 1";

    const hasName = serviceCols.indexOf("name") !== -1;
    const nameField = hasName ? "name" : (serviceCols.indexOf("title") !== -1 ? "title" : "name");

    const rows = safeAll(
        "SELECT id, " + nameField + " AS svc_name, description FROM services " +
        "WHERE " + where + " LIMIT ?",
        userId, capNum
    );

    return rows.map(function (s) {
        return {
            id: s.id,
            name: s.svc_name || "Untitled service",
            description: s.description || null,
            url: "/dashboard/pages/service-edit.html?id=" + s.id
        };
    });
}

// ---------- Skills ----------
function buildSkills(userId) {
    const csCols = cols("creator_skills");
    const sCols = cols("skills");

    if (csCols.length && csCols.indexOf("user_id") !== -1) {
        if (csCols.indexOf("name") !== -1) {
            return safeAll(
                "SELECT name FROM creator_skills WHERE user_id = ? ORDER BY name",
                userId
            ).map(function (r) { return { name: r.name }; });
        }
        if (csCols.indexOf("skill_id") !== -1 && sCols.length) {
            return safeAll(
                "SELECT s.name FROM creator_skills cs " +
                "JOIN skills s ON s.id = cs.skill_id " +
                "WHERE cs.user_id = ? ORDER BY s.name",
                userId
            ).map(function (r) { return { name: r.name }; });
        }
    }

    if (sCols.length && sCols.indexOf("user_id") !== -1) {
        const nameField = sCols.indexOf("name") !== -1 ? "name" : "title";
        return safeAll(
            "SELECT " + nameField + " AS name FROM skills WHERE user_id = ? ORDER BY " + nameField,
            userId
        ).map(function (r) { return { name: r.name }; });
    }

    return [];
}

// ---------- Social icons (inline SVG, currentColor) ----------
function socialIcon(platform) {
    const key = String(platform || "").toLowerCase().trim();
    const I = {
        tiktok:    '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V7.86a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.29z"/></svg>',
        linkedin:  '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>',
        instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><circle cx="17.5" cy="6.5" r=".5" fill="currentColor"/></svg>',
        x:         '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zM17.083 19.77h1.833L7.084 4.126H5.117z"/></svg>',
        twitter:   '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zM17.083 19.77h1.833L7.084 4.126H5.117z"/></svg>',
        facebook:  '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.56 9.87v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.88h-2.33v6.99A10 10 0 0 0 22 12z"/></svg>',
        youtube:   '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12z"/></svg>',
        github:    '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61a3.18 3.18 0 0 0-1.34-1.76c-1.09-.75.09-.73.09-.73a2.52 2.52 0 0 1 1.84 1.24 2.56 2.56 0 0 0 3.5 1 2.56 2.56 0 0 1 .76-1.6c-2.67-.3-5.47-1.33-5.47-5.93a4.64 4.64 0 0 1 1.24-3.23 4.32 4.32 0 0 1 .12-3.18s1-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23a4.32 4.32 0 0 1 .12 3.18 4.63 4.63 0 0 1 1.24 3.23c0 4.61-2.8 5.63-5.48 5.92a2.87 2.87 0 0 1 .82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3z"/></svg>',
        dribbble:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>',
        behance:   '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M8.84 11.13c1.24-.6 1.92-1.68 1.92-3.13a3.42 3.42 0 0 0-1.4-2.94 5.93 5.93 0 0 0-3.3-.8H0v13.68h6.28c2.45 0 4.18-.55 5.2-1.65a3.78 3.78 0 0 0 1.05-2.72 3.36 3.36 0 0 0-3.69-2.44zm-5.5-4.55h2.16a2.07 2.07 0 0 1 1.3.35 1.4 1.4 0 0 1 .44 1.08 1.4 1.4 0 0 1-.44 1.08 2 2 0 0 1-1.3.35H3.34zm3.83 8.13a2.29 2.29 0 0 1-1.47.4H3.34v-3.08h2.4a2.27 2.27 0 0 1 1.47.4 1.55 1.55 0 0 1 .5 1.2 1.5 1.5 0 0 1-.54 1.08zM24 12.24a5.48 5.48 0 0 0-5.42-5.83 5.27 5.27 0 0 0-5.42 5.83 5.36 5.36 0 0 0 5.42 5.83c2.52 0 4.55-1.35 5.22-3.8h-2.67a2.55 2.55 0 0 1-2.55 1.65 2.57 2.57 0 0 1-2.62-2.55h8.04c.02-.13.02-.13 0-1.13zm-8.05-1.32a2.28 2.28 0 0 1 2.44-2.1 2.27 2.27 0 0 1 2.31 2.1z"/></svg>'
    };
    return I[key] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
}

// ---------- Social ----------
function buildSocial(userId) {
    const sCols = cols("social_links");
    if (!sCols.length) return [];

    const hasVisible = sCols.indexOf("is_visible") !== -1;
    const hasOrder   = sCols.indexOf("display_order") !== -1;

    let where = "user_id = ?";
    if (hasVisible) where += " AND is_visible = 1";
    let order = "";
    if (hasOrder) order = " ORDER BY display_order";
    else if (sCols.indexOf("created_at") !== -1) order = " ORDER BY created_at";

    const platformField = sCols.indexOf("platform") !== -1 ? "platform"
        : (sCols.indexOf("network") !== -1 ? "network" : "platform");

    const rows = safeAll(
        "SELECT " + platformField + " AS platform, url FROM social_links " +
        "WHERE " + where + order,
        userId
    );

    return rows.map(function (s) {
        const platform = s.platform || "Link";
        return {
            platform: platform,
            url: s.url || null,
            icon: socialIcon(platform)
        };
    }).filter(function (s) { return s.url; });
}

// ---------- Testimonials ----------
function computeInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function buildTestimonials(userId, limit) {
    const cap = parseInt(limit, 10) || 20;
    const rows = safeAll(
        "SELECT id, quote, author_name, author_role, author_company, author_avatar " +
        "FROM testimonials WHERE user_id = ? AND is_visible = 1 " +
        "ORDER BY display_order ASC, id ASC LIMIT ?",
        userId, cap
    );
    return rows.map(function (t) {
        const name = t.author_name || "Anonymous";
        const avatar = t.author_avatar || null;
        return {
            id: t.id,
            quote: t.quote || "",
            name: name,
            role: t.author_role || null,
            company: t.author_company || null,
            avatar: avatar,
            has_avatar: !!avatar,
            show_initials: !avatar,
            initials: computeInitials(name),
            attribution: [t.author_role, t.author_company].filter(Boolean).join(" at ") || null
        };
    });
}

// ---------- Theme ----------
function buildTheme(config, templateMeta) {
    const defaults = (templateMeta && templateMeta.default_theme_settings) || {};
    let settings = {};
    if (config && config.theme_settings) {
        try {
            settings = typeof config.theme_settings === "string"
                ? JSON.parse(config.theme_settings)
                : config.theme_settings;
        } catch (e) { settings = {}; }
    }

    return {
        mode: settings.mode || defaults.mode || "light",
        accent: settings.primary_color || settings.accent || defaults.accent || "#2563EB",
        font: settings.font_family || settings.font || defaults.font || "Inter",
        background: settings.background_color || null,
        social_display: settings.social_display || "text"
    };
}

// ---------- Meta / SEO ----------
function buildMeta(config, profile, templateMeta) {
    let settings = {};
    if (config && config.theme_settings) {
        try {
            settings = typeof config.theme_settings === "string"
                ? JSON.parse(config.theme_settings)
                : config.theme_settings;
        } catch (e) { settings = {}; }
    }
    const title = settings.title || (profile.name + (profile.headline ? " — " + profile.headline : ""));
    const description = settings.meta_description || settings.tagline || profile.bio || "";
    const userFont = (function () {
                try {
                    const ts = typeof config.theme_settings === "string"
                        ? JSON.parse(config.theme_settings)
                        : (config.theme_settings || {});
                    return ts.font_family || null;
                } catch (e) { return null; }
            })();
            const fontUrl = fontCatalog.buildGoogleFontsUrl(userFont);
            return { title: title, description: description, fontUrl: fontUrl, fontName: (fontCatalog.findByName(userFont) || { name: fontCatalog.DEFAULT }).name };
}

// ---------- Main entry ----------
function build(userId, opts) {
    opts = opts || {};
    const onTestimonialsPage = opts.mode === "testimonials";
    const TESTIMONIALS_HOMEPAGE_LIMIT = 6;
    const templateMeta = opts.templateMeta || null;
    const baseUrl = String(opts.baseUrl || process.env.SITE_URL || "").replace(/\/$/, "");

    const user = safeGet(
        "SELECT id, username, display_name, email, bio, profile_image, location, " +
        "primary_profession, specialties, whatsapp_number FROM users WHERE id = ?",
        userId
    );
    if (!user) return null;

    const config = safeGet(
        "SELECT * FROM portfolio_config WHERE user_id = ? LIMIT 1",
        userId
    );

    const profile   = buildProfile(user);
    const projects  = buildProjects(userId);
    const services  = buildServices(userId);
    const skills    = buildSkills(userId);
    const social    = buildSocial(userId);
    const testimonials = buildTestimonials(userId, onTestimonialsPage ? 500 : TESTIMONIALS_HOMEPAGE_LIMIT);
    const totalRow = safeGet("SELECT COUNT(*) AS c FROM testimonials WHERE user_id = ? AND is_visible = 1", userId);
    const testimonialsTotal = totalRow ? totalRow.c : 0;
    const theme     = buildTheme(config, templateMeta);

    // ---------- Effects (Business + opt-in per effect) ----------
    const effects = (function () {
        const plan = (function () {
            try { return entitlementService.getUserPlan(userId); }
            catch (e) { return "free"; }
        })();
        const isBusiness = plan === "business";
        let ts = {};
        if (config && config.theme_settings) {
            try { ts = typeof config.theme_settings === "string"
                ? JSON.parse(config.theme_settings)
                : config.theme_settings; } catch (e) { ts = {}; }
        }
        const userFx = (ts && ts.effects) || {};
        const fade = isBusiness && userFx.fade === true;
        const hover = isBusiness && userFx.hover === true;
        const shapes = isBusiness && userFx.shapes === true;
        return {
            fade: fade,
        hover: hover,
        shapes: shapes,
            enabled: fade || hover || shapes
        };
    })();
    const meta      = buildMeta(config, profile, templateMeta);

    const mode = theme.social_display;


    const sectionsToggleOnTestimonials = (function () {
        try {
            if (!config || !config.theme_settings) return true;
            const ts = typeof config.theme_settings === "string"
                ? JSON.parse(config.theme_settings)
                : config.theme_settings;
            return !ts.sections || ts.sections.testimonials !== false;
        } catch (e) { return true; }
    })();

    const portfolioUrl = profile.username
        ? ("/p/" + encodeURIComponent(profile.username))
        : "/p";

    
    // ---------- Open Graph / Twitter card metadata ----------
    meta.ogUrl = baseUrl ? (baseUrl + portfolioUrl) : portfolioUrl;
    meta.ogImage = (profile && profile.image) || (projects[0] && projects[0].thumbnail) || null;
    if (meta.ogImage && meta.ogImage.charAt(0) === "/" && baseUrl) meta.ogImage = baseUrl + meta.ogImage;

    // ---------- Favicon ----------
    meta.favicon = (profile && profile.image) ? profile.image : "/dashboard/assets/templates/favicon-default.svg";
    meta.ogType = "profile";
    meta.siteName = "Crevio";
    return {
        profile: profile,
        hasProfile: !!(profile && (profile.name || profile.headline || profile.bio)),

        projects: projects,
        hasProjects: !onTestimonialsPage && projects.length > 0,

        services: services,
        hasServices: !onTestimonialsPage && services.length > 0,

        skills: skills,
        hasSkills: !onTestimonialsPage && skills.length > 0,

        social: social,
        hasSocial: social.length > 0,
        social_display: mode,
        social_show_icon: mode === "icon" || mode === "both",
        social_show_text: mode === "text" || mode === "both",
        testimonials: testimonials,
        hasTestimonials: testimonials.length > 0 && (onTestimonialsPage || sectionsToggleOnTestimonials),
        has_more_testimonials: !onTestimonialsPage && testimonialsTotal > testimonials.length,
        testimonials_total: testimonialsTotal,
        is_testimonials_page: onTestimonialsPage,
        is_portfolio_page: !onTestimonialsPage,
        portfolio_url: portfolioUrl,

        theme: theme,
        meta: meta,
        effects: effects,

        config: config ? { published: !!config.published, last_published_at: config.last_published_at } : null
    };
}

module.exports = {
    build: build,
    socialIcon: socialIcon,
    _buildProjects: buildProjects,
    _buildServices: buildServices,
    _buildSkills: buildSkills,
    _buildSocial: buildSocial
};