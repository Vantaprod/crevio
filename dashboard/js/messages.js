// =========================================================
// CREVIO — MESSAGES
// File: dashboard/js/messages.js
// =========================================================
console.log("[Messages] loaded");

document.addEventListener("DOMContentLoaded", function () {
    const $ = (id) => document.getElementById(id);

    const convItemsEl       = $("convItems");
    const chatPanelEl       = $("chatPanel");
    const convPanelEl       = $("convPanel");
    const convFiltersEl     = $("convFilters");
    const dropdownFiltersEl = $("dropdownFilters");
    const overflowLabelEl   = $("overflowLabel");
    const contextContentEl  = $("contextContent");
    const searchInput       = $("searchInput");
    const chipMoreBtn       = $("chipMoreBtn");
    const chipDropdown      = $("chipDropdown");
    const contextMenuEl     = $("contextMenu");
    const reactionBarEl     = $("reactionBar");
    const msgContextMenuEl  = $("msgContextMenu");
    const toast             = $("toast");

        function __msgTiming() { window.__msgTiming = true; }
    function __timedFetch(url, opts) {
        const t0 = performance.now();
        return window.apiFetch(url, opts).then(res => {
            const dt = (performance.now() - t0).toFixed(0);
            console.log("[messages] " + dt + "ms  " + url);
            return res;
        });
    }

    let conversations   = [];
    let activeConvId    = null;
    let activeMessages  = [];
    let filter          = "all";
    let search          = "";
    let debounceTimer;
    let cmTargetId      = null;
    let mcmTargetId     = null;
    let replyToId       = null;
    let planLimit       = 5000;
    let currentPlanName = "free";   // default; overwritten on load
    let planUnlimited   = false;
    let pinOptionsCache = null;   // { durations, maxPerChat, plan }
    let currentPlan     = "free";   // set from /plan-limit

    // =========================================================
    // CONFIG
    // =========================================================
    const FILTERS = [
        { key: "all",      label: "All" },
        { key: "unread",   label: "Unread" },
        { key: "starred",  label: "Starred" },
        { key: "archived", label: "Archived" }
    ];

    const MSG_MENU = [
        { id: "reply",   icon: "corner-up-left",  label: "Reply" },
        { id: "copy",    icon: "copy",            label: "Copy" },
        { id: "forward", icon: "corner-up-right", label: "Forward" },
        { id: "edit",    icon: "pencil",           label: "Edit" },
        { id: "pin",     icon: "pin",             label: "Pin" },
        { id: "askbot",  icon: "bot",             label: "Ask CrevioBot" },
        { id: "star",    icon: "star",            label: "Star" },
        { id: "select",  icon: "square-check",    label: "Select" },
        { divider: true },
        { id: "report",  icon: "flag",            label: "Report", danger: true },
        { id: "delete",  icon: "trash-2",         label: "Delete", danger: true }
    ];

    const REACTIONS = [
        "&#x1F44D;", "&#x2764;&#xFE0F;", "&#x1F602;", "&#x1F62E;",
        "&#x1F622;", "&#x1F64F;", "&#x1F525;", "&#x1F44F;",
        "&#x1F389;", "&#x1F4AF;", "&#x1F440;", "&#x1F914;",
        "&#x1F60D;", "&#x1F60E;", "&#x1F973;", "&#x1F62D;",
        "&#x1F621;", "&#x1F92F;", "&#x1F631;", "&#x1F917;",
        "&#x1F44C;", "&#x1F44B;", "&#x1F91D;", "&#x1F4AA;",
        "&#x2705;", "&#x274C;", "&#x2B50;", "&#x1F4A1;",
        "&#x1F680;", "&#x1F4E3;", "&#x1F3AF;", "&#x1F4A5;"
    ];
    const PRIMARY_REACTIONS = REACTIONS.slice(0, 6);


    // =========================================================
    // FILTERS
    // =========================================================
    function buildFilterChip(f) {
        const btn = document.createElement("button");
        btn.className = "chip";
        btn.dataset.filter = f.key;
        btn.innerHTML = f.label + ' <span class="count" data-count-for="' + f.key + '">0</span>';
        btn.addEventListener("click", (e) => { e.stopPropagation(); selectFilter(f.key); });
        return btn;
    }

    function layoutFilters() {
        if (!convFiltersEl || !dropdownFiltersEl) return;
        convFiltersEl.innerHTML = "";
        dropdownFiltersEl.innerHTML = "";
        FILTERS.map(buildFilterChip).forEach(c => convFiltersEl.appendChild(c));
        const hidden = [];
        while (convFiltersEl.scrollWidth > convFiltersEl.clientWidth && convFiltersEl.children.length > 1) {
            const last = convFiltersEl.lastElementChild;
            convFiltersEl.removeChild(last);
            hidden.unshift(last);
        }
        hidden.forEach(c => dropdownFiltersEl.appendChild(c));
        if (overflowLabelEl) overflowLabelEl.style.display = hidden.length ? "block" : "none";
        applyActiveFilter();
        chipMoreBtn?.classList.toggle("has-active", hidden.some(c => c.dataset.filter === filter));
        applyCounts();
    }

    function applyActiveFilter() {
        document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.filter === filter));
    }
    function selectFilter(k) { filter = k; applyActiveFilter(); layoutFilters(); loadConversations(); }

    let lastStats = { total: 0, unread: 0, starred: 0, archived: 0 };
    function applyCounts() {
        document.querySelectorAll('[data-count-for="all"]').forEach(el      => el.textContent = lastStats.total);
        document.querySelectorAll('[data-count-for="unread"]').forEach(el   => el.textContent = lastStats.unread);
        document.querySelectorAll('[data-count-for="starred"]').forEach(el  => el.textContent = lastStats.starred);
        document.querySelectorAll('[data-count-for="archived"]').forEach(el => el.textContent = lastStats.archived);
    }

    async function loadStats() {
        try {
            const res = await __timedFetch("/api/messages/stats");
            const d = await res.json();
            if (d.success) { lastStats = d.stats; applyCounts(); }
        } catch (e) { console.error(e); }
    }

    // =========================================================
    // LOAD CONVERSATIONS
    // =========================================================
    async function loadConversations() {
        convItemsEl.innerHTML = (window.CrevioLoader ? CrevioLoader.wrap(CrevioLoader.html("sm")) : '<div class="loading">Loading…</div>');
        try {
            const url = "/api/messages/conversations?filter=" + filter + "&search=" + encodeURIComponent(search);
            const res = await __timedFetch(url);
            const data = await res.json();
            conversations = data.conversations || [];
            renderConversations();
        } catch (e) {
            convItemsEl.innerHTML = '<div class="empty-state"><p>Could not load conversations.</p></div>';
        }
    }

    function renderConversations() {
        if (!conversations.length) {
            convItemsEl.innerHTML = '<div class="empty-state"><p>' + (search || filter !== "all" ? "No matches." : "No inquiries yet.") + '</p></div>';
            return;
        }
        convItemsEl.innerHTML = conversations.map(c => {
            const name = c.client_name || "Client";
            const preview = (c.last_message || c.notes || "No messages yet").slice(0, 60);
            const time = formatRelativeTime(c.last_message_at || c.created_at);
            const isPinned = c.pinned === 1 || c.client_pinned === 1;
            const pinIcon  = isPinned ? '<i data-lucide="pin" class="pin-icon"></i>' : "";
            const muteIcon = c.muted === 1 ? '<i data-lucide="bell-off" class="mute-icon"></i>' : "";
            const isUnread = (c.unread_count > 0 || c.manually_unread === 1) && c.muted !== 1;
            const unreadBadge = isUnread ? '<span class="conv-badge unread">' + (c.unread_count || 1) + '</span>' : "";
            const starred = c.starred === 1 ? '<span class="conv-badge starred"></span>' : "";
            const statusBadge = c.status && c.status !== "new"
                ? '<span class="conv-badge">' + escapeHtml(c.status) + '</span>'
                : (c.status === "new" ? '<span class="conv-badge new">New</span>' : "");
            const listBadge = c.list_name ? '<span class="conv-badge list">' + escapeHtml(c.list_name) + '</span>' : "";
            let ctxLine = "";
            if (c.context_service_title) ctxLine = "Interested in " + escapeHtml(c.context_service_title);
            else if (c.context_project_title) ctxLine = "Re: " + escapeHtml(c.context_project_title);
            return '<div class="conv-item ' + (c.id === activeConvId ? "active" : "") + ' ' + (isPinned ? "pinned-row" : "") + '" data-id="' + c.id + '">'
                + '<div class="conv-top">'
                + '<div class="conv-name">' + pinIcon + muteIcon + escapeHtml(name) + '</div>'
                + '<div class="conv-time">' + time + '</div>'
                + '</div>'
                + (ctxLine ? '<div class="conv-context">' + ctxLine + '</div>' : "")
                + '<div class="conv-preview">' + (escapeHtml(preview) || "No messages yet") + '</div>'
                + '<div class="conv-meta">' + statusBadge + starred + listBadge + unreadBadge + '</div>'
                + '</div>';
        }).join("");
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
    }

    // =========================================================
    // EVENT DELEGATION
    // =========================================================
    if (convItemsEl) {
        convItemsEl.addEventListener("click", (e) => {
            const item = e.target.closest(".conv-item");
            if (!item) return;
            if (item.dataset.suppressClick === "1") { item.dataset.suppressClick = "0"; return; }
            const id = parseInt(item.dataset.id, 10);
            if (!isNaN(id)) { openConversation(id); setTimeout(function () { if (typeof window.__crevioRefreshBadges === "function") window.__crevioRefreshBadges(); }, 700); }
        });
        convItemsEl.addEventListener("contextmenu", (e) => {
            const item = e.target.closest(".conv-item");
            if (!item) return;
            e.preventDefault();
            const id = parseInt(item.dataset.id, 10);
            if (!isNaN(id)) openConversationMenu(id, e.clientX, e.clientY);
        });
        let lpTimer = null, lpTarget = null;
        convItemsEl.addEventListener("touchstart", (e) => {
            const item = e.target.closest(".conv-item");
            if (!item) return;
            lpTarget = item;
            const t = e.touches[0];
            lpTimer = setTimeout(() => {
                if (!lpTarget) return;
                lpTarget.dataset.suppressClick = "1";
                const id = parseInt(lpTarget.dataset.id, 10);
                if (!isNaN(id)) { openConversationMenu(id, t.clientX, t.clientY); if (navigator.vibrate) navigator.vibrate(15); }
                lpTarget = null;
            }, 500);
        }, { passive: true });
        const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpTarget = null; };
        convItemsEl.addEventListener("touchend", cancelLP);
        convItemsEl.addEventListener("touchmove", cancelLP);
        convItemsEl.addEventListener("touchcancel", cancelLP);
    }

    // =========================================================
    // OPEN CONVERSATION
    // =========================================================
    async function openConversation(id) {
        exitSelectionMode();
        activeConvId = id;
        replyToId = null;
        convItemsEl.querySelectorAll(".conv-item").forEach(el => el.classList.toggle("active", parseInt(el.dataset.id, 10) === id));
        convPanelEl.classList.add("mobile-hidden");
        chatPanelEl.classList.add("mobile-open");
        chatPanelEl.innerHTML = (window.CrevioLoader ? CrevioLoader.wrap(CrevioLoader.html("xxl"), { minHeight: "70vh" }) : '<div class="loading" style="margin:auto;">Loading…</div>');
        try {
            const res = await __timedFetch("/api/messages/conversations/" + id);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Not found");
            const conv = data.conversation || {};
            activeMessages = data.messages || [];
            const c = conversations.find(x => x.id === id);
            const hadUnread = c && (c.unread_count > 0 || c.manually_unread === 1);
            if (c) { c.unread_count = 0; c.manually_unread = 0; }

            // Toggle active class only (no full re-render)
            convItemsEl.querySelectorAll(".conv-item").forEach(el => {
                el.classList.toggle("active", parseInt(el.dataset.id, 10) === id);
            });

            // Only refresh stats if unread count changed
            if (hadUnread) loadStats();
            renderChatPanel(conv, activeMessages);
            setupChatHandlers(id);
            wireSelectionBar();
            wirePinBar();
            renderContext(conv);
            renderPinBar();
        } catch (err) {
            chatPanelEl.innerHTML = '<div class="empty-chat"><p>Could not load conversation: ' + escapeHtml(err.message) + '</p></div>';
        }
    }

    function renderChatPanel(conv, msgs) {
        const name = conv.client_name || "Client";
        const initial = name.charAt(0).toUpperCase();
        const email = conv.client_email || "";
        const status = conv.status || "new";
        const isMobile = window.innerWidth <= 900;

        chatPanelEl.innerHTML = `
            <div class="chat-header">
                <div class="chat-header-info">
                    ${isMobile ? '<button class="icon-btn" id="backBtn"><i data-lucide="arrow-left" class="icon"></i></button>' : ""}
                    <div class="chat-avatar">${initial}</div>
                    <div class="chat-header-text">
                        <h3>${escapeHtml(name)}</h3>
                        <p>${escapeHtml(email)}${email ? " · " : ""}${escapeHtml(status)}</p>
                    </div>
                </div>
                <div class="chat-actions">
                    <button class="icon-btn" id="contextToggleBtn" title="Toggle context panel" aria-label="Toggle context">
                        <i data-lucide="panel-right-close" class="icon"></i>
                    </button>
                </div>
            </div>
            <div class="pin-bar" id="pinBar" title="Click to view pinned message">
                <i data-lucide="pin" class="pin-icon"></i>
                <div class="pin-bar-body">
                    <div class="pin-bar-label" id="pinBarLabel">Pinned message</div>
                    <div class="pin-bar-text" id="pinBarText"></div>
                </div>
                <div class="pin-bar-nav" id="pinBarNav">
                    <button class="pin-bar-btn" id="pinPrev" title="Previous pinned"><i data-lucide="chevron-up" class="icon"></i></button>
                    <span class="pin-bar-count" id="pinCount"></span>
                    <button class="pin-bar-btn" id="pinNext" title="Next pinned"><i data-lucide="chevron-down" class="icon"></i></button>
                </div>
            </div>
            <div class="chat-messages" id="chatMessages">
                ${msgs.length ? renderMessageList(msgs) : '<div class="empty-chat" style="padding:20px;"><p>No messages yet. Say hi!</p></div>'}
            </div>
            <div class="mobile-context-strip" id="mobileContextStrip"></div>
            <div class="reply-preview" id="replyPreview">
                <div class="rp-text">
                    <div class="rp-label">Replying to</div>
                    <div class="rp-content" id="replyContent"></div>
                </div>
                <button id="replyCancel"><i data-lucide="x" class="icon"></i></button>
            </div>
            <div class="chat-input-bar">
                <button type="button" class="input-emoji-btn" id="inputEmojiBtn" title="Emoji" aria-label="Insert emoji">
                    <i data-lucide="smile" class="icon"></i>
                </button>
                <textarea id="msgInput" placeholder="Type your reply…" rows="1"></textarea>
                <button class="send-btn" id="sendBtn" title="Send"><i data-lucide="send" class="icon"></i></button>
            </div>
            <div class="char-counter" id="charCounter"></div>`;
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
        scrollToBottom();
    }

    // =========================================================
    // MESSAGE RENDERING
    // =========================================================
    function renderMessageList(msgs) {
        let html = "";
        let lastDay = null;
        msgs.forEach(m => {
            const d = parseDate(m.created_at);
            const key = d.toDateString();
            if (key !== lastDay) {
                html += '<div class="day-divider"><span>' + dayLabel(d) + '</span></div>';
                lastDay = key;
            }
            html += renderMessage(m);
            const r = renderReactionsRow(m);
            if (r) html += r;
        });
        return html;
    }

    
    // Render a stored reaction key → display string or <img>
    function renderReactionEmoji(emoji) {
        if (!emoji) return "";
        if (emoji.indexOf("flag:") === 0) {
            const code = emoji.slice(5);
            return '<img class="msg-reaction-flag" src="https://flagcdn.com/w20/' + code + '.png" alt="' + code + '" loading="lazy">';
        }
        return emoji;
    }

    function renderReactionsRow(m) {
        let reactions = {};
        try { reactions = m.reactions ? JSON.parse(m.reactions) : {}; } catch { reactions = {}; }
        const entries = Object.entries(reactions).filter(function(kv){ return Array.isArray(kv[1]) && kv[1].length > 0; });
        if (!entries.length) return "";
        const isMine = !!m.is_mine;
        return '<div class="msg-reactions-row ' + (isMine ? "align-right" : "align-left") + '">'
            + entries.map(function(kv){
                return '<span class="msg-reaction-pill" title="' + escapeHtml(kv[1].join(", ")) + '">' + renderReactionEmoji(kv[0]) + ' <span class="cnt">' + kv[1].length + '</span></span>';
            }).join("")
            + '</div>';
    }

        function renderMessage(m) {
        const isMine = !!m.is_mine;
        const time = formatTime(m.created_at);
        if (m.deleted === 1) {
            return '<div class="msg ' + (isMine ? "outgoing" : "incoming") + ' deleted" data-id="' + m.id + '">'
                + '<i data-lucide="ban" class="msg-deleted-icon"></i>'
                + '<span class="msg-content">' + (isMine ? "You" : "Client") + ' deleted this message</span>'
                + '<span class="msg-time">' + time + '</span>'
                + '</div>';
        }
        let tick = "";
        if (isMine) {
            if (m.read_at)           tick = '<i data-lucide="check-check" class="msg-check read" title="Read"></i>';
            else if (m.delivered_at) tick = '<i data-lucide="check-check" class="msg-check delivered" title="Delivered"></i>';
            else                     tick = '<i data-lucide="check" class="msg-check sent" title="Sent"></i>';
        }
        return '<div class="msg ' + (isMine ? "outgoing" : "incoming") + ' ' + (m.starred === 1 ? "starred" : "") + ' ' + (m.pinned === 1 ? "pinned-msg" : "") + '" data-id="' + m.id + '">'
            + '<div class="msg-content">' + escapeHtml(m.content || m.body || "") + '</div>'
            + '<div class="msg-meta">'
            + (m.edited === 1 ? '<span class="msg-edited">Edited</span>' : "")
            + '<span class="msg-time">' + time + '</span>'
            + tick
            + '</div>'
            + '</div>';
    }

    // =========================================================
    // CHAT HANDLERS
    // =========================================================
    function setupChatHandlers(convId) {
        const input = $("msgInput");
        const sendBtn = $("sendBtn");

        $("backBtn")?.addEventListener("click", () => {
            convPanelEl.classList.remove("mobile-hidden");
            chatPanelEl.classList.remove("mobile-open");
            activeConvId = null;
        });

        input?.addEventListener("input", function () {
            this.style.height = "44px";
            this.style.height = Math.min(this.scrollHeight, 140) + "px";
            updateCharCounter();
        });
        updateCharCounter();
        input?.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        sendBtn?.addEventListener("click", sendMessage);

        // Context panel toggle
        const ctxBtn = $("contextToggleBtn");
        if (ctxBtn && !ctxBtn.dataset.wired) {
            ctxBtn.dataset.wired = "1";
            ctxBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                const panel = document.getElementById("contextPanel");
                if (!panel) return;
                const nowHidden = panel.classList.toggle("hidden");
                try { localStorage.setItem("crevio_context_panel", nowHidden ? "hidden" : "shown"); } catch (err) {}
                updateContextToggleIcon();
            });
        }
        updateContextToggleIcon();

        // Input emoji button
        const inputEmojiBtn = $("inputEmojiBtn");
        if (inputEmojiBtn && !inputEmojiBtn.dataset.wired) {
            inputEmojiBtn.dataset.wired = "1";
            inputEmojiBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                const picker = document.getElementById("inputEmojiPicker");
                if (picker && picker.classList.contains("open")) {
                    picker.classList.remove("open");
                } else {
                    if (typeof openInputEmojiPicker === "function") {
                        openInputEmojiPicker();
                    } else {
                        console.error("[Messages] openInputEmojiPicker not defined");
                    }
                }
            });
        }
        $("replyCancel")?.addEventListener("click", () => {
            replyToId = null;
            $("replyPreview")?.classList.remove("open");
        });

        async function sendMessage() {
            const text = input.value.trim();
            if (!text) return;
            if (!planUnlimited && text.length > planLimit) {
                showToast("Message too long — your plan allows " + planLimit + " characters", true);
                return;
            }
            sendBtn.disabled = true;
            input.disabled = true;
            if (window.CrevioLoader) sendBtn.innerHTML = CrevioLoader.inline() + '<i data-lucide="send" class="icon" style="display:none;"></i>';
            try {
                const payload = { body: text };
                if (replyToId) payload.reply_to_id = replyToId;
                const res = await __timedFetch("/api/messages/conversations/" + convId, {
                    method: "POST",
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success && data.message) {
                    const container = $("chatMessages");
                    const lastDayEl = Array.from(container.querySelectorAll(".day-divider")).pop();
                    const lastDay = lastDayEl?.querySelector("span")?.textContent || "";
                    const newDay = dayLabel(parseDate(data.message.created_at));
                    if (lastDay !== newDay) {
                        container.insertAdjacentHTML("beforeend", '<div class="day-divider"><span>' + newDay + '</span></div>');
                    }
                    container.insertAdjacentHTML("beforeend", renderMessage({ ...data.message, is_mine: 1 }));
                    activeMessages.push(data.message);
                    input.value = "";
                    input.style.height = "44px";
                    replyToId = null;
                    $("replyPreview")?.classList.remove("open");
                    scrollToBottom();
                    try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                } else {
                    showToast(data.message || "Failed to send", true);
                }
            } catch (err) {
                showToast("Failed: " + err.message, true);
            } finally {
                sendBtn.disabled = false;
                input.disabled = false;
                input.focus();
                if (window.CrevioLoader) sendBtn.innerHTML = '<i data-lucide="send" class="icon"></i>';
                if (typeof lucide !== "undefined") { try { lucide.createIcons(); } catch (e) {} }
            }
        }
    }

    // =========================================================
    // MESSAGE CONTEXT MENU + REACTION BAR
    // =========================================================
    document.addEventListener("contextmenu", (e) => {
        const msgEl = e.target.closest("#chatMessages .msg");
        if (!msgEl) return;
        e.preventDefault();
        const id = parseInt(msgEl.dataset.id, 10);
        if (!isNaN(id)) openMessageMenu(id, e.clientX, e.clientY);
    });
    document.addEventListener("touchstart", (e) => {
        const msgEl = e.target.closest("#chatMessages .msg");
        if (!msgEl) return;
        const t = e.touches[0];
        window.__msgLpTimer = setTimeout(() => {
            const id = parseInt(msgEl.dataset.id, 10);
            if (!isNaN(id)) {
                openMessageMenu(id, t.clientX, t.clientY);
                if (navigator.vibrate) navigator.vibrate(15);
            }
        }, 500);
    }, { passive: true });
    const cancelMsgLP = () => { if (window.__msgLpTimer) { clearTimeout(window.__msgLpTimer); window.__msgLpTimer = null; } };
    document.addEventListener("touchend", cancelMsgLP);
    document.addEventListener("touchmove", cancelMsgLP);
    document.addEventListener("touchcancel", cancelMsgLP);

    function buildReactionBarHTML(msg) {
        const reactions = parseReactions(msg);
        return PRIMARY_REACTIONS.map(function (emoji) {
            const active = Array.isArray(reactions[emoji]) && reactions[emoji].indexOf("creator") >= 0;
            return '<button class="reaction-btn ' + (active ? "active" : "") + '" data-react="' + emoji + '" title="' + emoji + '">' + emoji + '</button>';
        }).join("") + '<button class="reaction-more" data-react-more title="More reactions"><i data-lucide="plus" class="icon"></i></button>';
    }

    function buildMessageMenuHTML(msg) {
        return MSG_MENU.map(item => {
            if (item.divider) return '<div class="mcm-divider"></div>';
            // Hide Edit unless it's allowed for this message
            if (item.id === "edit" && !canEditMessage(msg)) return "";
            let label = item.label;
            if (item.id === "pin")  label = msg.pinned === 1  ? "Unpin" : "Pin";
            if (item.id === "star") label = msg.starred === 1 ? "Unstar" : "Star";
            return '<button data-mcm-action="' + item.id + '" class="' + (item.danger ? "mcm-danger" : "") + '" role="menuitem">'
                + '<i data-lucide="' + item.icon + '" class="mcm-icon"></i>'
                + '<span>' + label + '</span>'
                + '</button>';
        }).join("");
    }

    
    


    


    // =========================================================
    // FULL EMOJI PICKER (tabbed, Business-gated)
    // =========================================================
    

    


    // =========================================================
    // FULL EMOJI PICKER (tabbed, searchable, scrollable, gated)
    // =========================================================
    

    


    // =========================================================
    // FULL EMOJI PICKER
    // =========================================================
    

    


    // =========================================================
    // FULL EMOJI PICKER — SINGLE SCROLL LIST (section headers)
    // =========================================================
    function buildReactionPickerHTML(msg) {
        const EMO = window.CREVIO_EMOJIS;
        if (!EMO || !EMO.categories) {
            return '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Emoji catalog not loaded</div>';
        }

        const reactions = parseReactions(msg);
        const isBusiness = (currentPlanName === "business");

        function renderEmoji(emoji) {
            const active = Array.isArray(reactions[emoji]) && reactions[emoji].indexOf("creator") >= 0;
            const locked = !isBusiness;
            return '<button type="button" class="rp-emoji ' + (active ? "active" : "") + '"' +
                ' data-react="' + emoji + '"' +
                (locked ? ' data-locked="1"' : '') +
                '>' + emoji + '</button>';
        }

        // Search bar
        let html = '<div class="rp-search">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="rp-search-icon"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" class="rp-search-input" placeholder="Search emoji" autocomplete="off">' +
            '</div>';

        // Scrollable body — ONE list with section headers
        html += '<div class="rp-body">';

        // Basic section
        html += '<div class="rp-section">';
        html += '<div class="rp-section-title">' + (isBusiness ? "Frequently Used" : "Basic") + '</div>';
        html += '<div class="rp-grid">' + EMO.basic.map(renderEmoji).join("") + '</div>';
        html += '</div>';

        // Each category = a section
        EMO.categories.forEach(function (cat) {
            html += '<div class="rp-section">';
            html += '<div class="rp-section-title">' + cat.label + (isBusiness ? "" : ' <span class="rp-section-lock">🔒 Business</span>') + '</div>';
            html += '<div class="rp-grid">';

            // Flags: render as images from flagcdn.com
            if (cat.id === "flags" && cat.flags) {
                cat.flags.forEach(function (f) {
                    const active = Array.isArray(reactions["flag:" + f.code]) && reactions["flag:" + f.code].indexOf("creator") >= 0;
                    const locked = !isBusiness;
                    html += '<button type="button" class="rp-emoji rp-flag ' + (active ? "active" : "") + '"' +
                        ' data-react="flag:' + f.code + '"' +
                        ' title="' + f.name + '"' +
                        (locked ? ' data-locked="1"' : '') +
                        '><img src="https://flagcdn.com/w40/' + f.code + '.png" alt="' + f.name + '" loading="lazy"></button>';
                });
            } else {
                html += cat.emojis.map(renderEmoji).join("");
            }

            html += '</div>';
            html += '</div>';
        });

        html += '</div>';

        // Upgrade banner for non-Business
        if (!isBusiness) {
            html += '<div class="rp-banner">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
                '<span>Unlock all emojis with <strong>Business</strong></span>' +
                '<a href="/dashboard/pages/billing.html">Upgrade</a>' +
                '</div>';
        }

        return html;
    }

    function openFullReactionPicker(msgId) {
        const msg = activeMessages.find(function (m) { return m.id === msgId; });
        if (!msg) return;

        let picker = document.getElementById("reactionPicker");
        if (!picker) {
            picker = document.createElement("div");
            picker.id = "reactionPicker";
            picker.className = "reaction-picker";
            document.body.appendChild(picker);
        }

        picker.innerHTML = buildReactionPickerHTML(msg);
        picker.classList.add("open");

        // Position
        picker.style.left = "-9999px";
        picker.style.top = "-9999px";
        const pRect = picker.getBoundingClientRect();
        const bar = document.getElementById("reactionBar");
        const vw = window.innerWidth, vh = window.innerHeight, margin = 8;

        let left = bar ? bar.getBoundingClientRect().left : 20;
        let top  = bar ? bar.getBoundingClientRect().top - pRect.height - 8 : 20;
        if (top < margin) top = (bar ? bar.getBoundingClientRect().bottom : 100) + 8;
        if (top + pRect.height > vh - margin) top = Math.max(margin, vh - pRect.height - margin);
        if (left + pRect.width > vw - margin) left = vw - pRect.width - margin;
        if (left < margin) left = margin;

        picker.style.left = left + "px";
        picker.style.top  = top + "px";

        // Search filter
        const searchInput = picker.querySelector(".rp-search-input");
        if (searchInput) {
            searchInput.addEventListener("input", function (e) {
                e.stopPropagation();
                const q = searchInput.value.trim().toLowerCase();
                picker.querySelectorAll(".rp-emoji").forEach(function (b) {
                    const t = (b.dataset.react || "").toLowerCase();
                    b.style.display = (!q || t.indexOf(q) >= 0) ? "" : "none";
                });
            });
        }

        // Emoji clicks
        picker.querySelectorAll(".rp-emoji").forEach(function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                if (btn.dataset.locked === "1") {
                    showToast("Business plan required for this emoji", true);
                    return;
                }
                const emoji = btn.dataset.react;
                picker.classList.remove("open");
                closeMessageMenu();
                if (typeof toggleMessageReaction === "function") {
                    toggleMessageReaction(msgId, emoji);
                }
            });
        });

        // Outside click closes
        setTimeout(function () {
            document.addEventListener("click", function closeOnce(ev) {
                if (!picker.contains(ev.target)) {
                    picker.classList.remove("open");
                    document.removeEventListener("click", closeOnce);
                }
            });
        }, 0);

        if (searchInput) setTimeout(function () { try { searchInput.focus(); } catch (e) {} }, 50);
    }


    // =========================================================
    // INPUT EMOJI PICKER
    function buildInputEmojiPicker() {
        const EMO = window.CREVIO_EMOJIS;
        if (!EMO || !EMO.categories) {
            return '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Emoji catalog not loaded</div>';
        }
        const isBusiness = (currentPlanName === "business");

        // Search
        const search = '<div class="ip-search">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" class="ip-search-input" placeholder="Search emoji" autocomplete="off">' +
            '</div>';

        // One scrollable body with all sections
        let body = '<div class="ip-body">';

        // Basic section
        body += '<div class="ip-section">';
        body += '<div class="ip-section-title">' + (isBusiness ? "Frequently Used" : "Basic") + '</div>';
        body += '<div class="ip-grid">';
        body += EMO.basic.map(function (e) {
            return '<button type="button" class="ip-emoji" data-emoji="' + e + '">' + e + '</button>';
        }).join("");
        body += '</div></div>';

        // All categories as sections
        EMO.categories.forEach(function (cat) {
            body += '<div class="ip-section">';
            body += '<div class="ip-section-title">' + cat.label + (isBusiness ? "" : " · Business") + '</div>';
            body += '<div class="ip-grid">';
            if (cat.id === "flags" && cat.flags) {
                cat.flags.forEach(function (f) {
                    body += '<button type="button" class="ip-emoji ip-flag' + (!isBusiness ? " ip-locked" : "") + '" data-emoji="flag:' + f.code + '" title="' + f.name + '">' +
                        '<img src="https://flagcdn.com/w40/' + f.code + '.png" alt="' + f.name + '" loading="lazy"></button>';
                });
            } else if (cat.emojis) {
                body += cat.emojis.map(function (e) {
                    return '<button type="button" class="ip-emoji' + (!isBusiness ? " ip-locked" : "") + '" data-emoji="' + e + '">' + e + '</button>';
                }).join("");
            }
            body += '</div></div>';
        });

        body += '</div>';

        // Banner
        let banner = "";
        if (!isBusiness) {
            banner = '<div class="ip-banner"><i data-lucide="lock" style="width:12px;height:12px"></i> Only basic emojis on your plan <a href="/dashboard/pages/billing.html">Upgrade</a></div>';
        }

        return search + body + banner;
    }

    function openInputEmojiPicker() {
        let picker = document.getElementById("inputEmojiPicker");
        if (!picker) {
            picker = document.createElement("div");
            picker.id = "inputEmojiPicker";
            picker.className = "input-emoji-picker";
            document.body.appendChild(picker);
        }

        picker.innerHTML = buildInputEmojiPicker();
        picker.classList.add("open");

        // Position above the input bar
        const inputBar = document.querySelector(".chat-input-bar");
        const vw = window.innerWidth, vh = window.innerHeight, margin = 8;

        picker.style.left = "-9999px";
        picker.style.top = "-9999px";
        const pRect = picker.getBoundingClientRect();

        let left = inputBar ? inputBar.getBoundingClientRect().left : 20;
        let top  = inputBar ? inputBar.getBoundingClientRect().top - pRect.height - 8 : 20;

        if (top < margin) top = margin;
        if (left + pRect.width > vw - margin) left = vw - pRect.width - margin;
        if (left < margin) left = margin;

        picker.style.left = left + "px";
        picker.style.top  = top + "px";

        // Tab switching
        const panels = picker.querySelectorAll(".ip-panel");
        picker.querySelectorAll(".ip-tab").forEach(function (tab) {
            tab.addEventListener("click", function (ev) {
                ev.stopPropagation();
                const target = tab.dataset.tab;
                picker.querySelectorAll(".ip-tab").forEach(function (t) {
                    t.classList.toggle("active", t.dataset.tab === target);
                });
                panels.forEach(function (p) {
                    p.classList.toggle("active", p.dataset.panel === target);
                });
                const bodyEl = picker.querySelector(".ip-body");
                if (bodyEl) bodyEl.scrollTop = 0;
                const si = picker.querySelector(".ip-search-input");
                if (si) { si.value = ""; picker.querySelectorAll(".ip-emoji").forEach(function (b) { b.style.display = ""; }); }
            });
        });

        // Search
        const si = picker.querySelector(".ip-search-input");
        if (si) {
            si.addEventListener("input", function (ev) {
                ev.stopPropagation();
                const q = si.value.trim().toLowerCase();
                const activePanel = picker.querySelector(".ip-panel.active");
                if (!activePanel) return;
                activePanel.querySelectorAll(".ip-emoji").forEach(function (b) {
                    const raw = (b.dataset.emoji || "").toLowerCase();
                    b.style.display = (!q || raw.indexOf(q) >= 0) ? "" : "none";
                });
            });
        }

        // Emoji click → insert into textarea
        picker.querySelectorAll(".ip-emoji").forEach(function (btn) {
            btn.addEventListener("click", function (ev) {
                ev.stopPropagation();
                if (btn.classList.contains("ip-locked")) {
                    showToast("Business plan required for this emoji", true);
                    return;
                }
                const emoji = btn.dataset.emoji;
                insertEmojiIntoInput(emoji);
            });
        });

        // Outside click closes
        setTimeout(function () {
            document.addEventListener("click", function closeOnce(ev) {
                if (!picker.contains(ev.target) && ev.target.id !== "inputEmojiBtn" && !ev.target.closest("#inputEmojiBtn")) {
                    picker.classList.remove("open");
                    document.removeEventListener("click", closeOnce);
                }
            });
        }, 0);

        if (typeof lucide !== "undefined") { try { lucide.createIcons(); } catch (e) {} }
    }

    function insertEmojiIntoInput(emoji) {
        const input = document.getElementById("msgInput");
        if (!input) return;

        // If a flag, convert to its unicode emoji via code (or keep image notation)
        let insertion = emoji;
        if (emoji.indexOf("flag:") === 0) {
            // Insert as a short flag token; the send handles it
            insertion = ":" + emoji + ":";
        }

        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const val = input.value;

        input.value = val.slice(0, start) + insertion + val.slice(end);
        const newPos = start + insertion.length;
        try { input.setSelectionRange(newPos, newPos); } catch (e) {}
        input.focus();

        // Trigger autosize + counter
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }


    // =========================================================
    // CONTEXT PANEL — rich client info, stats, notes, related
    // =========================================================
    async function renderContext(conv) {
        renderMobileContextStrip(conv);
        if (!contextContentEl) return;

        contextContentEl.innerHTML = '<div class="ctx-loading">Loading…</div>';

        try {
            const res = await window.apiFetch("/api/messages/conversations/" + conv.id + "/context");
            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Failed");
            renderContextPanel(data.context);
        } catch (e) {
            console.warn("[Messages] context load failed, using fallback:", e);
            renderBasicContext(conv);
        }
    }

    function renderMobileContextStrip(conv) {
        const strip = document.getElementById("mobileContextStrip");
        if (!strip) return;
        const chips = [];
        if (conv.context_service_title) chips.push('<span class="ctx-chip"><span class="ctx-key">Service</span><span class="ctx-val">' + escapeHtml(conv.context_service_title) + '</span></span>');
        if (conv.context_project_title) chips.push('<span class="ctx-chip"><span class="ctx-key">Project</span><span class="ctx-val">' + escapeHtml(conv.context_project_title) + '</span></span>');
        if (conv.budget)   chips.push('<span class="ctx-chip"><span class="ctx-key">Budget</span><span class="ctx-val">' + escapeHtml(conv.budget) + '</span></span>');
        if (conv.timeline) chips.push('<span class="ctx-chip"><span class="ctx-key">Timeline</span><span class="ctx-val">' + escapeHtml(conv.timeline) + '</span></span>');
        if (conv.source)   chips.push('<span class="ctx-chip"><span class="ctx-key">Source</span><span class="ctx-val">' + escapeHtml(conv.source) + '</span></span>');
        strip.innerHTML = chips.join("");
        strip.classList.toggle("has-items", chips.length > 0);
    }

    function renderBasicContext(conv) {
        if (!contextContentEl) return;
        const cards = [];
        if (conv.context_service_title) cards.push('<div class="context-card"><div class="label">Interested In</div><div class="value">' + escapeHtml(conv.context_service_title) + '</div></div>');
        if (conv.context_project_title) cards.push('<div class="context-card"><div class="label">Related Project</div><div class="value">' + escapeHtml(conv.context_project_title) + '</div></div>');
        if (conv.source)   cards.push('<div class="context-card"><div class="label">Source</div><div class="value">' + escapeHtml(conv.source) + '</div></div>');
        if (conv.budget)   cards.push('<div class="context-card"><div class="label">Budget</div><div class="value">' + escapeHtml(conv.budget) + '</div></div>');
        if (conv.timeline) cards.push('<div class="context-card"><div class="label">Timeline</div><div class="value">' + escapeHtml(conv.timeline) + '</div></div>');
        contextContentEl.innerHTML = cards.length ? cards.join("") : '<div class="empty-state"><p>No context attached to this conversation.</p></div>';
    }

    function renderContextPanel(ctx) {
        if (!contextContentEl) return;

        const c = ctx.client || {};
        const s = ctx.stats || {};
        const m = ctx.meta || {};
        const rel = ctx.related || [];
        const notes = ctx.notes || "";

        let html = "";

        // --- Client profile ---
        html += '<div class="ctx-profile">';
        html += '  <div class="ctx-avatar">' + escapeHtml(c.initial || "?") + '</div>';
        html += '  <div class="ctx-profile-text">';
        html += '    <div class="ctx-name">' + escapeHtml(c.name || "Client") + '</div>';
        if (c.email) html += '    <div class="ctx-email" title="' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + '</div>';
        html += '    <span class="ctx-badge">' + escapeHtml(c.badge || "Client") + '</span>';
        html += '  </div>';
        html += '</div>';

        // --- Quick actions ---
        if (c.email) {
            html += '<div class="ctx-actions">';
            html += '  <button type="button" class="ctx-action" data-ctx-action="copy-email"><i data-lucide="copy" class="icon"></i> Copy</button>';
            html += '  <a class="ctx-action" href="mailto:' + escapeHtml(c.email) + '"><i data-lucide="mail" class="icon"></i> Mail</a>';
            html += '</div>';
        }

        // --- Activity stats ---
        html += '<div class="ctx-section">';
        html += '  <div class="ctx-section-title">Activity</div>';
        html += '  <div class="ctx-stats">';
        html += '    <div class="ctx-stat"><div class="ctx-stat-num">' + (s.total || 0) + '</div><div class="ctx-stat-label">Total</div></div>';
        html += '    <div class="ctx-stat"><div class="ctx-stat-num">' + (s.theirs || 0) + '</div><div class="ctx-stat-label">From client</div></div>';
        html += '    <div class="ctx-stat"><div class="ctx-stat-num">' + (s.age_days || 0) + 'd</div><div class="ctx-stat-label">Age</div></div>';
        html += '  </div>';
        html += '</div>';

        // --- Meta info ---
        const metaCards = [];
        if (m.service_title) metaCards.push({ label: "Interested In", value: m.service_title });
        if (m.project_title) metaCards.push({ label: "Related Project", value: m.project_title });
        if (m.source)        metaCards.push({ label: "Source", value: m.source });
        if (m.budget)        metaCards.push({ label: "Budget", value: m.budget });
        if (m.timeline)      metaCards.push({ label: "Timeline", value: m.timeline });

        if (metaCards.length) {
            html += '<div class="ctx-section">';
            html += '  <div class="ctx-section-title">Info</div>';
            metaCards.forEach(function (mc) {
                html += '    <div class="ctx-card"><div class="ctx-card-label">' + escapeHtml(mc.label) + '</div><div class="ctx-card-value">' + escapeHtml(mc.value) + '</div></div>';
            });
            html += '</div>';
        }

        // --- Private notes ---
        html += '<div class="ctx-section">';
        html += '  <div class="ctx-section-title">Private Notes</div>';
        html += '  <textarea class="ctx-notes-input" placeholder="Add a private reminder about this client…" rows="3"></textarea>';
        html += '  <div class="ctx-notes-actions">';
        html += '    <span class="ctx-notes-saved" style="display:none">✓ Saved</span>';
        html += '    <button type="button" class="ctx-notes-save">Save note</button>';
        html += '  </div>';
        html += '</div>';

        // --- Related inquiries ---
        if (rel.length) {
            html += '<div class="ctx-section">';
            html += '  <div class="ctx-section-title">Other Inquiries</div>';
            rel.forEach(function (r) {
                html += '  <button type="button" class="ctx-related" data-related-id="' + r.id + '">';
                html += '    <div class="ctx-related-preview">' + (escapeHtml(r.preview) || "No messages yet") + '</div>';
                html += '    <div class="ctx-related-meta">' + formatRelativeTime(r.created_at) + ' · ' + escapeHtml(r.status) + '</div>';
                html += '  </button>';
            });
            html += '</div>';
        }

        contextContentEl.innerHTML = html;

        // --- Wire notes ---
        const ta = contextContentEl.querySelector(".ctx-notes-input");
        const saveBtn = contextContentEl.querySelector(".ctx-notes-save");
        const savedLbl = contextContentEl.querySelector(".ctx-notes-saved");
        if (ta) ta.value = notes;
        if (saveBtn && ta) {
            saveBtn.addEventListener("click", async function () {
                saveBtn.disabled = true;
                saveBtn.textContent = "Saving…";
                try {
                    await patchConv(activeConvId, { notes: ta.value });
                    if (savedLbl) {
                        savedLbl.style.display = "inline";
                        setTimeout(function () { savedLbl.style.display = "none"; }, 2000);
                    }
                } catch (e) {
                    showToast("Could not save note", true);
                } finally {
                    saveBtn.disabled = false;
                    saveBtn.textContent = "Save note";
                }
            });
        }

        // --- Wire copy email ---
        const copyBtn = contextContentEl.querySelector('[data-ctx-action="copy-email"]');
        if (copyBtn && c.email) {
            copyBtn.addEventListener("click", async function () {
                try {
                    await navigator.clipboard.writeText(c.email);
                    showToast("Email copied");
                } catch (e) {
                    const tmp = document.createElement("textarea");
                    tmp.value = c.email;
                    document.body.appendChild(tmp);
                    tmp.select();
                    try { document.execCommand("copy"); showToast("Email copied"); } catch (e2) { showToast("Copy failed", true); }
                    document.body.removeChild(tmp);
                }
            });
        }

        // --- Wire related inquiries ---
        contextContentEl.querySelectorAll(".ctx-related").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const id = parseInt(btn.dataset.relatedId, 10);
                if (!isNaN(id)) { openConversation(id); setTimeout(function () { if (typeof window.__crevioRefreshBadges === "function") window.__crevioRefreshBadges(); }, 700); }
            });
        });

        if (typeof lucide !== "undefined") { try { lucide.createIcons(); } catch (e) {} }
    }


    function updateContextToggleIcon() {
        const panel = document.getElementById("contextPanel");
        const btn = document.getElementById("contextToggleBtn");
        if (!panel || !btn) return;
        const hidden = panel.classList.contains("hidden");
        const icon = btn.querySelector("i, svg");
        if (icon) {
            icon.outerHTML = '<i data-lucide="' + (hidden ? "panel-right-open" : "panel-right-close") + '" class="icon"></i>';
        }
        btn.setAttribute("title", hidden ? "Show context" : "Hide context");
        if (typeof lucide !== "undefined") { try { lucide.createIcons(); } catch (e) {} }
    }


    function restoreContextPanelState() {
        const panel = document.getElementById("contextPanel");
        if (!panel) return;
        try {
            const saved = localStorage.getItem("crevio_context_panel");
            if (saved === "hidden") panel.classList.add("hidden");
            else if (saved === "shown") panel.classList.remove("hidden");
        } catch (e) {}
    }

