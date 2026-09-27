// =========================================================
// CREVIO — PORTFOLIO CONTACT FORM + VISITOR CHAT
// File: dashboard/js/portfolio-contact.js
// =========================================================
// Runs on every rendered public portfolio page that has a
// contact form. No auth — visitors are anonymous.
// =========================================================
(function () {
    if (window.__crevioContactInstalled) return;
    var form = document.getElementById("crevioContactForm");
    if (!form) return;
    window.__crevioContactInstalled = true;

    var creatorId = form.dataset.creatorId;
    var whatsappLink = form.dataset.whatsapp || "";
    var storageKey = "crevio_contact_" + creatorId;

    var afterEl         = document.getElementById("crevioContactAfter");
    var continueCrevio  = document.getElementById("crevioContinueChat");
    var continueWhatsapp= document.getElementById("crevioContinueWhatsapp");
    var chatWrap        = document.getElementById("crevioContactChat");
    var chatMessages    = document.getElementById("crevioChatMessages");
    var chatInput       = document.getElementById("crevioChatInput");
    var chatSend        = document.getElementById("crevioChatSend");

    var state = { convId: null, email: null, pollTimer: null, lastCount: 0 };

    function saveState() {
        try {
            sessionStorage.setItem(storageKey, JSON.stringify({ convId: state.convId, email: state.email }));
        } catch (e) {}
    }
    function loadState() {
        try {
            var raw = sessionStorage.getItem(storageKey);
            if (!raw) return false;
            var parsed = JSON.parse(raw);
            if (parsed && parsed.convId && parsed.email) {
                state.convId = parsed.convId;
                state.email = parsed.email;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function showAfter(titleText) {
        form.style.display = "none";
        if (afterEl) afterEl.hidden = false;
        var titleEl = afterEl && afterEl.querySelector("h3");
        if (titleText && titleEl) titleEl.textContent = titleText;
    }

    function renderMessage(m) {
        var div = document.createElement("div");
        var isClient = m.sender_type === "client";
        div.className = "crevio-chat-msg " + (isClient ? "from-client" : "from-creator");
        div.textContent = m.content || "";
        chatMessages.appendChild(div);
    }

    function fetchMessages(cb) {
        if (!state.convId || !state.email) { if (cb) cb(); return; }
        fetch("/api/public/contact/" + state.convId + "?email=" + encodeURIComponent(state.email))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
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
        chatWrap.hidden = false;
        fetchMessages();
        startPolling();
        if (chatInput) setTimeout(function () { chatInput.focus(); }, 60);
    }

    function buildWhatsappUrl() {
        if (!whatsappLink) return "#";
        var firstClientMsg = chatMessages.querySelector(".crevio-chat-msg.from-client");
        var summary = firstClientMsg ? (firstClientMsg.textContent || "").slice(0, 200) : "";
        var text = "Hi — I sent you a message on your portfolio." +
            (summary ? " Recap: " + summary : "");
        return whatsappLink + "?text=" + encodeURIComponent(text);
    }

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
            state.lastCount = 1;
            saveState();
            showAfter("Message sent \u2713");
            if (continueWhatsapp) continueWhatsapp.href = buildWhatsappUrl();
        })
        .catch(function (err) {
            alert("Could not send your message: " + err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = original;
        });
    });

    if (continueCrevio) {
        continueCrevio.addEventListener("click", function () {
            // Phase 29: navigate to standalone chat page
            var slugMatch = location.pathname.match(/^\/p\/([^\/]+)/);
            if (slugMatch) {
                continueCrevio.disabled = true;
                location.href = "/p/" + encodeURIComponent(slugMatch[1]) + "/chat";
            } else {
                // Fallback: no slug in URL -> keep the inline panel
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

    if (loadState()) {
        showAfter("Message sent \u2713");
        if (continueWhatsapp) continueWhatsapp.href = buildWhatsappUrl();
    }

    window.addEventListener("beforeunload", stopPolling);
})();