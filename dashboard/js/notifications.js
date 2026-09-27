// =========================================================
// CREVIO â€” NOTIFICATIONS PAGE
// File: dashboard/js/notifications.js
// Reading pane with markdown content + context panel on the
// right (type, received, source, actions). Read-only.
// =========================================================

document.addEventListener("DOMContentLoaded", function () {
    const $ = (id) => document.getElementById(id);

    const container      = $("notificationsContainer");
    const markAllBtn     = $("markAllBtn");
    const unreadCountEl  = $("unreadCount");
    const totalLabel     = $("totalLabel");
    const toast          = $("toast");
    const readingPane    = $("readingPane");
    const readingEmpty   = $("readingEmpty");
    const readingContent = $("readingContent");
    const readingContext = $("readingContext");
    const readingBack    = $("readingBack");

    let notifications = [];
    let filter        = "all";
    let activeId      = null;

    // =========================================================
    // Inline markdown CSS for reading body
    // =========================================================
    if (!document.getElementById("__notifMdStyles")) {
        const st = document.createElement("style");
        st.id = "__notifMdStyles";
        st.textContent = `
            .reading-body h1 { font-size:22px; font-weight:700; margin:26px 0 12px; color:var(--text-primary); line-height:1.3; letter-spacing:-0.01em; }
            .reading-body h2 { font-size:18px; font-weight:700; margin:24px 0 10px; color:var(--text-primary); line-height:1.3; }
            .reading-body h3 { font-size:16px; font-weight:600; margin:22px 0 8px; color:var(--text-primary); line-height:1.35; }
            .reading-body p  { margin:0 0 14px; }
            .reading-body p:last-child { margin-bottom:0; }
            .reading-body strong { color:var(--text-primary); font-weight:600; }
            .reading-body em { font-style:italic; }
            .reading-body code { background:var(--bg-card); border:1px solid var(--border-color); padding:1px 6px; border-radius:4px; font-size:0.9em; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
            .reading-body ul, .reading-body ol { margin:0 0 14px 22px; padding:0; }
            .reading-body li { margin:0 0 6px; }
        `;
        document.head.appendChild(st);
    }

    // =========================================================
    // LOAD
    // =========================================================
    async function loadNotifications() {
        container.innerHTML = `<div class="loading">Loading notifications...</div>`;
        try {
            const res  = await window.apiFetch("/api/notifications");
            const data = await res.json();
            notifications = data.notifications || [];
            render();
        } catch (err) {
            console.error("Load notifications error:", err);
            container.innerHTML = `<div class="empty-state"><p>Could not load notifications.</p></div>`;
        }
    }

    // =========================================================
    // RENDER LIST
    // =========================================================
    function render() {
        const unreadCount = notifications.filter(n => !n.is_read).length;
        unreadCountEl.textContent = unreadCount;
        totalLabel.textContent = `${notifications.length} notification${notifications.length === 1 ? "" : "s"}`;

        let filtered = notifications;
        if (filter === "unread") {
            filtered = notifications.filter(n => !n.is_read);
        } else if (filter !== "all") {
            filtered = filtered.filter(n => (n.type || "system").toLowerCase() === filter);
        }

        if (!filtered.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="${filter === "all" ? "bell-off" : "inbox"}" class="icon"></i>
                    <h3>${filter === "all" ? "No notifications yet" : "Nothing here"}</h3>
                    <p>${filter === "all" ? "You'll see activity updates here." : "Try a different filter."}</p>
                </div>`;
            if (typeof lucide !== "undefined") lucide.createIcons();
            return;
        }

        container.innerHTML = filtered.map(renderListItem).join("");
        if (typeof lucide !== "undefined") lucide.createIcons();

        container.querySelectorAll(".notif-item").forEach(el => {
            el.addEventListener("click", (e) => {
                if (e.target.closest("[data-delete]")) return;
                openNotification(parseInt(el.dataset.id, 10));
            });
        });

        container.querySelectorAll("[data-delete]").forEach(el => {
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteNotification(el.dataset.delete);
            });
        });
    }

    function renderListItem(n) {
        const type   = (n.type || "system").toLowerCase();
        const unread = !n.is_read;
        const active = String(n.id) === String(activeId);
        const time   = formatRelativeTime(n.created_at);
        const preview = stripMarkdown(n.message || "").slice(0, 140);

        return `
            <div class="notif-item ${unread ? 'unread' : ''} ${active ? 'active' : ''}" data-id="${n.id}">
                ${unread ? '<span class="notif-dot"></span>' : ''}
                <div class="notif-icon ${type}">
                    <i data-lucide="${iconForType(type)}" class="icon"></i>
                </div>
                <div class="notif-body">
                    <div class="notif-title">${escapeHtml(n.title || "Notification")}</div>
                    <div class="notif-preview">${escapeHtml(preview)}</div>
                    <div class="notif-time">${time}</div>
                </div>
                <div class="notif-actions">
                    <button class="icon-btn danger" data-delete="${n.id}" title="Delete" type="button">
                        <i data-lucide="trash-2" class="icon"></i>
                    </button>
                </div>
            </div>
        `;
    }

    function iconForType(t) {
        return {
            message: "message-square",
            payment: "credit-card",
            alert:   "alert-triangle",
            error:   "alert-circle",
            system:  "info"
        }[t] || "bell";
    }

    // =========================================================
    // MARKDOWN (escape first, then transform)
    // =========================================================
    function stripMarkdown(text) {
        return String(text || "")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/^#{1,3}\s+/gm, "")
            .replace(/\r\n/g, "\n");
    }

    function renderMarkdown(text) {
        if (!text) return "";
        let s = escapeHtml(text).replace(/\r\n/g, "\n");

        s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
        s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");

        const lines = s.split("\n");
        const html = [];
        let buffer = [];
        let listItems = [];
        let listType = null;

        function flushPara() { if (buffer.length) { html.push("<p>" + buffer.join("<br>") + "</p>"); buffer = []; } }
        function flushList() {
            if (listItems.length) {
                const tag = listType === "ol" ? "ol" : "ul";
                html.push("<" + tag + ">" + listItems.map(li => "<li>" + li + "</li>").join("") + "</" + tag + ">");
                listItems = []; listType = null;
            }
        }

        for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed) { flushPara(); flushList(); continue; }
            let m;
            if ((m = trimmed.match(/^###\s+(.+)$/))) { flushPara(); flushList(); html.push("<h3>" + m[1] + "</h3>"); continue; }
            if ((m = trimmed.match(/^##\s+(.+)$/)))  { flushPara(); flushList(); html.push("<h2>" + m[1] + "</h2>"); continue; }
            if ((m = trimmed.match(/^#\s+(.+)$/)))   { flushPara(); flushList(); html.push("<h1>" + m[1] + "</h1>"); continue; }
            if ((m = trimmed.match(/^\d+\.\s+(.+)$/))) {
                flushPara();
                if (listType !== "ol") { flushList(); listType = "ol"; }
                listItems.push(m[1]); continue;
            }
            if ((m = trimmed.match(/^[-*]\s+(.+)$/))) {
                flushPara();
                if (listType !== "ul") { flushList(); listType = "ul"; }
                listItems.push(m[1]); continue;
            }
            flushList();
            buffer.push(trimmed);
        }
        flushPara(); flushList();
        return html.join("");
    }

    // =========================================================
    // OPEN â†’ RENDER READING PANE + CONTEXT PANEL
    // =========================================================
    async function openNotification(id) {
        const n = notifications.find(x => String(x.id) === String(id));
        if (!n) return;

        activeId = id;

        if (!n.is_read) {
            await markRead(id);
        } else {
            updateActiveHighlight();
        }

        renderReadingPane(n);
        renderContextPanel(n);
        openReadingPaneMobile();
    }

    function updateActiveHighlight() {
        container.querySelectorAll(".notif-item").forEach(el => {
            el.classList.toggle("active", String(el.dataset.id) === String(activeId));
        });
    }

    function renderReadingPane(n) {
        const type   = (n.type || "system").toLowerCase();
        const time   = formatFullTime(n.created_at);

        readingEmpty.style.display = "none";
        readingContent.style.display = "block";

        readingContent.innerHTML = `
            <div class="reading-header">
                <div class="reading-icon ${type}">
                    <i data-lucide="${iconForType(type)}" class="icon"></i>
                </div>
                <div class="reading-meta">
                    <div class="reading-type">${escapeHtml(type)}</div>
                    <div class="reading-timestamp">${time}</div>
                </div>
            </div>
            <h2 class="reading-title">${escapeHtml(n.title || "Notification")}</h2>
            <div class="reading-body">${renderMarkdown(n.message || "")}</div>
              ${n.cta_url ? `<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border-color,#E2E8F0);"><a href="${n.cta_url}" style="display:inline-block;padding:11px 22px;background:var(--accent,#2563EB);color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;margin-right:4px;">${n.cta_text || "Open"}</a>${n.cta_url_2 ? `<a href="${n.cta_url_2}" style="display:inline-block;padding:11px 22px;background:transparent;color:var(--text-primary,#0F172A);text-decoration:none;border:1px solid var(--border-color,#E2E8F0);border-radius:8px;font-size:14px;font-weight:600;">${n.cta_text_2 || "View"}</a>` : ""}</div>` : ""}
        `;

        if (typeof lucide !== "undefined") lucide.createIcons();
        readingContent.scrollTop = 0;
    }

    function renderContextPanel(n) {
        if (!readingContext) return;
        readingContext.style.display = "flex";

        const type = (n.type || "system").toLowerCase();
        const fullDate = formatFullTime(n.created_at);
        const entityLabel = labelForEntity(n.entity_type);
        const entityRef = n.entity_id ? `#${n.entity_id}` : "";
        const openDest = destinationFor(n);

        readingContext.innerHTML = `
            <div class="ctx-section">
                <span class="ctx-type-badge ${type}">${escapeHtml(type)}</span>
            </div>

            <div class="ctx-divider"></div>

            <div class="ctx-section">
                <div class="ctx-label">Received</div>
                <div class="ctx-value">${escapeHtml(fullDate)}</div>
            </div>

            ${entityLabel ? `
                <div class="ctx-section">
                    <div class="ctx-label">Source</div>
                    <div class="ctx-value">${escapeHtml(entityLabel)}${entityRef ? ` <span style="color:var(--text-muted);font-weight:500;">${escapeHtml(entityRef)}</span>` : ""}</div>
                </div>
            ` : ""}

            <div class="ctx-divider"></div>

            <div class="ctx-section">
                <div class="ctx-label">Actions</div>
                ${openDest ? `
                    <button class="ctx-action primary" id="ctxOpen" type="button">
                        <i data-lucide="external-link" class="icon"></i>
                        Open ${escapeHtml(entityLabel || "item")}
                    </button>
                ` : ""}
                <button class="ctx-action danger" id="ctxDelete" type="button">
                    <i data-lucide="trash-2" class="icon"></i>
                    Delete notification
                </button>
            </div>
        `;

        if (typeof lucide !== "undefined") lucide.createIcons();

        $("ctxOpen")?.addEventListener("click", () => {
            if (openDest) window.location.href = openDest;
        });
        $("ctxDelete")?.addEventListener("click", () => deleteNotification(n.id));
    }

    function labelForEntity(et) {
        if (!et) return "";
        const map = { project: "Project", portfolio: "Portfolio", conversation: "Conversation" };
        return map[String(et).toLowerCase()] || "";
    }

    function destinationFor(n) {
        const et = (n.entity_type || "").toLowerCase();
        const eid = n.entity_id;
        if (et === "project" && eid) return "/dashboard/pages/project-edit.html?id=" + encodeURIComponent(eid);
        if (et === "portfolio") return "/dashboard/pages/portfolio-edit.html";
        if (et === "conversation" && eid) return "/dashboard/pages/messages.html?conversation=" + encodeURIComponent(eid);
        return null;
    }

    function closeReadingPane() {
        activeId = null;
        readingContent.style.display = "none";
        readingEmpty.style.display = "flex";
        if (readingContext) readingContext.style.display = "none";
        readingPane.classList.remove("mobile-open");
        updateActiveHighlight();
    }

    function openReadingPaneMobile() {
        if (window.innerWidth <= 768) readingPane.classList.add("mobile-open");
    }

    // =========================================================
    // ACTIONS
    // =========================================================
    async function markRead(id) {
        const n = notifications.find(x => String(x.id) === String(id));
        if (!n || n.is_read) return;
        try {
            await window.apiFetch(`/api/notifications/${id}/read`, { method: "PATCH" });
            n.is_read = 1;
            render();
            if (typeof window.__crevioRefreshBadges === "function") window.__crevioRefreshBadges();
        } catch (err) { console.error("Mark read error:", err); }
    }

    async function deleteNotification(id) {
        const __ok = await window.crevioConfirm("Delete this notification?", { title: "Delete notification", confirmText: "Delete", danger: true });
        if (!__ok) return;
        try {
            const res = await window.apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                notifications = notifications.filter(n => String(n.id) !== String(id));
                if (String(activeId) === String(id)) closeReadingPane();
                render();
                showToast("Deleted");
            }
        } catch (err) { showToast("Failed: " + err.message, true); }
    }

    markAllBtn?.addEventListener("click", async () => {
        markAllBtn.disabled = true;
        try {
            const res = await window.apiFetch("/api/notifications/read-all", { method: "PATCH" });
            const data = await res.json();
            if (data.success) {
                notifications.forEach(n => n.is_read = 1);
                if (typeof window.__crevioRefreshBadges === "function") window.__crevioRefreshBadges();
                render();
                showToast("All marked as read");
            }
        } catch (err) {
            showToast("Failed: " + err.message, true);
        } finally {
            markAllBtn.disabled = false;
        }
    });

    // =========================================================
    // FILTERS
    // =========================================================
    document.querySelectorAll(".filter-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            filter = chip.dataset.filter;
            render();
        });
    });

    // =========================================================
    // MOBILE BACK
    // =========================================================
    readingBack?.addEventListener("click", () => {
        readingPane.classList.remove("mobile-open");
    });

    // =========================================================
    // HELPERS
    // =========================================================
    function formatRelativeTime(str) {
        if (!str) return "";
        try {
            const d = new Date(str.replace(" ", "T") + (str.includes("Z") ? "" : "Z"));
            const diff = Date.now() - d.getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1)  return "just now";
            if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
            const hrs = Math.floor(mins / 60);
            if (hrs < 24)  return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
            const days = Math.floor(hrs / 24);
            if (days < 7)  return days + " day" + (days === 1 ? "" : "s") + " ago";
            return d.toLocaleDateString();
        } catch { return str; }
    }

    function formatFullTime(str) {
        if (!str) return "";
        try {
            const d = new Date(str.replace(" ", "T") + (str.includes("Z") ? "" : "Z"));
            return d.toLocaleString(undefined, {
                year: "numeric", month: "long", day: "numeric",
                hour: "2-digit", minute: "2-digit"
            });
        } catch { return str; }
    }

    function escapeHtml(str) {
        return String(str == null ? "" : str).replace(/[&<>"']/g, s => ({
            "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
        })[s]);
    }

    let toastTimer;
    function showToast(msg, isError = false) {
        if (!toast) return;
        clearTimeout(toastTimer);
        toast.textContent = msg;
        toast.classList.toggle("error", isError);
        toast.classList.add("show");
        toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
    }

    // =========================================================
    // INIT
    // =========================================================
    loadNotifications();
});