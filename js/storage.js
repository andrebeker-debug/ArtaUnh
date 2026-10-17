(function (global) {
    "use strict";

    const cfg = global.ARTAUNH_SUPABASE || {};
    const lib = global.supabase;
    if (!cfg.url || !cfg.anonKey) {
        throw new Error("Supabase belum dikonfigurasi. Isi js/supabase-config.js (url & anonKey).");
    }
    if (!lib || !lib.createClient) {
        throw new Error("Pustaka supabase-js tidak termuat. Periksa koneksi internet / CDN.");
    }
    const client = lib.createClient(cfg.url, cfg.anonKey);

    const DEFAULT_CATEGORIES = {
        income: ["Gaji", "Bonus", "Bisnis", "Investasi", "Hadiah", "Lainnya"],
        expense: ["Makanan", "Transportasi", "Belanja", "Tagihan", "Kesehatan", "Hiburan", "Pendidikan", "Rumah", "Lainnya"],
    };

    const CATEGORY_ICONS = {
        Gaji: "banknote", Bonus: "gift", Bisnis: "briefcase", Investasi: "trending-up",
        Hadiah: "gift", Makanan: "utensils", Transportasi: "car", Belanja: "shopping-bag",
        Tagihan: "receipt", Kesehatan: "heart-pulse", Hiburan: "gamepad-2", Pendidikan: "graduation-cap",
        Rumah: "home", Lainnya: "circle-ellipsis",
    };

    const CATEGORY_COLORS = [
        "#533afd", "#12b76a", "#f79009", "#f04438", "#0ba5ec",
        "#7a5af8", "#ee46bc", "#16b364", "#eaaa08", "#6172f3",
    ];

    const DEFAULT_SETTINGS = {
        currency: "IDR",
        dateFormat: "DD/MM/YYYY",
        darkMode: false,
        notifications: true,
    };

    let currentUserId = null;
    let currentProfile = null;
    let _settings = Object.assign({}, DEFAULT_SETTINGS);
    const cache = {
        transactions: [],
        budgets: [],
        categories: { income: DEFAULT_CATEGORIES.income.slice(), expense: DEFAULT_CATEGORIES.expense.slice() },
    };

    let onError = function (msg) { console.error("[ArtaUnh]", msg); };
    function setErrorHandler(fn) { if (typeof fn === "function") onError = fn; }
    function fail(msg, error) { if (error) console.error("[ArtaUnh]", msg, error); onError(msg); }

    function uid() {
        if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    function normalizeCategories(raw) {
        const c = raw && typeof raw === "object" ? raw : {};
        return {
            income: Array.isArray(c.income) && c.income.length ? c.income.slice() : DEFAULT_CATEGORIES.income.slice(),
            expense: Array.isArray(c.expense) && c.expense.length ? c.expense.slice() : DEFAULT_CATEGORIES.expense.slice(),
        };
    }

    function mapTransaction(row) {
        return {
            id: row.id,
            type: row.type === "income" ? "income" : "expense",
            category: row.category || "Lainnya",
            amount: Number(row.amount) || 0,
            date: row.date || new Date().toISOString().slice(0, 10),
            note: row.note || "",
            recurring: !!row.recurring,
            createdAt: row.created_at || new Date().toISOString(),
        };
    }

    function transactionRow(tx) {
        return {
            id: tx.id,
            user_id: currentUserId,
            type: tx.type === "income" ? "income" : "expense",
            category: tx.category || "Lainnya",
            amount: Number(tx.amount) || 0,
            date: tx.date,
            note: tx.note || "",
            recurring: !!tx.recurring,
            created_at: tx.createdAt,
        };
    }

    function mapBudget(row) {
        return {
            id: row.id,
            category: row.category,
            amount: Number(row.amount) || 0,
            period: row.period || "monthly",
            createdAt: row.created_at || new Date().toISOString(),
        };
    }

    function budgetRow(budget) {
        return {
            id: budget.id,
            user_id: currentUserId,
            category: budget.category,
            amount: Number(budget.amount) || 0,
            period: budget.period || "monthly",
            created_at: budget.createdAt,
        };
    }

    async function loadUserData(userId) {
        currentUserId = userId;

        const authRes = await client.auth.getUser();
        const authUser = authRes && authRes.data ? authRes.data.user : null;

        const [profRes, txRes, budRes] = await Promise.all([
            client.from("profiles").select("*").eq("id", userId).maybeSingle(),
            client.from("transactions").select("*").eq("user_id", userId),
            client.from("budgets").select("*").eq("user_id", userId),
        ]);

        if (txRes.error) fail("Gagal memuat transaksi.", txRes.error);
        if (budRes.error) fail("Gagal memuat anggaran.", budRes.error);

        let prof = profRes.data;
        if (profRes.error) fail("Gagal memuat profil.", profRes.error);

        if (!prof) {
            const name = (authUser && authUser.user_metadata && authUser.user_metadata.name) || "Pengguna";
            const row = {
                id: userId,
                name: name,
                avatar: "",
                settings: Object.assign({}, DEFAULT_SETTINGS),
                categories: { income: DEFAULT_CATEGORIES.income.slice(), expense: DEFAULT_CATEGORIES.expense.slice() },
            };
            const ins = await client.from("profiles").upsert(row).select("*").maybeSingle();
            if (ins.error) fail("Gagal membuat profil.", ins.error);
            prof = ins.data || row;
        }

        _settings = Object.assign({}, DEFAULT_SETTINGS, prof.settings || {});
        cache.categories = normalizeCategories(prof.categories);
        cache.transactions = (txRes.data || []).map(mapTransaction);
        cache.budgets = (budRes.data || []).map(mapBudget);

        currentProfile = {
            id: userId,
            name: prof.name || "Pengguna",
            email: (authUser && authUser.email) || "",
            avatar: prof.avatar || "",
            createdAt: prof.created_at || (authUser && authUser.created_at) || new Date().toISOString(),
        };
        return Object.assign({}, currentProfile);
    }

    function getSettings() { return Object.assign({}, _settings); }

    async function saveSettings(patch) {
        _settings = Object.assign({}, _settings, patch || {});
        if (currentUserId) {
            const { error } = await client.from("profiles").update({ settings: _settings }).eq("id", currentUserId);
            if (error) fail("Gagal menyimpan pengaturan.", error);
        }
        return Object.assign({}, _settings);
    }

    function getUserData() { return cache; }
    function getCategories() { return cache.categories; }

    function getTransactions() {
        return cache.transactions.slice().sort((a, b) => {
            if (a.date === b.date) return (b.createdAt || "").localeCompare(a.createdAt || "");
            return b.date.localeCompare(a.date);
        });
    }

    function getBudgets() { return cache.budgets.slice(); }

    async function addTransaction(userId, tx) {
        const record = {
            id: uid(),
            type: tx.type === "income" ? "income" : "expense",
            category: tx.category || "Lainnya",
            amount: Number(tx.amount) || 0,
            date: tx.date || new Date().toISOString().slice(0, 10),
            note: tx.note || "",
            recurring: !!tx.recurring,
            createdAt: new Date().toISOString(),
        };
        cache.transactions.push(record);
        const { error } = await client.from("transactions").insert(transactionRow(record));
        if (error) fail("Gagal menyimpan transaksi.", error);
        return record;
    }

    async function updateTransaction(userId, id, patch) {
        const idx = cache.transactions.findIndex((t) => t.id === id);
        if (idx === -1) return null;
        const merged = Object.assign({}, cache.transactions[idx], patch);
        merged.amount = Number(merged.amount) || 0;
        cache.transactions[idx] = merged;
        const { error } = await client.from("transactions").update(transactionRow(merged)).eq("id", id);
        if (error) fail("Gagal memperbarui transaksi.", error);
        return merged;
    }

    async function deleteTransaction(userId, id) {
        const before = cache.transactions.length;
        cache.transactions = cache.transactions.filter((t) => t.id !== id);
        const { error } = await client.from("transactions").delete().eq("id", id);
        if (error) fail("Gagal menghapus transaksi.", error);
        return before !== cache.transactions.length;
    }

    async function upsertBudget(userId, budget) {
        const amount = Number(budget.amount) || 0;
        let record = cache.budgets.find((b) => b.category === budget.category);
        if (!record) {
            record = { id: uid(), category: budget.category, amount: amount, period: "monthly", createdAt: new Date().toISOString() };
            cache.budgets.push(record);
        } else {
            record.amount = amount;
        }
        const { data, error } = await client.from("budgets")
            .upsert(budgetRow(record), { onConflict: "user_id,category" })
            .select("*").maybeSingle();
        if (error) fail("Gagal menyimpan anggaran.", error);
        if (data && data.id) record.id = data.id;
        return getBudgets();
    }

    async function deleteBudget(userId, id) {
        cache.budgets = cache.budgets.filter((b) => b.id !== id);
        const { error } = await client.from("budgets").delete().eq("id", id);
        if (error) fail("Gagal menghapus anggaran.", error);
    }

    function updateUser(userId, patch) {
        if (!currentProfile) return null;
        if (patch.name != null) currentProfile.name = patch.name;
        if (patch.avatar != null) currentProfile.avatar = patch.avatar;
        if (patch.email != null) currentProfile.email = patch.email;

        const profilePatch = {};
        if (patch.name != null) profilePatch.name = patch.name;
        if (patch.avatar != null) profilePatch.avatar = patch.avatar;
        if (Object.keys(profilePatch).length) {
            client.from("profiles").update(profilePatch).eq("id", userId).then(({ error }) => {
                if (error) fail("Gagal menyimpan profil.", error);
            });
        }
        if (patch.email != null) {
            client.auth.updateUser({ email: patch.email }).then(({ error }) => {
                if (error) fail("Gagal mengubah email: " + error.message);
            });
        }
        return Object.assign({}, currentProfile);
    }

    function findUserByEmail() { return null; }
    function ensureUserData() { return cache; }

    function exportData() {
        return {
            app: "ArtaUnh",
            version: 1,
            exportedAt: new Date().toISOString(),
            profile: currentProfile ? { name: currentProfile.name, email: currentProfile.email, avatar: currentProfile.avatar || "" } : {},
            data: { transactions: cache.transactions.slice(), budgets: cache.budgets.slice(), categories: cache.categories },
        };
    }

    async function importData(userId, payload) {
        const incoming = payload && payload.data ? payload.data : payload;
        if (!incoming || !Array.isArray(incoming.transactions)) {
            throw new Error("Format file tidak dikenali.");
        }
        const ids = new Set(cache.transactions.map((t) => t.id));
        const newTransactions = [];
        incoming.transactions.forEach((t) => {
            const record = {
                id: t.id || uid(),
                type: t.type === "income" ? "income" : "expense",
                category: t.category || "Lainnya",
                amount: Number(t.amount) || 0,
                date: t.date || new Date().toISOString().slice(0, 10),
                note: t.note || "",
                recurring: !!t.recurring,
                createdAt: t.createdAt || new Date().toISOString(),
            };
            if (!ids.has(record.id)) { newTransactions.push(record); ids.add(record.id); }
        });
        cache.transactions.push.apply(cache.transactions, newTransactions);
        if (newTransactions.length) {
            const { error } = await client.from("transactions").insert(newTransactions.map(transactionRow));
            if (error) fail("Gagal mengimpor transaksi.", error);
        }

        const newBudgets = [];
        if (Array.isArray(incoming.budgets)) {
            const cats = new Set(cache.budgets.map((b) => b.category));
            incoming.budgets.forEach((b) => {
                if (b.category && !cats.has(b.category)) {
                    newBudgets.push({ id: b.id || uid(), category: b.category, amount: Number(b.amount) || 0, period: "monthly", createdAt: new Date().toISOString() });
                    cats.add(b.category);
                }
            });
            cache.budgets.push.apply(cache.budgets, newBudgets);
        }
        if (newBudgets.length) {
            const { error } = await client.from("budgets").insert(newBudgets.map(budgetRow));
            if (error) fail("Gagal mengimpor anggaran.", error);
        }
        return cache;
    }

    async function clearUserData() {
        cache.transactions = [];
        cache.budgets = [];
        cache.categories = { income: DEFAULT_CATEGORIES.income.slice(), expense: DEFAULT_CATEGORIES.expense.slice() };
        if (!currentUserId) return;
        const [t, b] = await Promise.all([
            client.from("transactions").delete().eq("user_id", currentUserId),
            client.from("budgets").delete().eq("user_id", currentUserId),
        ]);
        if (t.error) fail("Gagal menghapus transaksi.", t.error);
        if (b.error) fail("Gagal menghapus anggaran.", b.error);
    }

    function withinPeriod(dateStr, period) {
        const d = new Date(dateStr + "T00:00:00");
        const now = new Date();
        const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const today = startOf(now);
        switch (period) {
            case "week": {
                const dow = (today.getDay() + 6) % 7;
                const monday = new Date(today); monday.setDate(today.getDate() - dow);
                return d >= monday && d <= today;
            }
            case "last-month": {
                const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const e = new Date(now.getFullYear(), now.getMonth(), 0);
                return d >= s && d <= e;
            }
            case "quarter": {
                const q = Math.floor(now.getMonth() / 3);
                const s = new Date(now.getFullYear(), q * 3, 1);
                const e = new Date(now.getFullYear(), q * 3 + 3, 0);
                return d >= s && d <= e;
            }
            case "year":
                return d.getFullYear() === now.getFullYear();
            case "month":
            case "this-month":
            default:
                return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        }
    }

    function summarize(transactions) {
        let income = 0, expense = 0;
        transactions.forEach((t) => { if (t.type === "income") income += t.amount; else expense += t.amount; });
        return { income, expense };
    }

    global.ArtaUnhStore = {
        client,
        DEFAULT_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS, DEFAULT_SETTINGS,
        setErrorHandler,
        loadUserData,
        getSettings, saveSettings,
        getUserData, getCategories, getTransactions, getBudgets,
        addTransaction, updateTransaction, deleteTransaction,
        upsertBudget, deleteBudget,
        updateUser, findUserByEmail, ensureUserData,
        exportData, importData, clearUserData,
        withinPeriod, summarize, uid,
    };
})(window);