function openMessageMenu(msgId, x, y) {




        mcmTargetId = msgId;
        const msg = activeMessages.find(m => m.id === msgId);
        if (!msg) return;

        reactionBarEl.innerHTML = buildReactionBarHTML(msg);
        msgContextMenuEl.innerHTML = buildMessageMenuHTML(msg);
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}

        const vw = window.innerWidth, vh = window.innerHeight, margin = 8;
        const gap = 8;

        msgContextMenuEl.style.left = "-9999px";
        msgContextMenuEl.style.top  = "-9999px";
        msgContextMenuEl.classList.add("open");

        const menuRect = msgContextMenuEl.getBoundingClientRect();
        let menuLeft = x, menuTop = y;
        if (menuLeft + menuRect.width  > vw - margin) menuLeft = vw - menuRect.width - margin;
        if (menuTop  + menuRect.height > vh - margin) menuTop  = vh - menuRect.height - margin;
        if (menuLeft < margin) menuLeft = margin;
        if (menuTop  < margin) menuTop  = margin;
        msgContextMenuEl.style.left = menuLeft + "px";
        msgContextMenuEl.style.top  = menuTop  + "px";

        reactionBarEl.style.left = "-9999px";
        reactionBarEl.style.top  = "-9999px";
        reactionBarEl.classList.add("open");

        const barRect = reactionBarEl.getBoundingClientRect();
        let barLeft = menuLeft;
        let barTop  = menuTop - barRect.height - gap;
        let originY = "bottom left";

        if (barTop < margin) {
            barTop = menuTop + menuRect.height + gap;
            originY = "top left";
        }
        if (barLeft + barRect.width > vw - margin) barLeft = vw - barRect.width - margin;
        if (barLeft < margin) barLeft = margin;

        reactionBarEl.style.transformOrigin = originY;
        reactionBarEl.style.left = barLeft + "px";
        reactionBarEl.style.top  = barTop  + "px";

        reactionBarEl.querySelectorAll("[data-react]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleMessageReaction(msgId, btn.dataset.react);
            });
        });
        reactionBarEl.querySelector("[data-react-more]")?.addEventListener("click", (e) => {
            e.stopPropagation();
            openFullReactionPicker(mcmTargetId);
        });

        msgContextMenuEl.querySelectorAll("[data-mcm-action]").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = btn.dataset.mcmAction;
                closeMessageMenu();
                await handleMessageAction(action, msgId);
            });
        });
    }

    function closeMessageMenu() {
const bar = document.getElementById("reactionBar");
        if (bar) bar.classList.remove("open");

        msgContextMenuEl?.classList.remove("open");
        reactionBarEl?.classList.remove("open");
        mcmTargetId = null;
    }

    function parseReactions(msg) {
        try { return msg.reactions ? JSON.parse(msg.reactions) : {}; } catch { return {}; }
    }

    async function toggleMessageReaction(msgId, emoji) {
        try {
            const res = await __timedFetch("/api/messages/conversations/" + activeConvId + "/messages/" + msgId + "/reactions", {
                method: "POST",
                body: JSON.stringify({ emoji: emoji, side: "creator" })
            });
            const data = await res.json();
            if (data.success) {
                const msg = activeMessages.find(m => m.id === msgId);
                if (msg) msg.reactions = JSON.stringify(data.reactions);
                refreshMessageReactions(msgId);
                closeMessageMenu();
            } else {
                showToast(data.message || "Failed", true);
            }
        } catch (e) { showToast("Failed: " + e.message, true); }
    }

    function refreshMessageReactions(msgId) {
        const container = $("chatMessages");
        if (!container) return;
        const msgEl = container.querySelector('.msg[data-id="' + msgId + '"]');
        if (!msgEl) return;
        const msg = activeMessages.find(m => m.id === msgId);
        if (!msg) return;
        const next = msgEl.nextElementSibling;
        if (next && next.classList.contains("msg-reactions-row")) next.remove();
        const html = renderReactionsRow(msg);
        if (html) msgEl.insertAdjacentHTML("afterend", html);
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
    }

    async function handleMessageAction(action, msgId) {
        const msg = activeMessages.find(m => m.id === msgId);
        if (!msg) return;
        switch (action) {
            case "reply": {
                replyToId = msgId;
                const rp = $("replyPreview");
                const rc = $("replyContent");
                if (rp && rc) {
                    rc.textContent = (msg.content || "").slice(0, 100);
                    rp.classList.add("open");
                }
                $("msgInput")?.focus();
                break;
            }
            case "copy": {
                try {
                    await navigator.clipboard.writeText(msg.content || "");
                    showToast("Copied to clipboard");
                } catch {
                    const ta = document.createElement("textarea");
                    ta.value = msg.content || ""; document.body.appendChild(ta); ta.select();
                    try { document.execCommand("copy"); showToast("Copied"); } catch { showToast("Copy failed", true); }
                    document.body.removeChild(ta);
                }
                break;
            }
            case "forward": {
                openForwardPanel([msgId]);
                break;
            }
            case "edit": {
                openEditDialog(msgId);
                break;
            }
            case "askbot": {
                openCrevioBotWithMessage(msg);
                break;
            }
            case "pin": {
                if (msg.pinned === 1) {
                    // Already pinned  offer unpin
                    if (!await confirmDialog("Unpin this message?", { title: "Unpin", confirmText: "Unpin", danger: true })) return;
                    try {
                        await __timedFetch("/api/messages/conversations/" + activeConvId + "/messages/" + msgId + "/pin", { method: "DELETE" });
                        const m = activeMessages.find(x => x.id === msgId);
                        if (m) { m.pinned = 0; m.pinned_until = null; }
                        const container = $("chatMessages");
                        if (container) {
                            const el = container.querySelector('.msg[data-id="' + msgId + '"]');
                            if (el) {
                                const next = el.nextElementSibling;
                                if (next && next.classList.contains("msg-reactions-row")) next.remove();
                                const html = renderMessage(m) + (renderReactionsRow(m) || "");
                                const tmp = document.createElement("div");
                                tmp.innerHTML = html;
                                el.replaceWith(...Array.from(tmp.children));
                                try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                            }
                        }
                        showToast("Unpinned");
                        renderPinBar();
                    } catch (e) { showToast("Failed", true); }
                } else {
                    await openPinDialog(msgId);
                }
                break;
            }
            case "star": {
                const newVal = msg.starred === 1 ? 0 : 1;
                await updateMessageField(msgId, { starred: newVal });
                showToast(newVal ? "Message starred" : "Message unstarred");
                break;
            }
            case "select": {
                enterSelectionMode(msgId);
                break;
            }
            case "report":
                await updateMessageField(msgId, { reported: 1 });
                showToast("Message reported");
                break;
            case "delete": {
                const scope = await deleteDialog(!!msg.is_mine);
                if (!scope) return;
                try {
                    await __timedFetch("/api/messages/conversations/" + activeConvId + "/messages/" + msgId + "?scope=" + scope, { method: "DELETE" });
                    if (scope === "everyone") {
                        const m = activeMessages.find(x => x.id === msgId);
                        if (m) { m.deleted = 1; m.content = ""; }
                    } else {
                        activeMessages = activeMessages.filter(m => m.id !== msgId);
                    }
                    const container = $("chatMessages");
                    if (container) {
                        container.innerHTML = renderMessageList(activeMessages);
                        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                        scrollToBottom();
                    }
                    showToast(scope === "everyone" ? "Message deleted for everyone" : "Message deleted for you");
                } catch (e) { showToast("Failed: " + e.message, true); }
                break;
            }
        }
    }

    async function updateMessageField(msgId, body) {
        try {
            const res = await __timedFetch("/api/messages/conversations/" + activeConvId + "/messages/" + msgId, {
                method: "PATCH",
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Update failed");
            const m = activeMessages.find(x => x.id === msgId);
            if (m) Object.assign(m, data.message);
            const container = $("chatMessages");
            if (container) {
                const el = container.querySelector('.msg[data-id="' + msgId + '"]');
                if (el) {
                    const next = el.nextElementSibling;
                    if (next && next.classList.contains("msg-reactions-row")) next.remove();
                    const html = renderMessage(m) + (renderReactionsRow(m) || "");
                    const tmp = document.createElement("div");
                    tmp.innerHTML = html;
                    const nodes = Array.from(tmp.children);
                    el.replaceWith(...nodes);
                    try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                }
            }
        } catch (e) {
            showToast(e.message || "Failed", true);
            throw e;
        }
    }

    document.addEventListener("click", (e) => {
        const inMenu = msgContextMenuEl?.contains(e.target);
        const inBar  = reactionBarEl?.contains(e.target);
        if ((msgContextMenuEl?.classList.contains("open") || reactionBarEl?.classList.contains("open")) && !inMenu && !inBar) {
            closeMessageMenu();
        }
    });
    document.addEventListener("contextmenu", (e) => {
        if (!e.target.closest("#chatMessages .msg")) closeMessageMenu();
    });
    window.addEventListener("resize", closeMessageMenu);
    window.addEventListener("scroll", closeMessageMenu, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMessageMenu(); });

    // =========================================================
    // CONVERSATION CONTEXT MENU
    // =========================================================
    function openConversationMenu(convId, x, y) {
        cmTargetId = convId;
        const menu = contextMenuEl;
        if (!menu) return;
        menu.querySelectorAll(".cm-has-submenu").forEach(s => s.classList.remove("submenu-open"));
        menu.style.left = "-9999px"; menu.style.top = "-9999px";
        menu.classList.add("open");

        const conv = conversations.find(c => c.id === convId) || {};
        const aLbl = menu.querySelector('[data-label="archive"]');
        const pLbl = menu.querySelector('[data-label="pin"]');
        const fLbl = menu.querySelector('[data-label="favourite"]');
        if (aLbl) aLbl.textContent = conv.archived === 1 ? "Unarchive chat" : "Archive chat";
        if (pLbl) pLbl.textContent = conv.pinned === 1   ? "Unpin chat"     : "Pin chat";
        if (fLbl) fLbl.textContent = conv.starred === 1  ? "Remove from favourites" : "Add to favourites";

        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}

        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight, margin = 8;
        let left = x, top = y;
        if (left + rect.width  > vw - margin) left = vw - rect.width - margin;
        if (top  + rect.height > vh - margin) top  = vh - rect.height - margin;
        if (left < margin) left = margin;
        if (top  < margin) top  = margin;
        menu.style.left = left + "px";
        menu.style.top  = top + "px";

        const rightSpace = vw - (left + rect.width);
        const needFlip = rightSpace < 200;
        menu.querySelectorAll(".cm-has-submenu").forEach(s => s.classList.toggle("flip-left", needFlip));
    }

    function closeConversationMenu() {
        contextMenuEl?.classList.remove("open");
        contextMenuEl?.querySelectorAll(".cm-has-submenu").forEach(s => s.classList.remove("submenu-open"));
        cmTargetId = null;
    }

    document.addEventListener("click", (e) => {
        if (contextMenuEl?.classList.contains("open") && !contextMenuEl.contains(e.target)) closeConversationMenu();
    });
    document.addEventListener("contextmenu", (e) => {
        if (!e.target.closest(".conv-item")) closeConversationMenu();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeConversationMenu(); });

    contextMenuEl?.querySelectorAll("[data-cm-action]").forEach(el => {
        el.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = el.dataset.cmAction;
            if (el.classList.contains("cm-has-submenu")) {
                if (matchMedia("(hover: none)").matches) {
                    const already = el.classList.contains("submenu-open");
                    contextMenuEl.querySelectorAll(".cm-has-submenu").forEach(s => { if (s !== el) s.classList.remove("submenu-open"); });
                    el.classList.toggle("submenu-open", !already);
                }
                return;
            }
            if (!cmTargetId) return;
            const targetId = cmTargetId;
            closeConversationMenu();
            await handleConversationAction(action, targetId);
        });
    });

    async function handleConversationAction(action, convId) {
        const conv = conversations.find(c => c.id === convId);
        if (!conv) return;
        try {
            switch (action) {
                case "archive":
                    await patchConv(convId, { archived: conv.archived === 1 ? 0 : 1 });
                    showToast(conv.archived === 1 ? "Unarchived" : "Archived");
                    refreshAfterAction();
                    break;
                case "mute-on":  await patchConv(convId, { muted: 1 }); showToast("Muted");   refreshAfterAction(); break;
                case "mute-off": await patchConv(convId, { muted: 0 }); showToast("Unmuted"); refreshAfterAction(); break;
                case "pin":
                    await patchConv(convId, { pinned: conv.pinned === 1 ? 0 : 1 });
                    showToast(conv.pinned === 1 ? "Unpinned" : "Pinned to top");
                    refreshAfterAction();
                    break;
                case "unread":
                    await patchConv(convId, { manually_unread: 1 });
                    showToast("Marked as unread");
                    refreshAfterAction();
                    break;
                case "favourite":
                    await patchConv(convId, { starred: conv.starred === 1 ? 0 : 1 });
                    showToast(conv.starred === 1 ? "Removed from favourites" : "Added to favourites");
                    refreshAfterAction();
                    break;
                case "list-new": {
                    const name = prompt("Name your list:");
                    if (!name || !name.trim()) return;
                    await patchConv(convId, { list_name: name.trim() });
                    showToast('Added to "' + name.trim() + '"');
                    refreshAfterAction();
                    break;
                }
                case "list-remove":
                    if (!conv.list_name) { showToast("Not in any list"); return; }
                    await patchConv(convId, { list_name: null });
                    showToast("Removed from list");
                    refreshAfterAction();
                    break;
                case "clear": {
                    const ok = await confirmDialog("Clear all messages? The conversation will stay in your inbox.", { title: "Clear chat", confirmText: "Clear", danger: true });
                    if (!ok) return;
                    await __timedFetch("/api/messages/conversations/" + convId + "/messages", { method: "DELETE" });
                    showToast("Chat cleared");
                    if (activeConvId === convId) resetChatPanel("eraser", "Chat cleared", "This conversation has no messages.");
                    refreshAfterAction();
                    break;
                }
                case "delete": {
                    const ok = await confirmDialog("Permanently delete this conversation? This cannot be undone.", { title: "Delete conversation", confirmText: "Delete", danger: true });
                    if (!ok) return;
                    await __timedFetch("/api/messages/conversations/" + convId, { method: "DELETE" });
                    showToast("Conversation deleted");
                    conversations = conversations.filter(c => c.id !== convId);
                    if (activeConvId === convId) {
                        activeConvId = null;
                        resetChatPanel("message-square", "Conversation deleted", "Select another to continue.");
                        resetContextPanel();
                    }
                    refreshAfterAction();
                    break;
                }
            }
        } catch (e) { showToast("Failed: " + e.message, true); }
    }

    async function patchConv(id, body) {
        const res = await __timedFetch("/api/messages/conversations/" + id, { method: "PATCH", body: JSON.stringify(body) });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || "Update failed");
        return data;
    }
    function refreshAfterAction() { loadConversations(); loadStats(); layoutFilters(); }
    function resetChatPanel(iconName, title, sub) {
        chatPanelEl.innerHTML = '<div class="empty-chat"><i data-lucide="' + iconName + '" class="icon"></i><div><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(sub) + '</p></div></div>';
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
    }
    function resetContextPanel() {
        if (contextContentEl) contextContentEl.innerHTML = '<div class="empty-state"><p>Context appears here when you open a conversation.</p></div>';
    }

    // =========================================================
    // CONTEXT PANEL
    // =========================================================
    

    // =========================================================
    // CHEVRON DROPDOWN
    // =========================================================
    chipMoreBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = chipDropdown.classList.contains("open");
        chipDropdown.classList.toggle("open", !open);
        chipMoreBtn.classList.toggle("open", !open);
    });
    document.addEventListener("click", (e) => {
        if (chipDropdown && chipMoreBtn && !chipDropdown.contains(e.target) && !chipMoreBtn.contains(e.target)) {
            chipDropdown.classList.remove("open");
            chipMoreBtn.classList.remove("open");
        }
    });
    chipDropdown?.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            chipDropdown.classList.remove("open");
            chipMoreBtn.classList.remove("open");
            if (action === "mark-all-read") {
                try {
                    const res = await __timedFetch("/api/messages/read-all", { method: "PATCH" });
                    const data = await res.json();
                    if (data.success) { showToast("All marked as read"); refreshAfterAction(); }
                } catch (e) { showToast("Failed", true); }
            } else if (action === "clear-filters") {
                search = ""; if (searchInput) searchInput.value = "";
                filter = "all"; applyActiveFilter(); layoutFilters(); loadConversations(); loadStats();
                showToast("Filters cleared");
            }
        });
    });

    // =========================================================
    // SEARCH / RESIZE
    // =========================================================
    searchInput?.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        const v = this.value;
        debounceTimer = setTimeout(() => { search = v; loadConversations(); }, 300);
    });
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(layoutFilters, 120);
    });

    // =========================================================
    // DIALOGS
    // =========================================================
    function confirmDialog(message, opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            const overlay   = $("confirmOverlay");
            const titleEl   = $("confirmTitle");
            const msgEl     = $("confirmMessage");
            const okBtn     = $("confirmOk");
            const cancelBtn = $("confirmCancel");
            if (!overlay || !okBtn || !cancelBtn) { resolve(window.confirm(message)); return; }

            titleEl.textContent = opts.title || "Are you sure?";
            msgEl.textContent   = message;
            okBtn.textContent   = opts.confirmText || "OK";
            cancelBtn.textContent = opts.cancelText || "Cancel";
            okBtn.className = "confirm-btn " + (opts.danger ? "danger" : "confirm");

            overlay.classList.add("open");

            const close = (result) => {
                overlay.classList.remove("open");
                okBtn.removeEventListener("click", onOk);
                cancelBtn.removeEventListener("click", onCancel);
                overlay.removeEventListener("click", onOverlay);
                document.removeEventListener("keydown", onKey);
                resolve(result);
            };
            const onOk      = () => close(true);
            const onCancel  = () => close(false);
            const onOverlay = (e) => { if (e.target === overlay) close(false); };
            const onKey     = (e) => {
                if (e.key === "Escape") close(false);
                if (e.key === "Enter")  close(true);
            };
            okBtn.addEventListener("click", onOk);
            cancelBtn.addEventListener("click", onCancel);
            overlay.addEventListener("click", onOverlay);
            document.addEventListener("keydown", onKey);
        });
    }

    function deleteDialog(canDeleteForEveryone) {
        return new Promise((resolve) => {
            const overlay     = $("deleteOverlay");
            const btnEveryone = $("deleteEveryone");
            const btnMe       = $("deleteMe");
            const btnCancel   = $("deleteCancel");
            if (!overlay || !btnEveryone || !btnMe || !btnCancel) { resolve("everyone"); return; }

            btnEveryone.style.display = canDeleteForEveryone ? "block" : "none";
            overlay.classList.add("open");

            const close = (result) => {
                overlay.classList.remove("open");
                btnEveryone.removeEventListener("click", onEveryone);
                btnMe.removeEventListener("click", onMe);
                btnCancel.removeEventListener("click", onCancel);
                overlay.removeEventListener("click", onOverlay);
                document.removeEventListener("keydown", onKey);
                resolve(result);
            };
            const onEveryone = () => close("everyone");
            const onMe       = () => close("me");
            const onCancel   = () => close(null);
            const onOverlay  = (e) => { if (e.target === overlay) close(null); };
            const onKey      = (e) => { if (e.key === "Escape") close(null); };

            btnEveryone.addEventListener("click", onEveryone);
            btnMe.addEventListener("click", onMe);
            btnCancel.addEventListener("click", onCancel);
            overlay.addEventListener("click", onOverlay);
            document.addEventListener("keydown", onKey);
        });
    }

    // =========================================================
    // HELPERS
    // =========================================================
    function updateCharCounter() {
        const input = $("msgInput");
        const el = $("charCounter");
        if (!input || !el) return;
        const len = input.value.length;

        if (planUnlimited) {
            el.className = "char-counter";
            el.innerHTML = '<span class="plan-tag">Business</span>' + len + ' / ∞';
            return;
        }

        const remaining = planLimit - len;
        const planTag = planLimit === 1000 ? "Free" : "Pro";
        el.className = "char-counter" + (remaining < 0 ? " over" : (remaining < 100 ? " warn" : ""));
        el.innerHTML = '<span class="plan-tag">' + planTag + '</span>' + len + ' / ' + planLimit;
    }
    function openCrevioBotWithMessage(msg) {
        if (!msg) return;
        const conv = conversations.find(c => c.id === activeConvId) || {};
        const payload = {
            type:            "message_analysis",
            message:         msg.content || "",
            conversation_id: activeConvId,
            client_name:     conv.client_name || "Client",
            client_email:    conv.client_email || "",
            service_title:   conv.context_service_title || "",
            project_title:   conv.context_project_title || "",
            message_time:    msg.created_at || "",
            ts:              Date.now()
        };
        try { localStorage.setItem("crevio_bot_context", JSON.stringify(payload)); } catch (e) {}
        window.open("/dashboard/pages/bot.html?from=messages", "_blank");
    }
    async function loadPinOptions(force) {
        if (pinOptionsCache && !force) return pinOptionsCache;
        try {
            const res = await __timedFetch("/api/messages/pin-options");
            const d = await res.json();
            if (d.success) pinOptionsCache = d;
        } catch (e) { console.error("[Messages] pin-options fetch failed", e); }
        return pinOptionsCache;
    }

    async function openPinDialog(msgId) {
        const msg = activeMessages.find(m => m.id === msgId);
        if (!msg) return;

        const overlay   = $("pinDialogOverlay");
        const optionsEl = $("pinOptions");
        const usageEl   = $("pinUsage");
        const cancelBtn = $("pinCancel");
        const confirmBtn= $("pinConfirm");
        if (!overlay || !optionsEl || !confirmBtn) { showToast("Pin dialog missing", true); return; }

        const opts = await loadPinOptions(true);
        if (!opts || !opts.durations) { showToast("Could not load pin options", true); return; }

        const alreadyPinned = msg.pinned === 1;
        const plan = opts.plan || "free";
        const maxPerChat = opts.maxPerChat || 2;

        // Count current active pins in this conversation (excluding this msg)
        const currentPins = activeMessages.filter(m => m.pinned === 1 && m.id !== msgId).length;
        const remaining = Math.max(0, maxPerChat - currentPins);

        usageEl.textContent = currentPins + " of " + maxPerChat + " pinned in this chat";
        usageEl.style.color = remaining === 0 ? "var(--warning)" : "var(--text-muted)";

        // Build options
        optionsEl.innerHTML = opts.durations.map((d, i) => {
            const sel = i === 0 ? "selected" : "";
            return '<label class="pin-dialog-opt ' + sel + '" data-hours="' + d.hours + '">'
                + '<input type="radio" name="pin-duration" value="' + d.hours + '" ' + (i === 0 ? "checked" : "") + '>'
                + '<span class="pin-dialog-radio"></span>'
                + '<span class="pin-dialog-opt-label">' + d.label + '</span>'
                + '</label>';
        }).join("");

        let selectedHours = opts.durations[0].hours;

        optionsEl.querySelectorAll(".pin-dialog-opt").forEach(opt => {
            opt.addEventListener("click", () => {
                optionsEl.querySelectorAll(".pin-dialog-opt").forEach(o => o.classList.remove("selected"));
                opt.classList.add("selected");
                selectedHours = parseInt(opt.dataset.hours, 10);
            });
        });

        overlay.classList.add("open");

        const close = () => {
            overlay.classList.remove("open");
            cancelBtn.removeEventListener("click", onCancel);
            confirmBtn.removeEventListener("click", onConfirm);
            overlay.removeEventListener("click", onOverlay);
            document.removeEventListener("keydown", onKey);
        };
        const onCancel  = () => close();
        const onOverlay = (e) => { if (e.target === overlay) close(); };
        const onKey     = (e) => { if (e.key === "Escape") close(); };
        const onConfirm = async () => {
            close();
            try {
                const res = await __timedFetch(
                    "/api/messages/conversations/" + activeConvId + "/messages/" + msgId + "/pin",
                    { method: "POST", body: JSON.stringify({ hours: selectedHours }) }
                );
                const data = await res.json();
                if (!data.success) throw new Error(data.message || "Pin failed");

                // Update local state
                const m = activeMessages.find(x => x.id === msgId);
                if (m) { m.pinned = 1; m.pinned_until = data.pinned_until; }
                // Re-render message bubble to reflect pin
                const container = $("chatMessages");
                if (container) {
                    const el = container.querySelector('.msg[data-id="' + msgId + '"]');
                    if (el) {
                        const next = el.nextElementSibling;
                        if (next && next.classList.contains("msg-reactions-row")) next.remove();
                        const html = renderMessage(m) + (renderReactionsRow(m) || "");
                        const tmp = document.createElement("div");
                        tmp.innerHTML = html;
                        el.replaceWith(...Array.from(tmp.children));
                        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                    }
                }
                showToast("Pinned for " + selectedHours + " hours");
                renderPinBar();
            } catch (e) {
                showToast(e.message || "Could not pin", true);
            }
        };

        cancelBtn.addEventListener("click", onCancel);
        confirmBtn.addEventListener("click", onConfirm);
        overlay.addEventListener("click", onOverlay);
        document.addEventListener("keydown", onKey);
    }


    // =========================================================
    // PINNED MESSAGE BAR
    // Shows the most recent active pin above the thread.
    // Click the bar  scroll to that message + flash highlight.
    // =========================================================
    let pinBarIndex = 0;

    function getActivePins() {
        return activeMessages.filter(function (m) {
            if (m.pinned !== 1) return false;
            if (!m.pinned_until) return true;
            var until = parseDate(m.pinned_until);
            return until.getTime() > Date.now();
        });
    }

    function renderPinBar() {
        var bar = $("pinBar");
        if (!bar) return;
        var pins = getActivePins();
        if (!pins.length) {
            bar.classList.remove("open");
            return;
        }
        if (pinBarIndex >= pins.length) pinBarIndex = 0;
        var m = pins[pinBarIndex];
        var text = (m.content || "").slice(0, 120);

        $("pinBarText").textContent = text || "(empty)";
        $("pinCount").textContent = pins.length > 1 ? (pinBarIndex + 1) + "/" + pins.length : "";

        var nav = $("pinBarNav");
        nav.style.display = pins.length > 1 ? "flex" : "none";

        bar.classList.add("open");
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
    }

    function scrollToPin(index) {
        var pins = getActivePins();
        if (!pins.length) return;
        if (typeof index === "number") pinBarIndex = Math.max(0, Math.min(index, pins.length - 1));
        var m = pins[pinBarIndex];

        var container = $("chatMessages");
        if (!container) return;
        var el = container.querySelector('.msg[data-id="' + m.id + '"]');
        if (!el) return;

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
        setTimeout(function () { el.classList.remove("flash"); }, 1400);

        renderPinBar();
    }


    function wirePinBar() {
        var bar = $("pinBar");
        if (!bar || bar.dataset.wired === "1") return;
        bar.dataset.wired = "1";

        bar.addEventListener("click", function (e) {
            if (e.target.closest(".pin-bar-btn")) return;
            scrollToPin();
        });
        $("pinPrev")?.addEventListener("click", function (e) {
            e.stopPropagation();
            var pins = getActivePins();
            if (!pins.length) return;
            pinBarIndex = (pinBarIndex - 1 + pins.length) % pins.length;
            scrollToPin(pinBarIndex);
        });
        $("pinNext")?.addEventListener("click", function (e) {
            e.stopPropagation();
            var pins = getActivePins();
            if (!pins.length) return;
            pinBarIndex = (pinBarIndex + 1) % pins.length;
            scrollToPin(pinBarIndex);
        });
    }


    // =========================================================
    // SELECTION MODE
    // =========================================================
    const selectedIds = new Set();
    let selectionMode = false;

    function enterSelectionMode(initialId) {
        selectionMode = true;
        selectedIds.clear();
        if (initialId) selectedIds.add(initialId);
        document.querySelectorAll('#chatMessages .msg').forEach(el => {
            el.classList.add("selection-mode");
        });
        updateSelectionUI();
        renderSelectionChecks();
    }

    function exitSelectionMode() {
        selectionMode = false;
        selectedIds.clear();
        document.querySelectorAll('#chatMessages .msg').forEach(el => {
            el.classList.remove("selection-mode", "selected");
        });
        document.querySelectorAll(".msg-check-badge").forEach(el => el.remove());
        var bar = $("selectionBar");
        if (bar) bar.classList.remove("open");
    }

    function toggleSelectMessage(msgId) {
        if (!selectionMode) return;
        var idNum = parseInt(msgId, 10);
        if (selectedIds.has(idNum)) selectedIds.delete(idNum);
        else selectedIds.add(idNum);
        updateSelectionUI();
        renderSelectionChecks();
    }

    function updateSelectionUI() {
        var bar = $("selectionBar");
        var cnt = $("selectionCount");
        if (!bar || !cnt) return;
        if (selectedIds.size === 0) {
            // Nothing selected  auto-exit
            exitSelectionMode();
            return;
        }
        bar.classList.add("open");
        cnt.textContent = selectedIds.size + " selected";

        // Star button: reflect state if ALL selected are starred
        var starBtn = bar.querySelector('[data-sel-act="star"]');
        if (starBtn) {
            var msgs = Array.from(selectedIds).map(id => activeMessages.find(m => m.id === id)).filter(Boolean);
            var allStarred = msgs.length > 0 && msgs.every(m => m.starred === 1);
            starBtn.classList.toggle("star-active", allStarred);
        }
    }

    function renderSelectionChecks() {
        document.querySelectorAll('#chatMessages .msg').forEach(el => {
            var id = parseInt(el.dataset.id, 10);
            var existing = el.querySelector(".msg-check-badge");
            if (selectedIds.has(id)) {
                el.classList.add("selected");
                if (!existing) {
                    var badge = document.createElement("div");
                    badge.className = "msg-check-badge";
                    badge.innerHTML = '<i data-lucide="check" class="icon"></i>';
                    el.appendChild(badge);
                }
            } else {
                el.classList.remove("selected");
                if (existing) existing.remove();
            }
        });
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
    }

    // Click handler — only active in selection mode (delegated)
    document.addEventListener("click", function (e) {
        if (!selectionMode) return;
        var msgEl = e.target.closest("#chatMessages .msg");
        if (!msgEl) return;
        e.stopPropagation();
        e.preventDefault();
        toggleSelectMessage(msgEl.dataset.id);
    }, true);

    // Esc exits
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && selectionMode) exitSelectionMode();
    });

    // Wire the bar once
    function wireSelectionBar() {
        var bar = $("selectionBar");
        if (!bar || bar.dataset.wired === "1") return;
        bar.dataset.wired = "1";

        $("selectionClose")?.addEventListener("click", exitSelectionMode);

        bar.querySelectorAll("[data-sel-act]").forEach(function (btn) {
            btn.addEventListener("click", async function (e) {
                e.stopPropagation();
                var act = btn.dataset.selAct;
                var ids = Array.from(selectedIds);
                if (!ids.length) return;

                if (act === "copy") {
                    var text = ids.map(function (id) {
                        var m = activeMessages.find(x => x.id === id);
                        return m ? (m.content || "") : "";
                    }).filter(Boolean).join("\n\n");
                    try { await navigator.clipboard.writeText(text); }
                    catch (err) {
                        var ta = document.createElement("textarea");
                        ta.value = text; document.body.appendChild(ta); ta.select();
                        try { document.execCommand("copy"); } catch (e2) {}
                        document.body.removeChild(ta);
                    }
                    showToast(ids.length + " message" + (ids.length > 1 ? "s" : "") + " copied");
                    exitSelectionMode();
                }
                else if (act === "star") {
                    var anyUnstarred = ids.some(function (id) {
                        var m = activeMessages.find(x => x.id === id);
                        return m && m.starred !== 1;
                    });
                    var newVal = anyUnstarred ? 1 : 0;
                    var ok = 0;
                    for (var id of ids) {
                        try {
                            await __timedFetch("/api/messages/conversations/" + activeConvId + "/messages/" + id, {
                                method: "PATCH",
                                body: JSON.stringify({ starred: newVal })
                            });
                            var m = activeMessages.find(x => x.id === id);
                            if (m) m.starred = newVal;
                            ok++;
                        } catch (err) {}
                    }
                    showToast(ok + " message" + (ok > 1 ? "s" : "") + (newVal ? " starred" : " unstarred"));
                    // Re-render thread, keep selection for continued action
                    var container = $("chatMessages");
                    if (container) {
                        container.innerHTML = renderMessageList(activeMessages);
                        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                    }
                    // Re-apply selection visuals
                    document.querySelectorAll('#chatMessages .msg').forEach(el => el.classList.add("selection-mode"));
                    renderSelectionChecks();
                    updateSelectionUI();
                }
                else if (act === "delete") {
                    var ok = await confirmDialog(
                        "Delete " + ids.length + " selected message" + (ids.length > 1 ? "s" : "") + "?",
                        { title: "Delete messages", confirmText: "Delete", danger: true }
                    );
                    if (!ok) return;
                    var deleted = 0;
                    for (var id of ids) {
                        var m = activeMessages.find(x => x.id === id);
                        var scope = (m && m.is_mine) ? "everyone" : "me";
                        try {
                            await __timedFetch("/api/messages/conversations/" + activeConvId + "/messages/" + id + "?scope=" + scope, { method: "DELETE" });
                            if (scope === "everyone") {
                                if (m) { m.deleted = 1; m.content = ""; }
                            } else {
                                activeMessages = activeMessages.filter(x => x.id !== id);
                            }
                            deleted++;
                        } catch (err) {}
                    }
                    showToast(deleted + " message" + (deleted > 1 ? "s" : "") + " deleted");
                    var container = $("chatMessages");
                    if (container) {
                        container.innerHTML = renderMessageList(activeMessages);
                        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
                        scrollToBottom();
                    }
                    exitSelectionMode();
                }
                else if (act === "forward") {
                    openForwardPanel(ids);
                }
                else if (act === "download") {
                    var lines = ids.map(function (id) {
                        var m = activeMessages.find(x => x.id === id);
                        if (!m) return "";
                        var who = m.is_mine ? "You" : (m.sender_type === "client" ? "Client" : "Bot");
                        var time = m.created_at ? formatTime(m.created_at) : "";
                        return "[" + time + "] " + who + ": " + (m.content || "");
                    }).filter(Boolean);
                    var blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement("a");
                    a.href = url;
                    a.download = "crevio-messages-" + Date.now() + ".txt";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    showToast("Downloaded");
                    exitSelectionMode();
                }
            });
        });
    }


    // =========================================================
    // FORWARD PANEL
    // =========================================================
    let forwardMessageIds = [];
    const forwardSelected = new Set();

    async function openForwardPanel(messageIds) {
        forwardMessageIds = Array.isArray(messageIds) ? messageIds.map(Number) : [Number(messageIds)].filter(Boolean);
        if (!forwardMessageIds.length) return;

        forwardSelected.clear();

        const overlay = $("forwardOverlay");
        const listEl  = $("forwardList");
        const searchEl= $("forwardSearch");
        const noteEl  = $("forwardNote");
        const sendBtn = $("forwardSend");
        const badge   = $("forwardBadge");
        if (!overlay || !listEl) { showToast("Forward panel missing", true); return; }

        noteEl.value = "";
        searchEl.value = "";
        badge.style.display = "none";
        sendBtn.disabled = true;

        overlay.classList.add("open");
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}

        async function loadList(query) {
            listEl.innerHTML = '<div class="forward-empty">Loading…</div>';
            try {
                const url = "/api/messages/conversations" + (query ? "?search=" + encodeURIComponent(query) : "");
                const res = await __timedFetch(url);
                const data = await res.json();
                const convs = (data.success && data.conversations) || [];

                const showBot = !query || "creviobot".indexOf(query.toLowerCase()) >= 0 || "bot".indexOf(query.toLowerCase()) >= 0;

                let html = "";
                if (showBot) {
                    const isSel = forwardSelected.has("bot");
                    html += '<div class="forward-section-label">Assistant</div>';
                    html += '<button class="forward-item ' + (isSel ? "selected" : "") + '" data-target="bot">'
                        + '<div class="forward-check"></div>'
                        + '<div class="forward-avatar bot-avatar-fwd"><i data-lucide="bot" class="icon"></i></div>'
                        + '<div class="forward-text">'
                        +   '<div class="forward-name">CrevioBot <span class="bot-tag">AI</span></div>'
                        +   '<div class="forward-preview">Analyze, rewrite, or reply with AI</div>'
                        + '</div>'
                        + '</button>';
                }

                html += '<div class="forward-section-label">Recent chats</div>';
                if (!convs.length) {
                    html += '<div class="forward-empty">No conversations found.</div>';
                } else {
                    html += convs.map(c => {
                        const name = c.client_name || "Unnamed";
                        const initial = name.charAt(0).toUpperCase();
                        const preview = (c.last_message || c.notes || "No messages yet").slice(0, 70);
                        const isSel = forwardSelected.has(c.id);
                        return '<button class="forward-item ' + (isSel ? "selected" : "") + '" data-target="' + c.id + '">'
                            + '<div class="forward-check"></div>'
                            + '<div class="forward-avatar">' + initial + '</div>'
                            + '<div class="forward-text">'
                            +   '<div class="forward-name">' + escapeHtml(name) + '</div>'
                            +   '<div class="forward-preview">' + (escapeHtml(preview) || "No messages yet") + '</div>'
                            + '</div>'
                            + '</button>';
                    }).join("");
                }

                listEl.innerHTML = html;
                try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}

                listEl.querySelectorAll(".forward-item").forEach(item => {
                    item.addEventListener("click", () => {
                        const raw = item.dataset.target;
                        const key = raw === "bot" ? "bot" : parseInt(raw, 10);
                        if (forwardSelected.has(key)) forwardSelected.delete(key);
                        else forwardSelected.add(key);
                        item.classList.toggle("selected");
                        updateForwardSend();
                    });
                });
            } catch (err) {
                listEl.innerHTML = '<div class="forward-empty">Could not load.</div>';
            }
        }

        function updateForwardSend() {
            const n = forwardSelected.size;
            sendBtn.disabled = n === 0;
            if (n > 0) {
                badge.textContent = n;
                badge.style.display = "block";
            } else {
                badge.style.display = "none";
            }
        }

        async function doSend() {
            if (!forwardSelected.size) return;
            const note = noteEl.value.trim();
            const convIds = [];
            let sendToBot = false;
            forwardSelected.forEach(v => {
                if (v === "bot") sendToBot = true;
                else convIds.push(v);
            });

            sendBtn.disabled = true;
            try {
                let sent = 0;
                if (convIds.length) {
                    const res = await __timedFetch("/api/messages/forward", {
                        method: "POST",
                        body: JSON.stringify({
                            message_ids: forwardMessageIds,
                            conversation_ids: convIds,
                            note: note
                        })
                    });
                    const data = await res.json();
                    if (data.success) sent += data.sent;
                    else showToast(data.message || "Forward failed", true);
                }

                if (sendToBot) {
                    const msgs = forwardMessageIds.map(id => activeMessages.find(m => m.id === id)).filter(Boolean);
                    const payload = {
                        type: "forwarded_messages",
                        messages: msgs.map(m => ({
                            content: m.content || "",
                            sender_type: m.sender_type || "unknown",
                            created_at: m.created_at || ""
                        })),
                        note: note,
                        conversation_id: activeConvId,
                        ts: Date.now()
                    };
                    try { localStorage.setItem("crevio_bot_context", JSON.stringify(payload)); } catch (e) {}
                    setTimeout(() => window.open("/dashboard/pages/bot.html?from=messages", "_blank"), 100);
                }

                showToast(sent + " message" + (sent !== 1 ? "s" : "") + " forwarded");
                closeForwardPanel();
            } catch (err) {
                showToast("Forward failed: " + err.message, true);
                sendBtn.disabled = false;
            }
        }

        function closeForwardPanel() {
            overlay.classList.remove("open");
            forwardSelected.clear();
            forwardMessageIds = [];
        }

        if (!overlay.dataset.wired) {
            overlay.dataset.wired = "1";
            $("forwardClose").addEventListener("click", closeForwardPanel);
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) closeForwardPanel();
            });
            $("forwardContacts")?.addEventListener("click", () => showToast("Contacts coming soon"));

            let deb;
            searchEl.addEventListener("input", function () {
                clearTimeout(deb);
                const q = this.value;
                deb = setTimeout(() => loadList(q), 250);
            });

            sendBtn.addEventListener("click", doSend);
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && overlay.classList.contains("open")) closeForwardPanel();
            });
        }

        await loadList("");
    }


    // =========================================================
    // EDIT MESSAGE — Pro/Business + 10-minute window
    // =========================================================
    const EDIT_WINDOW_MS = 10 * 60 * 1000;

    function canEditMessage(m) {
        if (!m) return false;
        if (!m.is_mine) return false;
        if (m.deleted === 1) return false;
        if (currentPlan !== "pro" && currentPlan !== "business") return false;
        const sentAt = parseDate(m.created_at).getTime();
        if (isNaN(sentAt)) return false;
        return (Date.now() - sentAt) < EDIT_WINDOW_MS;
    }

    

    function openEditDialog(msgId) {
        const msg = activeMessages.find(m => m.id === msgId);
        if (!msg) { showToast("Message not found", true); return; }

        if (!canEditMessage(msg)) {
            showToast("This message can no longer be edited", true);
            return;
        }

        const overlay  = $("editOverlay");
        const input    = $("editInput");
        const cancel   = $("editCancel");
        const saveBtn  = $("editSave");
        const deleteBtn= $("editDelete");
        const timerEl  = $("editTimer");
        const trimBtn  = $("editTrim");
        const fixBtn   = $("editFix");
        const botBtn   = $("editBot");

        if (!overlay || !input || !cancel || !saveBtn) {
            showToast("Edit dialog missing — check console", true);
            console.error("[Edit] Missing elements:", { overlay, input, cancel, saveBtn, deleteBtn });
            return;
        }

        const original = msg.content || "";
        input.value = original;
        input.disabled = false;
        saveBtn.disabled = false;

        // Timer countdown
        const sentAt = parseDate(msg.created_at).getTime();
        const expiresAt = sentAt + EDIT_WINDOW_MS;
        let timerInterval = null;
        function updateTimer() {
            const remain = expiresAt - Date.now();
            if (remain <= 0) {
                timerEl.textContent = "Expired";
                timerEl.className = "edit-timer warn";
                saveBtn.disabled = true;
                input.disabled = true;
                if (timerInterval) clearInterval(timerInterval);
                return;
            }
            const mins = Math.floor(remain / 60000);
            const secs = Math.floor((remain % 60000) / 1000);
            timerEl.textContent = mins + ":" + String(secs).padStart(2, "0") + " left";
            timerEl.className = "edit-timer" + (remain < 60000 ? " warn" : "");
        }
        updateTimer();
        timerInterval = setInterval(updateTimer, 1000);

        overlay.classList.add("open");
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
        setTimeout(() => { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {} }, 60);

        const cleanup = () => {
            if (timerInterval) clearInterval(timerInterval);
            overlay.classList.remove("open");
            cancel.removeEventListener("click", onCancel);
            saveBtn.removeEventListener("click", onSave);
            deleteBtn?.removeEventListener("click", onDelete);
            trimBtn?.removeEventListener("click", onTrim);
            fixBtn?.removeEventListener("click", onFix);
            botBtn?.removeEventListener("click", onBot);
            overlay.removeEventListener("click", onOverlay);
            document.removeEventListener("keydown", onKey);
        };
        const close = () => cleanup();

        const onCancel  = () => close();
        const onOverlay = (e) => { if (e.target === overlay) close(); };
        const onKey     = (e) => {
            if (e.key === "Escape") close();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(); }
        };

        const onTrim = () => {
            input.value = input.value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
            showToast("Whitespace cleaned");
        };

        const onFix = () => {
            let t = input.value;
            // capitalise first letter of sentences
            t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
            // ensure ending punctuation
            if (t && !/[.!?]$/.test(t.trim())) t = t.trim() + ".";
            input.value = t;
            showToast("Basic fixes applied");
        };

        const onBot = () => {
            const content = input.value.trim() || original;
            const conv = conversations.find(c => c.id === activeConvId) || {};
            const payload = {
                type: "rewrite_message",
                message: content,
                message_id: msgId,
                conversation_id: activeConvId,
                client_name: conv.client_name || "",
                client_email: conv.client_email || "",
                service_title: conv.context_service_title || "",
                project_title: conv.context_project_title || "",
                ts: Date.now()
            };
            try { localStorage.setItem("crevio_bot_context", JSON.stringify(payload)); } catch (e) {}
            window.open("/dashboard/pages/bot.html?from=edit", "_blank");
            showToast("CrevioBot opened — copy the rewritten text back here");
        };

        const onSave = async () => {
            const newContent = input.value.trim();
            if (!newContent) { showToast("Message cannot be empty", true); return; }
            if (newContent === original) { close(); return; }
            saveBtn.disabled = true;
            try {
                const res = await __timedFetch(
                    "/api/messages/conversations/" + activeConvId + "/messages/" + msgId,
                    { method: "PATCH", body: JSON.stringify({ content: newContent }) }
                );
                const data = await res.json();
                if (!data.success) throw new Error(data.message || "Edit failed");
                msg.content = newContent;
                msg.edited = 1;
                refreshMessageBubble(msgId);
                showToast("Message edited");
                close();
            } catch (e) {
                showToast(e.message || "Could not edit", true);
                saveBtn.disabled = false;
            }
        };

        const onDelete = async () => {
            if (!await confirmDialog("Delete this message?", { title: "Delete message", confirmText: "Delete", danger: true })) return;
            try {
                await __timedFetch(
                    "/api/messages/conversations/" + activeConvId + "/messages/" + msgId + "?scope=everyone",
                    { method: "DELETE" }
                );
                msg.deleted = 1;
                msg.content = "";
                refreshMessageBubble(msgId);
                showToast("Message deleted");
                close();
            } catch (e) {
                showToast("Could not delete", true);
            }
        };

        cancel.addEventListener("click", onCancel);
        saveBtn.addEventListener("click", onSave);
        deleteBtn?.addEventListener("click", onDelete);
        trimBtn?.addEventListener("click", onTrim);
        fixBtn?.addEventListener("click", onFix);
        botBtn?.addEventListener("click", onBot);
        overlay.addEventListener("click", onOverlay);
        document.addEventListener("keydown", onKey);
    }

    // Re-render a single message bubble + its reactions row
    function refreshMessageBubble(msgId) {
        const container = $("chatMessages");
        if (!container) return;
        const el = container.querySelector('.msg[data-id="' + msgId + '"]');
        if (!el) return;
        const m = activeMessages.find(x => x.id === msgId);
        if (!m) return;
        const next = el.nextElementSibling;
        if (next && next.classList.contains("msg-reactions-row")) next.remove();
        const html = renderMessage(m) + (renderReactionsRow(m) || "");
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        el.replaceWith(...Array.from(tmp.children));
        try { if (typeof lucide !== "undefined") lucide.createIcons(); } catch (e) {}
    }


    function bubbleToText(bubble) {
        var clone = bubble.cloneNode(true);
        clone.querySelectorAll(".msg-time, .msg-meta, .msg-edited, .msg-check, .msg-check-badge, .msg-toolbar, .msg-reactions-row, .msg-reaction-pill, .reply-preview").forEach(function (el) { el.remove(); });
        return (clone.innerText || clone.textContent || "").trim();
    }

    function scrollToBottom() { const el = $("chatMessages"); if (el) el.scrollTop = el.scrollHeight; }
    function parseDate(str) {
        if (!str) return new Date();
        try {
            const iso = String(str).includes("T") ? String(str) : String(str).replace(" ", "T");
            const withZ = iso.endsWith("Z") ? iso : iso + "Z";
            const d = new Date(withZ);
            return isNaN(d.getTime()) ? new Date() : d;
        } catch { return new Date(); }
    }
    function formatTime(str) {
        if (!str) return "";
        const d = parseDate(str);
        return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    }
    function dayLabel(date) {
        const now = new Date();
        const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diff = Math.round((today - target) / 86400000);
        if (diff === 0) return "Today";
        if (diff === 1) return "Yesterday";
        if (diff < 7)   return date.toLocaleDateString("en-US", { weekday: "long" });
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
    }
    function formatRelativeTime(str) {
        if (!str) return "";
        const d = parseDate(str);
        const diff = Date.now() - d.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1)  return "now";
        if (mins < 60) return mins + "m";
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)  return hrs + "h";
        const days = Math.floor(hrs / 24);
        if (days < 7)  return days + "d";
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    function escapeHtml(str) {
        return String(str == null ? "" : str).replace(/[&<>"']/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[s]));
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
    async function loadPlanLimit() {
        try {
            const res = await __timedFetch("/api/messages/plan-limit");
            const d = await res.json();
            if (d.success) {
                planUnlimited = !!d.unlimited;
                currentPlanName = d.plan || "free";
                planLimit = d.unlimited ? Infinity : d.limit;
                currentPlan = d.plan || "free";
            }
        } catch (e) { console.error("[Messages] plan limit fetch failed", e); }
    }
    layoutFilters();
    loadPlanLimit();
    loadStats();
    loadConversations();
    console.log("[Messages] init complete");
});