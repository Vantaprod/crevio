// =========================================================
// CREVIO -- VISITOR CHAT PAGE (v2)
// File: dashboard/js/visitor-chat.js
// =========================================================
(function () {
    if (window.__crevioVisitorChat) return;
    var root = document.getElementById("vcRoot");
    if (!root) return;
    window.__crevioVisitorChat = true;

    var creatorId     = root.dataset.creatorId;
    var creatorSlug   = root.dataset.creatorSlug || "";
    var creatorName   = root.dataset.creatorName || "them";
    var creatorInitial= root.dataset.creatorInitial || "?";
    var creatorAvatar = root.dataset.creatorAvatar || "";
    var storageKey    = "crevio_contact_" + creatorId;

    var msgList  = document.getElementById("vcMessages");
    var emptyEl  = document.getElementById("vcEmpty");
    var inputBar = document.getElementById("vcInputBar");
    var input    = document.getElementById("vcInput");
    var sendBtn  = document.getElementById("vcSend");
    var statusEl = document.getElementById("vcStatus");
    var footerEl = document.querySelector(".vc-footer");

    var state = { convId: null, email: null, lastCount: -1, timer: null, sending: false, dead: false };

    function esc(s) {
        return String(s || "").replace(/[&<>"']/g, function (c) {
            return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
        });
    }

    function loadState() {
        var raw = null;
        try { raw = localStorage.getItem(storageKey); } catch (e) {}
        if (!raw) {
            try { raw = sessionStorage.getItem(storageKey); } catch (e) {}
            if (raw) { try { localStorage.setItem(storageKey, raw); } catch (e) {} }
        }
        if (!raw) return false;
        try {
            var p = JSON.parse(raw);
            if (!p || !p.convId || !p.email) return false;
            if (p.savedAt && (Date.now() - p.savedAt) > (30 * 24 * 60 * 60 * 1000)) {
                try { localStorage.removeItem(storageKey); } catch (e) {}
                try { sessionStorage.removeItem(storageKey); } catch (e) {}
                return false;
            }
            state.convId = p.convId;
            state.email = p.email;
            return true;
        } catch (e) { return false; }
    }

    function hideChrome() {
        if (msgList)  msgList.style.display  = "none";
        if (inputBar) inputBar.style.display = "none";
        if (footerEl) footerEl.style.display = "none";
    }

    function showStatus(title, body, linkHref, linkLabel, actionId) {
        hideChrome();
        if (!statusEl) return;
        statusEl.hidden = false;
        statusEl.innerHTML =
            "<h2>" + esc(title) + "</h2><p>" + body +
            (linkHref ? '<br><br><a href="' + esc(linkHref) + '">' + esc(linkLabel) + "</a>" : "") +
            (actionId ? '<br><br><button type="button" id="' + actionId + '" style="background:#2563EB;color:#fff;border:none;padding:10px 18px;border-radius:10px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer">Start a new conversation</button>' : "") +
            "</p>";
        if (actionId) {
        var btn = document.getElementById(actionId);
        if (btn) btn.addEventListener("click", function () {
            try { localStorage.removeItem(storageKey); } catch (e) {}
            try { sessionStorage.removeItem(storageKey); } catch (e) {}
            state.convId = null;
            state.email = null;
            state.dead = false;
            openNewConversationForm();
        });
    }
    }

    function openNewConversationForm() {
            if (!msgList) return;
            if (statusEl) statusEl.hidden = true;
            if (msgList) msgList.style.display = "";
            if (inputBar) inputBar.style.display = "none";
    
            msgList.innerHTML = [
                '<div class="vc-new-wrap">',
                    '<div class="vc-new-form">',
                        '<h2>Start a new conversation</h2>',
                        '<p class="vc-new-lead">Send ' + esc(creatorName) + ' a fresh message. Your previous chat will remain in their inbox.</p>',
                        '<input type="text" id="vcNewName" placeholder="Your name" maxlength="120" autocomplete="name">',
                        '<input type="email" id="vcNewEmail" placeholder="you@example.com" maxlength="200" autocomplete="email">',
                        '<textarea id="vcNewMsg" placeholder="What would you like to say?" maxlength="2000"></textarea>',
                        '<div class="vc-new-actions">',
                            '<button type="button" class="vc-new-cancel" id="vcNewCancel">Cancel</button>',
                            '<button type="button" class="vc-new-send" id="vcNewSend">Send message</button>',
                        '</div>',
                        '<div class="vc-new-err" id="vcNewErr" hidden></div>',
                    '</div>',
                '</div>'
            ].join("");
    
            var nameEl  = document.getElementById("vcNewName");
            var emailEl = document.getElementById("vcNewEmail");
            var msgEl   = document.getElementById("vcNewMsg");
            var sendEl  = document.getElementById("vcNewSend");
            var cnlEl   = document.getElementById("vcNewCancel");
            var errEl   = document.getElementById("vcNewErr");
    
            if (state.email && emailEl) emailEl.value = state.email;
    
            function showErr(msg) {
                if (!errEl) return;
                errEl.hidden = false;
                errEl.textContent = msg;
            }
    
            if (cnlEl) cnlEl.addEventListener("click", function () {
                showStatus(
                    "This chat is no longer available",
                    "The conversation may have been cleared.",
                    "/p/" + encodeURIComponent(creatorSlug),
                    "Back to portfolio \u2192",
                    "vcStartOver"
                );
            });
    
            if (sendEl) sendEl.addEventListener("click", function () {
                var n = (nameEl.value || "").trim();
                var e = (emailEl.value || "").trim();
                var m = (msgEl.value || "").trim();
                if (!n || !e || !m) { showErr("Please fill in all three fields."); return; }
                sendEl.disabled = true;
                sendEl.textContent = "Sending...";
                if (errEl) errEl.hidden = true;
    
                fetch("/api/public/contact/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        creator_id: parseInt(creatorId, 10),
                        client_name: n,
                        client_email: e,
                        message: m,
                        source: "portfolio"
                    })
                })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data.success) throw new Error(data.message || "Send failed");
                    state.convId  = data.conversation_id;
                    state.email   = e;
                    state.lastCount = -1;
                    state.dead    = false;
                    try {
                        localStorage.setItem(storageKey, JSON.stringify({
                            v: 2, convId: state.convId, email: state.email, savedAt: Date.now()
                        }));
                    } catch (ex) {}
    
                    // Bring the chat chrome back and load the new thread
                    if (inputBar) inputBar.style.display = "";
                    if (statusEl) statusEl.hidden = true;
                    msgList.innerHTML = "";
                    if (emptyEl) msgList.appendChild(emptyEl);
                    fetchMsgs();
                    if (state.timer) clearInterval(state.timer);
                    state.timer = setInterval(fetchMsgs, 4000);
                    if (input) setTimeout(function () { input.focus(); }, 80);
                })
                .catch(function (err) {
                    sendEl.disabled = false;
                    sendEl.textContent = "Send message";
                    showErr(err.message);
                });
            });
    
            if (nameEl) setTimeout(function () { nameEl.focus(); }, 60);
        }
    
        function timeLabel(iso) {
        if (!iso) return "";
        var d;
        try { d = new Date(iso); } catch (e) { return ""; }
        if (!d || isNaN(d.getTime())) return "";
        var now = new Date();
        var sameDay = d.toDateString() === now.toDateString();
        var yd = new Date(now); yd.setDate(yd.getDate() - 1);
        var isYd = d.toDateString() === yd.toDateString();
        var hh = d.getHours(), mm = d.getMinutes();
        var ampm = hh >= 12 ? "PM" : "AM";
        var h12 = hh % 12; if (h12 === 0) h12 = 12;
        var t = h12 + ":" + (mm < 10 ? "0" : "") + mm + " " + ampm;
        if (sameDay) return t;
        if (isYd) return "Yesterday " + t;
        var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return months[d.getMonth()] + " " + d.getDate() + ", " + t;
    }

    function nearBottom() {
        if (!msgList) return true;
        return (msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight) < 120;
    }
    function scrollToBottom() { if (msgList) msgList.scrollTop = msgList.scrollHeight; }

    function buildBubble(m, opts) {
        opts = opts || {};
        var isClient = m.sender_type === "client";
        var row = document.createElement("div");
        row.className = "vc-row " + (isClient ? "vc-row-out" : "vc-row-in") + (opts.grouped ? " grouped" : "");

        if (!isClient) {
            if (opts.showAvatar) {
                if (creatorAvatar) {
                    var img = document.createElement("img");
                    img.className = "vc-mini-avatar";
                    img.src = creatorAvatar;
                    img.alt = "";
                    row.appendChild(img);
                } else {
                    var av = document.createElement("div");
                    av.className = "vc-mini-avatar";
                    av.textContent = creatorInitial;
                    row.appendChild(av);
                }
            } else {
                var sp = document.createElement("div");
                sp.className = "vc-mini-avatar vc-avatar-spacer";
                row.appendChild(sp);
            }
        }

        var wrap = document.createElement("div");
        wrap.className = "vc-bubble-wrap";

        var bubble = document.createElement("div");
        bubble.className = "vc-bubble";
        if (opts.sending) bubble.classList.add("sending");
        if (opts.failed)  bubble.classList.add("failed");
        bubble.textContent = m.content || "";
        wrap.appendChild(bubble);

        if (!opts.sending && !opts.failed) {
            var meta = document.createElement("div");
            meta.className = "vc-bubble-meta";
            meta.textContent = timeLabel(m.created_at);
            wrap.appendChild(meta);
        }

        row.appendChild(wrap);
        return row;
    }

    function renderAll(msgs) {
        msgList.innerHTML = "";
        if (!msgs.length) {
            if (emptyEl) msgList.appendChild(emptyEl);
            return;
        }
        var prev = null;
        for (var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            var grouped = prev && prev.sender_type === m.sender_type;
            var showAvatar = !grouped && m.sender_type !== "client";
            msgList.appendChild(buildBubble(m, { grouped: grouped, showAvatar: showAvatar }));
            prev = m;
        }
    }

    function markDead() {
        state.dead = true;
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
        showStatus(
            "This chat is no longer available",
            "The conversation may have been cleared. Start a new one from the portfolio.",
            "/p/" + encodeURIComponent(creatorSlug),
            "Back to portfolio \u2192",
            "vcStartOver"
        );
    }

    function fetchMsgs(cb) {
        if (!state.convId || !state.email || state.dead) { if (cb) cb(); return; }
        fetch("/api/public/contact/" + state.convId + "?email=" + encodeURIComponent(state.email), { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { markDead(); return; }
                var msgs = data.messages || [];
                if (state.lastCount === -1 || msgs.length !== state.lastCount) {
                    var stick = nearBottom();
                    renderAll(msgs);
                    state.lastCount = msgs.length;
                    if (stick) scrollToBottom();
                }
                if (cb) cb();
            })
            .catch(function () { if (cb) cb(); });
    }

    function autoGrow() {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }

    function updateSendState() {
        if (!sendBtn) return;
        var empty = !(input.value || "").trim();
        sendBtn.disabled = empty || state.sending || state.dead;
    }

    function sendMsg() {
        if (state.sending || state.dead) return;
        var text = (input.value || "").trim();
        if (!text) return;
        state.sending = true;
        sendBtn.disabled = true;

        var stick = nearBottom();
        var temp = buildBubble({ sender_type: "client", content: text }, { sending: true });
        if (emptyEl && emptyEl.parentNode === msgList) msgList.removeChild(emptyEl);
        msgList.appendChild(temp);
        if (stick) scrollToBottom();

        input.value = "";
        autoGrow();

        fetch("/api/public/contact/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversation_id: state.convId, email: state.email, message: text })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) throw new Error(data.message || "Send failed");
            state.sending = false;
            state.lastCount = -1;
            fetchMsgs();
        })
        .catch(function (err) {
            state.sending = false;
            var b = temp.querySelector(".vc-bubble");
            if (b) { b.classList.remove("sending"); b.classList.add("failed"); }
            alert("Could not send: " + err.message);
            if (!input.value) input.value = text;
            autoGrow();
        })
        .then(function () {
            state.sending = false;
            updateSendState();
            if (input) input.focus();
        });
    }

    if (!loadState()) {
        showStatus(
            "Chat session not found",
            "Start a conversation with " + esc(creatorName) + " below.",
            "/p/" + encodeURIComponent(creatorSlug),
            "Back to portfolio \u2192",
            "vcStartOver"
        );
        return;
    }

    fetchMsgs();
    state.timer = setInterval(fetchMsgs, 4000);

    if (input) {
        input.addEventListener("input", function () { autoGrow(); updateSendState(); });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMsg();
            }
        });
        setTimeout(function () { input.focus(); autoGrow(); updateSendState(); }, 80);
    }
    if (sendBtn) sendBtn.addEventListener("click", sendMsg);

    window.addEventListener("beforeunload", function () {
        if (state.timer) clearInterval(state.timer);
    });
})();
