// =========================================================
// CREVIO — PROFILE PAGE
// File: dashboard/js/profile.js
// =========================================================

document.addEventListener("DOMContentLoaded", function () {
    const $ = (id) => document.getElementById(id);

    const form       = $("profileForm");
    const saveBtn    = $("saveBtn");
    const toast      = $("toast");
    const avatarImg  = $("avatarPreview");
    const avatarIn   = $("avatarInput");
    const avatarBtn  = $("avatarBtn");
    const bioInput   = $("bio");
    const bioCount   = $("bioCount");

    // =========================================================
    // LOAD PROFILE
    // =========================================================
    async function loadProfile() {
        try {
            const res  = await window.apiFetch("/api/users/me");
            const data = await res.json();

            if (!data.success || !data.user) {
                showToast("Could not load profile", true);
                return;
            }

            const u = data.user;

            $("username").value           = u.username || "";
            $("email").value              = u.email || "";
            $("display_name").value       = u.display_name || "";
            $("phone").value              = u.phone || "";
            $("whatsapp_number").value      = u.whatsapp_number || "";
            $("bio").value                = u.bio || "";
            $("location").value           = u.location || "";
            $("primary_profession").value = u.primary_profession || "";
            $("specialties").value        = u.specialties || "";

            $("displayNamePreview").textContent = u.display_name || u.username || "User";
            $("usernamePreview").textContent    = "@" + (u.username || "user");
            $("roleBadge").textContent          = u.role || "creator";

            // Avatar
            if (u.profile_image) {
                avatarImg.innerHTML = `<img src="${escapeHtml(u.profile_image)}" alt="">`;
            } else {
                avatarImg.textContent = (u.username || "U").charAt(0).toUpperCase();
            }

            updateBioCount();

            // Update cached user
            try {
                const cached = JSON.parse(localStorage.getItem("user") || "{}");
                localStorage.setItem("user", JSON.stringify({ ...cached, ...u }));
            } catch (e) {}
        } catch (err) {
            console.error("Load profile error:", err);
            showToast("Could not load profile: " + err.message, true);
        }
    }

    // =========================================================
    // SAVE PROFILE
    // =========================================================
    form?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const payload = {
            display_name:       $("display_name").value.trim(),
            phone:              $("phone").value.trim(),
            whatsapp_number:    $("whatsapp_number").value.trim(),
            bio:                $("bio").value.trim(),
            location:           $("location").value.trim(),
            primary_profession: $("primary_profession").value.trim(),
            specialties:        $("specialties").value.trim()
        };

        if (payload.bio.length > 500) {
            showToast("Bio must be under 500 characters", true);
            return;
        }

        saveBtn.disabled = true;
        const original = saveBtn.innerHTML;
        saveBtn.innerHTML = "Saving...";

        try {
            const res  = await window.apiFetch("/api/users/me", {
                method: "PATCH",
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.success) {
                showToast("Profile updated");
                // Update display name in card immediately
                $("displayNamePreview").textContent =
                    payload.display_name || $("username").value || "User";

                // Update cached user
                try {
                    const cached = JSON.parse(localStorage.getItem("user") || "{}");
                    localStorage.setItem("user", JSON.stringify({ ...cached, ...payload }));
                } catch (e) {}
            } else {
                showToast(data.message || "Failed to save", true);
            }
        } catch (err) {
            showToast("Failed: " + err.message, true);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = original || `<i data-lucide="save" class="icon" style="width:16px;height:16px;"></i> Save Changes`;
            if (typeof lucide !== "undefined") lucide.createIcons();
        }
    });

    // =========================================================
    // AVATAR UPLOAD
    // =========================================================
    avatarBtn?.addEventListener("click", () => avatarIn.click());

    avatarIn?.addEventListener("change", async function () {
        const file = this.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast("Image must be under 5MB", true);
            return;
        }
        if (!file.type.startsWith("image/")) {
            showToast("Only image files allowed", true);
            return;
        }

        // Preview instantly
        const reader = new FileReader();
        reader.onload = (e) => {
            avatarImg.innerHTML = `<img src="${e.target.result}" alt="">`;
        };
        reader.readAsDataURL(file);

        // Upload
        const fd = new FormData();
        fd.append("avatar", file);

        try {
            const token = localStorage.getItem("token");
            const res = await fetch("/api/users/me/avatar", {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: fd
            });
            const data = await res.json();

            if (data.success && data.url) {
                showToast("Avatar updated");
                // Update cached user
                try {
                    const cached = JSON.parse(localStorage.getItem("user") || "{}");
                    localStorage.setItem("user", JSON.stringify({ ...cached, profile_image: data.url }));
                } catch (e) {}
            } else {
                showToast(data.message || "Upload failed", true);
            }
        } catch (err) {
            showToast("Upload failed: " + err.message, true);
        } finally {
            this.value = "";
        }
    });

    // =========================================================
    // BIO CHARACTER COUNT
    // =========================================================
    function updateBioCount() {
        if (bioCount && bioInput) bioCount.textContent = bioInput.value.length;
    }
    bioInput?.addEventListener("input", updateBioCount);

    // =========================================================
    // HELPERS
    // =========================================================
    let toastTimer;
    function showToast(msg, isError = false) {
        if (!toast) return;
        clearTimeout(toastTimer);
        toast.textContent = msg;
        toast.classList.toggle("error", isError);
        toast.classList.add("show");
        toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
    }

    function escapeHtml(str) {
        return String(str == null ? "" : str).replace(/[&<>"']/g, s => ({
            "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
        })[s]);
    }

    // =========================================================
    // INIT
    // =========================================================
    loadProfile();
});