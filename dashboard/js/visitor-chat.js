// =========================================================
// CREVIO -- VISITOR CHAT PAGE
// File: dashboard/js/visitor-chat.js
// Standalone page reached from the portfolio contact form
// after "Continue on Crevio Chat". Relies on sessionStorage
// state written by portfolio-contact.js on the portfolio page.
// =========================================================
(function () {
    if (window.__crevioVisitorChat) return;
    var root = document.getElementById("vcRoot");
    if (!root) return;
    window.__crevioVisitorChat = true;

    var creatorId = root.dataset.creatorId;
    var creatorSlug = root.dataset.creatorSlug || "";
    var storageKey = "crevio_contact_" + creatorId;

    var msgList   = document.getElementById("vcMessages");
    var inputBar  = document.getElementById("vcInputBar");
    var input     = document.getElementById("vcInput");
    var sendBtn   = document.getElementById("vcSend");
    var statusEl  = document.getElementById("vcStatus");

    var state = { convId: null, email: null, lastCount: -1, timer: null, sending: false };

    function loadState() {
        try {
            var raw = sessionStorage.getItem(storageKey);
            if (!raw) return false;
            var p = JSON.parse(raw);
            if (p && p.convId && p.email) {
                state.convId = p.convId;
                state.email = p.email;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function showNoSession() {
        if (msgList) msgList.style.display = "none";
        if (inputBar) inputBar.style.display = "none";
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.innerHTML =
                "This chat session has ended in this browser.<br>" +
                "Head back to the portfolio to start a new conversation:<br><br>" +
                '<a href="/p/' + encodeURIComponent(creatorSlug) + '">Back to portfolio &rarr;</a>';
        }
    }

    function renderMsg(m) {
        var el = document.createElement("div");
        var isClient = m.sender_type === "client";
        el.className = "vc-bubble " + (isClient ? "vc-out" : "vc-in");
        el.textContent = m.content || "";
        msgList.appendChild(el);
    }

    function fetchMsgs() {
        if (!state.convId || !state.email) return;
        fetch("/api/public/contact/" + state.convId + "?email=" + encodeURIComponent(state.email))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var msgs = data.messages || [];
                if (msgs.length === state.lastCount) return;
                msgList.innerHTML = "";
                msgs.forEach(renderMsg);
                state.lastCount = msgs.length;
                msgList.scrollTop = msgList.scrollHeight;
            })
            .catch(function () {});
    }

    function sendMsg() {
        if (state.sending) return;
        var text = (input.value || "").trim();
        if (!text || !state.convId) return;
        state.sending = true;
        sendBtn.disabled = true;
        fetch("/api/public/contact/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: state.convId,
                email: state.email,
                message: text
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) throw new Error(data.message || "Send failed");
            input.value = "";
            state.lastCount = -1;
            fetchMsgs();
        })
        .catch(function (err) { alert("Send failed: " + err.message); })
        .finally(function () {
            state.sending = false;
            sendBtn.disabled = false;
            if (input) input.focus();
        });
    }

    if (!loadState()) { showNoSession(); return; }

    fetchMsgs();
    state.timer = setInterval(fetchMsgs, 5000);
    sendBtn.addEventListener("click", sendMsg);
    input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    if (input) setTimeout(function () { input.focus(); }, 60);
    window.addEventListener("beforeunload", function () {
        if (state.timer) clearInterval(state.timer);
    });
})();
