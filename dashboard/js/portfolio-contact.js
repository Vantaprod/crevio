// =========================================================
// CREVIO -- PORTFOLIO CONTACT FORM
// File: dashboard/js/portfolio-contact.js
// Persistent visitor sessions (localStorage + 30-day expiry).
// Visitors can close the tab and come back later without losing
// their conversation. Old sessionStorage entries auto-migrate.
// =========================================================
(function () {
    if (window.__crevioContactInstalled) return;
    var form = document.getElementById("crevioContactForm");
    if (!form) return;
    window.__crevioContactInstalled = true;

    var creatorId = form.dataset.creatorId;
    var whatsappLink = form.dataset.whatsapp || "";
    var storageKey = "crevio_contact_" + creatorId;
    var STORAGE_VERSION = 2;
    var EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

    var afterEl          = document.getElementById("crevioContactAfter");
    var continueCrevio   = document.getElementById("crevioContinueChat");
    var continueWhatsapp = document.getElementById("crevioContinueWhatsapp");
    var chatWrap         = document.getElementById("crevioContactChat");
    var chatMessages     = document.getElementById("crevioChatMessages");
    var chatInput        = document.getElementById("crevioChatInput");
    var chatSend         = document.getElementById("crevioChatSend");

    var state = { convId: null, email: null, name: null, pollTimer: null, lastCount: 0 };

    // ---------- Persistent storage ----------
    function readSession() {
        var raw = null;
        try { raw = localStorage.getItem(storageKey); } catch (e) {}
        if (!raw) {
            try { raw = sessionStorage.getItem(storageKey); } catch (e) {}
            if (raw) {
                try { localStorage.setItem(storageKey, raw); } catch (e) {}
                try { sessionStorage.removeItem(storageKey); } catch (e) {}
            }
        }
        if (!raw) return null;
        try {
            var p = JSON.parse(raw);
            if (!p || !p.convId || !p.email) return null;
            if (p.savedAt && (Date.now() - p.savedAt) > EXPIRY_MS) {
                clearSession();
                return null;
            }
            return p;
        } catch (e) { return null; }
    }

    function saveSession() {
        var payload = JSON.stringify({
            v: STORAGE_VERSION,
            convId: state.convId,
            email: state.email,
            name: state.name,
            savedAt: Date.now()
        });
        try { localStorage.setItem(storageKey, payload); }
        catch (e) { try { sessionStorage.setItem(storageKey, payload); } catch (e) {} }
    }

    function clearSession() {
        try { localStorage.removeItem(storageKey); } catch (e) {}
        try { sessionStorage.removeItem(storageKey); } catch (e) {}
    }

    // ---------- UI helpers ----------
    function showAfter(titleText) {
        form.style.display = "none";
        if (afterEl) afterEl.hidden = false;
        var titleEl = afterEl && afterEl.querySelector("h3");
        if (titleText && titleEl) titleEl.textContent = titleText;
    }

    function showForm() {
        form.style.display = "";
        if (afterEl) afterEl.hidden = true;
    }

    function injectNotYouLink() {
        if (!afterEl || afterEl.querySelector(".crevio-not-you")) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "crevio-not-you";
        btn.textContent = "Not you? Start a new conversation";
        btn.style.cssText = "display:block;margin:16px auto 0;background:none;border:none;color:#94A3B8;font-size:12px;text-decoration:underline;cursor:pointer;font-family:inherit;padding:0;";
        btn.addEventListener("click", function () {
            clearSession();
            state.convId = null;
            state.email = null;
            var n = document.getElementById("crevioContactName");
            var em = document.getElementById("crevioContactEmail");
            var m = document.getElementById("crevioContactMessage");
            if (n) n.value = "";
            if (em) em.value = "";
            if (m) m.value = "";
            showForm();
            if (n) n.focus();
        });
        afterEl.appendChild(btn);
    }

    // ---------- Inline chat (fallback when no slug in URL) ----------
    function renderMessage(m) {
        var div = document.createElement("div");
        var isClient = m.sender_type === "client";
        div.className = "crevio-chat-msg " + (isClient ? "from-client" : "from-creator");
        div.textContent = m.content || "";
        if (chatMessages) chatMessages.appendChild(div);
    }

    function fetchMessages(cb) {
        if (!state.convId || !state.email) { if (cb) cb(); return; }
        fetch("/api/public/contact/" + state.convId + "?email=" + encodeURIComponent(state.email))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success || !chatMessages) { if (cb) cb(); return; }
                var msgs = data.messages || [];
                if (msgs.length > state.lastCount) {
                    chatMessages.innerHTML = "";
                    msgs.forEach(renderMessage);
                    state.lastCount = msgs.length;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
                if (cb) cb();
            })
            .catch(function () { if (cb) cb(); });
    }

    function startPolling() {
        if (state.pollTimer) return;
        state.pollTimer = setInterval(fetchMessages, 5000);
    }
    function stopPolling() {
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    }

    function openChat() {
        if (!chatWrap) return;
        chatWrap.hidden = false;
        fetchMessages();
        startPolling();
        if (chatInput) setTimeout(function () { chatInput.focus(); }, 60);
    }

    function buildWhatsappUrl() {
        if (!whatsappLink) return "#";
        var firstClientMsg = chatMessages && chatMessages.querySelector(".crevio-chat-msg.from-client");
        var summary = firstClientMsg ? (firstClientMsg.textContent || "").slice(0, 200) : "";
        var text = "Hi \u2014 I sent you a message on your portfolio." +
            (summary ? " Recap: " + summary : "");
        return whatsappLink + "?text=" + encodeURIComponent(text);
    }

    // ---------- Submit ----------
    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name    = (document.getElementById("crevioContactName").value || "").trim();
        var email   = (document.getElementById("crevioContactEmail").value || "").trim();
        var message = (document.getElementById("crevioContactMessage").value || "").trim();
        if (!name || !email || !message) return;

        var submitBtn = form.querySelector('button[type="submit"]');
        var original = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";

        fetch("/api/public/contact/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                creator_id: parseInt(creatorId, 10),
                client_name: name,
                client_email: email,
                message: message,
                source: "portfolio"
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) throw new Error(data.message || "Failed to send");
            state.convId = data.conversation_id;
            state.email = email;
            state.name = name;
            state.lastCount = 1;
            saveSession();
            showAfter("Message sent \u2713");
            injectNotYouLink();
            if (continueWhatsapp) continueWhatsapp.href = buildWhatsappUrl();
        })
        .catch(function (err) {
            alert("Could not send your message: " + err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = original;
        });
    });

    // ---------- Continue buttons ----------
    if (continueCrevio) {
        continueCrevio.addEventListener("click", function () {
            // Phase 29: navigate to standalone chat page
            var slugMatch = location.pathname.match(/^\/p\/([^\/]+)/);
            if (slugMatch) {
                continueCrevio.disabled = true;
                location.href = "/p/" + encodeURIComponent(slugMatch[1]) + "/chat";
            } else {
                openChat();
                continueCrevio.disabled = true;
            }
        });
    }

    if (continueWhatsapp) {
        continueWhatsapp.addEventListener("click", function () {
            continueWhatsapp.href = buildWhatsappUrl();
        });
    }

    if (chatSend) {
        chatSend.addEventListener("click", function () {
            var text = (chatInput.value || "").trim();
            if (!text) return;
            chatSend.disabled = true;
            fetch("/api/public/contact/message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversation_id: state.convId, email: state.email, message: text })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) throw new Error(data.message || "Send failed");
                chatInput.value = "";
                fetchMessages();
            })
            .catch(function (err) { alert("Send failed: " + err.message); })
            .finally(function () { chatSend.disabled = false; if (chatInput) chatInput.focus(); });
        });
    }

    if (chatInput) {
        chatInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend.click(); }
        });
    }

    // ---------- Restore on load ----------
    var persisted = readSession();
    if (persisted) {
        state.convId = persisted.convId;
        state.email = persisted.email;
        state.name = persisted.name || null;
        showAfter("You have an open conversation");
        injectNotYouLink();
        if (continueWhatsapp) continueWhatsapp.href = buildWhatsappUrl();
        // Validate the pointer in the background. If the conversation
        // was cleared, quietly fall back to the form.
        fetch("/api/public/contact/" + state.convId + "?email=" + encodeURIComponent(state.email))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    clearSession();
                    state.convId = null;
                    state.email = null;
                    showForm();
                }
            })
            .catch(function () { /* keep the optimistic UI */ });
    }

    window.addEventListener("beforeunload", stopPolling);
})();
