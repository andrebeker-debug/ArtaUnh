(function (global) {
    "use strict";

    const Store = global.ArtaUnhStore;
    if (!Store) throw new Error("storage.js harus dimuat sebelum auth.js");
    const client = Store.client;

    function validEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
    }

    function mapAuthError(error) {
        const msg = String((error && error.message) || "").toLowerCase();
        if (msg.includes("invalid login")) return "Email atau kata sandi salah.";
        if (msg.includes("already registered") || msg.includes("already been registered")) return "Email sudah terdaftar.";
        if (msg.includes("password")) return "Kata sandi minimal 8 karakter.";
        if (msg.includes("email")) return "Format email tidak valid.";
        return (error && error.message) || "Terjadi kesalahan. Coba lagi.";
    }

    async function register(form) {
        const name = String((form && form.name) || "").trim();
        const email = String((form && form.email) || "").trim().toLowerCase();
        const password = form && form.password;
        const confirm = form && form.confirm;

        if (name.length < 2) return { ok: false, error: "Nama minimal 2 karakter." };
        if (!validEmail(email)) return { ok: false, error: "Format email tidak valid." };
        if (String(password || "").length < 8) return { ok: false, error: "Kata sandi minimal 8 karakter." };
        if (password !== confirm) return { ok: false, error: "Konfirmasi kata sandi tidak cocok." };

        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: { data: { name } },
        });
        if (error) return { ok: false, error: mapAuthError(error) };
        if (!data || !data.user) return { ok: false, error: "Pendaftaran gagal. Coba lagi." };

        if (!data.session) return { ok: true, user: null, needsConfirmation: true };
        const user = await Store.loadUserData(data.user.id);
        return { ok: true, user };
    }

    async function login(form) {
        const email = String((form && form.email) || "").trim().toLowerCase();
        const password = form && form.password;

        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !data || !data.user) return { ok: false, error: "Email atau kata sandi salah." };

        const user = await Store.loadUserData(data.user.id);
        return { ok: true, user };
    }

    async function logout() {
        await client.auth.signOut();
    }

    async function currentUser() {
        const { data } = await client.auth.getSession();
        if (!data || !data.session || !data.session.user) return null;
        return await Store.loadUserData(data.session.user.id);
    }

    async function changePassword(userId, currentPassword, newPassword, confirm) {
        const { data } = await client.auth.getSession();
        const email = data && data.session ? data.session.user.email : null;
        if (!email) return { ok: false, error: "Sesi tidak ditemukan. Silakan masuk lagi." };

        if (String(newPassword || "").length < 8) return { ok: false, error: "Kata sandi baru minimal 8 karakter." };
        if (newPassword !== confirm) return { ok: false, error: "Konfirmasi kata sandi tidak cocok." };

        const check = await client.auth.signInWithPassword({ email, password: currentPassword });
        if (check.error) return { ok: false, error: "Kata sandi saat ini salah." };

        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) return { ok: false, error: mapAuthError(error) };
        return { ok: true };
    }

    global.ArtaUnhAuth = { register, login, logout, currentUser, changePassword };
})(window);
