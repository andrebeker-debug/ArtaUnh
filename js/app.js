(function () {
    "use strict";

    const Store = window.ArtaUnhStore;
    const Auth = window.ArtaUnhAuth;
    const Charts = window.ArtaUnhCharts;

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const ic = (name, size) => `<i data-lucide="${name}" width="${size || 18}" height="${size || 18}"></i>`;
    const refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };

    let chartLibPromise = null;
    function ensureChartLib() {
        if (window.Chart) return Promise.resolve();
        if (!chartLibPromise) {
            chartLibPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error("Gagal memuat Chart.js"));
                document.head.appendChild(script);
            });
        }
        return chartLibPromise;
    }

    let currentUser = null;
    let editingTxId = null;
    const txState = { search: "", type: "all", category: "all", period: "month", page: 1, pageSize: 10 };

    const TAB_TITLES = {
        dashboard: "Dashboard", transactions: "Transaksi", reports: "Laporan",
        budgets: "Anggaran", settings: "Pengaturan",
    };

    const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    function settings() { return Store.getSettings(); }

    function formatMoney(amount, currency) {
        currency = currency || settings().currency || "IDR";
        const n = Math.round(Number(amount) || 0);
        if (currency === "IDR") return "Rp " + new Intl.NumberFormat("id-ID").format(n);
        const symbol = currency === "USD" ? "$" : currency === "SGD" ? "S$" : currency + " ";
        return symbol + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    }

    function formatDate(dateStr, withYear) {
        if (!dateStr) return "";
        const [y, m, d] = dateStr.split("-");
        const fmt = settings().dateFormat || "DD/MM/YYYY";
        if (fmt === "YYYY-MM-DD") return dateStr;
        if (fmt === "MM/DD/YYYY") return `${m}/${d}/${y}`;
        return `${d}/${m}/${y}`;
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function formatThousands(value) {
        const digits = String(value == null ? "" : value).replace(/\D/g, "");
        if (!digits) return "";
        return new Intl.NumberFormat("id-ID").format(Number(digits));
    }

    function parseAmount(value) {
        return Number(String(value == null ? "" : value).replace(/\D/g, "")) || 0;
    }

    function attachAmountInput(input) {
        if (!input) return;
        input.addEventListener("input", () => {
            const caret = input.selectionStart || 0;
            const digitsBefore = input.value.slice(0, caret).replace(/\D/g, "").length;
            const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
            const formatted = formatThousands(digits);
            input.value = formatted;
            let pos = 0, count = 0;
            while (pos < formatted.length && count < digitsBefore) {
                if (/\d/.test(formatted[pos])) count++;
                pos++;
            }
            input.setSelectionRange(pos, pos);
        });
    }

    function catIcon(cat) { return Store.CATEGORY_ICONS[cat] || "tag"; }

    function showToast(message, type) {
        type = type || "info";
        const map = { success: "check-circle", error: "alert-circle", warning: "alert-triangle", info: "info" };
        const el = document.createElement("div");
        el.className = "toast " + type;
        el.innerHTML = ic(map[type] || "info", 18) + "<span>" + escapeHtml(message) + "</span>";
        $("#toast-container").appendChild(el);
        refreshIcons();
        setTimeout(() => {
            el.classList.add("leaving");
            setTimeout(() => el.remove(), 220);
        }, 3200);
    }

    function confirmAction(opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            const modal = $("#confirm-modal");
            $("#confirm-title").textContent = opts.title || "Konfirmasi";
            $("#confirm-message").textContent = opts.message || "Apakah Anda yakin?";
            $("#confirm-icon").innerHTML = ic(opts.icon || "alert-triangle", 26);
            const ok = $("#confirm-ok");
            ok.textContent = opts.okText || "Ya";
            ok.className = "btn " + (opts.danger === false ? "btn-primary" : "btn-danger");
            refreshIcons();
            modal.hidden = false;

            const cleanup = () => {
                modal.hidden = true;
                ok.removeEventListener("click", onOk);
                $("#confirm-cancel").removeEventListener("click", onCancel);
                modal.querySelector(".modal-backdrop").removeEventListener("click", onCancel);
            };
            const onOk = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };
            ok.addEventListener("click", onOk);
            $("#confirm-cancel").addEventListener("click", onCancel);
            modal.querySelector(".modal-backdrop").addEventListener("click", onCancel);
        });
    }

    function applyTheme(dark) {
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
        const toggle = $("#theme-toggle");
        if (toggle) toggle.setAttribute("aria-checked", dark ? "true" : "false");
        const settingsToggle = $("#setting-dark-mode");
        if (settingsToggle) settingsToggle.checked = dark;
        const label = $("#theme-label");
        if (label) label.textContent = dark ? "Mode Terang" : "Mode Gelap";
        const themeBtnIcon = $("#theme-icon");
        if (themeBtnIcon) themeBtnIcon.setAttribute("data-lucide", dark ? "sun" : "moon");
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", dark ? "#14121a" : "#533afd");
        refreshIcons();
        if (currentUser) refreshAllCharts();
    }

    function toggleTheme() {
        const next = !(settings().darkMode);
        Store.saveSettings({ darkMode: next });
        applyTheme(next);
    }

    function currentTab() {
        const h = (location.hash || "#dashboard").replace("#", "");
        if (h === "add-transaction") return { openModal: true, tab: "transactions" };
        return { tab: TAB_TITLES[h] ? h : "dashboard", openModal: false };
    }

    function setActiveTab(tab) {
        $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + tab));
        $$(".nav-item[data-tab], .sidebar-item[data-tab]").forEach((a) => {
            a.classList.toggle("active", a.dataset.tab === tab);
        });
        const title = $("#page-title");
        if (title) title.textContent = TAB_TITLES[tab] || "ArtaUnh";
        document.title = (TAB_TITLES[tab] || "ArtaUnh") + " - ArtaUnh";
        window.scrollTo({ top: 0, behavior: "smooth" });
        if (tab === "dashboard") refreshDashboard();
        if (tab === "reports") refreshReports();
        if (tab === "budgets") renderBudgets();
        if (tab === "settings") fillSettings();
    }

    function handleRoute() {
        const route = currentTab();
        setActiveTab(route.tab);
        closeSidebar();
        if (route.openModal) {
            history.replaceState(null, "", "#transactions");
            openTransactionModal(null);
        }
    }

    let backdropEl = null;
    function ensureBackdrop() {
        if (backdropEl) return backdropEl;
        backdropEl = document.createElement("div");
        backdropEl.className = "sidebar-backdrop";
        backdropEl.addEventListener("click", closeSidebar);
        document.body.appendChild(backdropEl);
        return backdropEl;
    }
    function openSidebar() { $(".sidebar").classList.add("open"); ensureBackdrop().classList.add("show"); }
    function closeSidebar() {
        $(".sidebar").classList.remove("open");
        if (backdropEl) backdropEl.classList.remove("show");
    }

    function showAuth(mode) {
        const modal = $("#auth-modal");
        modal.hidden = false;
        const login = $("#login-form");
        const reg = $("#register-form");
        if (mode === "register") { login.hidden = true; reg.hidden = false; $("#register-name").focus(); }
        else { reg.hidden = true; login.hidden = false; $("#login-email").focus(); }
        refreshIcons();
    }
    function hideAuth() { $("#auth-modal").hidden = true; }

    function bootAuth() {
        $("#show-register").addEventListener("click", () => showAuth("register"));
        $("#show-login").addEventListener("click", () => showAuth("login"));
        $("#auth-close").addEventListener("click", hideAuth);
        $("#auth-modal .modal-backdrop").addEventListener("click", () => {
            if (currentUser) hideAuth();
        });
        $$(".password-toggle").forEach((btn) => btn.addEventListener("click", () => {
            const input = btn.parentElement.querySelector("input");
            const isPw = input.type === "password";
            input.type = isPw ? "text" : "password";
            btn.innerHTML = ic(isPw ? "eye-off" : "eye", 18);
            refreshIcons();
        }));

        $("#login-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const res = await Auth.login({ email: $("#login-email").value, password: $("#login-password").value });
            if (!res.ok) return showToast(res.error, "error");
            e.target.reset();
            startApp(res.user);
            showToast("Selamat datang kembali, " + res.user.name.split(" ")[0] + "!", "success");
        });

        $("#register-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const res = await Auth.register({
                name: $("#register-name").value,
                email: $("#register-email").value,
                password: $("#register-password").value,
                confirm: $("#register-confirm").value,
            });
            if (!res.ok) return showToast(res.error, "error");
            e.target.reset();
            if (res.needsConfirmation) {
                showAuth("login");
                showToast("Akun dibuat. Cek email untuk konfirmasi, lalu masuk.", "info");
                return;
            }
            startApp(res.user);
            showToast("Akun berhasil dibuat. Selamat datang!", "success");
        });
    }

    function startApp(user) {
        currentUser = user;
        hideAuth();
        $("#app").hidden = false;
        Store.ensureUserData(user.id);
        updateUserUI();
        applyTheme(settings().darkMode);
        if (!location.hash) location.hash = "#dashboard";
        handleRoute();
        txState.page = 1;
        renderTransactions();
        buildCategoryFilter();
        refreshIcons();
        ensureChartLib()
            .then(() => { if (currentUser) refreshAllCharts(); })
            .catch((err) => console.error("[ArtaUnh]", err));
    }

    function avatarInner(user) {
        if (user && user.avatar) return '<img src="' + user.avatar + '" alt="">';
        return escapeHtml(((user && user.name) || "U").trim().charAt(0).toUpperCase());
    }

    function renderProfileAvatarPreview() {
        const el = $("#profile-avatar");
        if (!el) return;
        el.innerHTML = avatarInner(currentUser);
        const removeBtn = $("#btn-remove-photo");
        if (removeBtn) removeBtn.hidden = !(currentUser && currentUser.avatar);
    }

    function updateUserUI() {
        const inner = avatarInner(currentUser);
        $("#user-avatar").innerHTML = inner;
        $("#dropdown-avatar").innerHTML = inner;
        $("#user-name").textContent = currentUser.name;
        $("#dropdown-name").textContent = currentUser.name;
        $("#dropdown-email").textContent = currentUser.email;
        renderProfileAvatarPreview();
    }

    async function logoutUser() {
        await Auth.logout();
        currentUser = null;
        $("#app").hidden = true;
        closeSidebar();
        showAuth("login");
        showToast("Kamu telah keluar.", "info");
    }

    function refreshDashboard() {
        if (!currentUser) return;
        const all = Store.getTransactions(currentUser.id);
        const monthTx = all.filter((t) => Store.withinPeriod(t.date, "month"));
        const sum = Store.summarize(monthTx);

        $("#total-income").textContent = formatMoney(sum.income);
        $("#total-expense").textContent = formatMoney(sum.expense);
        $("#total-balance").textContent = formatMoney(sum.income - sum.expense);
        $("#this-month-count").textContent = monthTx.length;

        const usedCats = new Set(monthTx.map((t) => t.category));
        $("#categories-count").textContent = usedCats.size;

        const budgets = Store.getBudgets(currentUser.id);
        if (!budgets.length) {
            $("#budget-status").textContent = "—";
        } else {
            const over = budgets.filter((b) => spentInMonth(all, b.category) > b.amount).length;
            $("#budget-status").textContent = over ? over + " lewat" : budgets.length + " aman";
        }

        const dayOfMonth = new Date().getDate();
        $("#avg-daily").textContent = formatMoney(sum.expense / Math.max(dayOfMonth, 1));

        renderRecent(all.slice(0, 5));
        Charts.renderExpenseChart($("#expense-chart"), $("#expense-legend"), all, $("#expense-chart-period").value);
        Charts.renderTrendChart($("#trend-chart"), all, $("#trend-chart-period").value === "12months" ? 12 : 6);
    }

    function renderRecent(list) {
        const wrap = $("#recent-transactions");
        if (!list.length) {
            wrap.innerHTML = '<div class="empty-state" style="padding:var(--space-6)">' +
                ic("inbox", 40) + "<p>Belum ada transaksi</p></div>";
            refreshIcons();
            return;
        }
        wrap.innerHTML = list.map((t) => {
            const income = t.type === "income";
            return `<div class="recent-item">
                <div class="recent-icon ${t.type}">${ic(catIcon(t.category), 18)}</div>
                <div class="recent-meta">
                    <div class="recent-title">${escapeHtml(t.category)}</div>
                    <div class="recent-sub">${escapeHtml(t.note || formatDate(t.date))}</div>
                </div>
                <div class="recent-amount ${t.type}">${income ? "+" : "-"} ${formatMoney(t.amount)}</div>
            </div>`;
        }).join("");
        refreshIcons();
    }

    function spentInMonth(transactions, category) {
        return transactions
            .filter((t) => t.type === "expense" && t.category === category && Store.withinPeriod(t.date, "month"))
            .reduce((a, t) => a + t.amount, 0);
    }

    function buildCategoryFilter() {
        const cats = Store.getUserData(currentUser.id).categories;
        const all = Array.from(new Set([].concat(cats.income, cats.expense)));
        const sel = $("#filter-category");
        sel.innerHTML = '<option value="all">Semua Kategori</option>' +
            all.sort().map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }

    function filteredTransactions() {
        const all = Store.getTransactions(currentUser.id);
        const q = txState.search.trim().toLowerCase();
        return all.filter((t) => {
            if (txState.type !== "all" && t.type !== txState.type) return false;
            if (txState.category !== "all" && t.category !== txState.category) return false;
            if (txState.period !== "custom" && !Store.withinPeriod(t.date, txState.period)) return false;
            if (q && !((t.note || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q) ||
                String(t.amount).includes(q))) return false;
            return true;
        });
    }

    function renderTransactions() {
        const rows = filteredTransactions();
        const tbody = $("#transactions-body");
        const empty = $("#empty-transactions");
        const table = $("#transactions-table");
        const pager = $("#transactions-pagination");

        const totalPages = Math.max(1, Math.ceil(rows.length / txState.pageSize));
        if (txState.page > totalPages) txState.page = totalPages;
        const start = (txState.page - 1) * txState.pageSize;
        const pageRows = rows.slice(start, start + txState.pageSize);

        if (!rows.length) {
            tbody.innerHTML = "";
            table.style.display = "none";
            pager.hidden = true;
            empty.hidden = false;
            refreshIcons();
            return;
        }
        table.style.display = "";
        empty.hidden = true;

        tbody.innerHTML = pageRows.map((t) => {
            const income = t.type === "income";
            return `<tr data-id="${t.id}">
                <td data-label="Tanggal">${formatDate(t.date)}</td>
                <td data-label="Kategori"><span class="cat-badge">${ic(catIcon(t.category), 14)} ${escapeHtml(t.category)}</span></td>
                <td data-label="Catatan">${escapeHtml(t.note || "—")}${t.recurring ? " " + ic("repeat", 12) : ""}</td>
                <td data-label="Jumlah" class="amount text-right ${t.type}">${income ? "+" : "-"} ${formatMoney(t.amount)}</td>
                <td class="text-right">
                    <div class="row-actions">
                        <button class="icon-btn" data-action="edit" aria-label="Ubah">${ic("pencil", 16)}</button>
                        <button class="icon-btn danger" data-action="delete" aria-label="Hapus">${ic("trash-2", 16)}</button>
                    </div>
                </td>
            </tr>`;
        }).join("");
        refreshIcons();

        pager.hidden = totalPages <= 1;
        $("#page-info").textContent = `Halaman ${txState.page} dari ${totalPages}`;
        $("#prev-page").disabled = txState.page <= 1;
        $("#next-page").disabled = txState.page >= totalPages;
    }

    function bindTransactionTable() {
        $("#transactions-body").addEventListener("click", async (e) => {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;
            const id = btn.closest("tr").dataset.id;
            if (btn.dataset.action === "edit") {
                const tx = Store.getTransactions(currentUser.id).find((t) => t.id === id);
                openTransactionModal(tx);
            } else if (btn.dataset.action === "delete") {
                const ok = await confirmAction({ title: "Hapus Transaksi", message: "Transaksi ini akan dihapus permanen.", okText: "Ya, Hapus" });
                if (!ok) return;
                Store.deleteTransaction(currentUser.id, id);
                showToast("Transaksi dihapus.", "success");
                renderTransactions();
                refreshDashboard();
            }
        });
    }

    function populateTxCategories(type, selected) {
        const cats = Store.getUserData(currentUser.id).categories;
        const list = type === "income" ? cats.income : cats.expense;
        $("#trans-category").innerHTML = '<option value="">Pilih kategori</option>' +
            list.map((c) => `<option value="${escapeHtml(c)}" ${c === selected ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
    }

    function openTransactionModal(tx) {
        editingTxId = tx ? tx.id : null;
        const modal = $("#transaction-modal");
        $("#transaction-modal-title").textContent = tx ? "Ubah Transaksi" : "Tambah Transaksi";
        const type = tx ? tx.type : "expense";
        const radio = $(`input[name="type"][value="${type}"]`);
        if (radio) radio.checked = true;
        populateTxCategories(type, tx ? tx.category : "");
        $("#trans-amount").value = tx ? formatThousands(tx.amount) : "";
        $("#trans-date").value = tx ? tx.date : new Date().toISOString().slice(0, 10);
        $("#trans-note").value = tx ? (tx.note || "") : "";
        $("#trans-recurring").checked = tx ? !!tx.recurring : false;
        modal.hidden = false;
        refreshIcons();
        setTimeout(() => $("#trans-amount").focus(), 60);
    }

    function closeTransactionModal() { $("#transaction-modal").hidden = true; editingTxId = null; }

    function bindTransactionModal() {
        attachAmountInput($("#trans-amount"));
        $("#btn-add-transaction").addEventListener("click", () => openTransactionModal(null));
        $("#btn-first-transaction").addEventListener("click", () => openTransactionModal(null));
        $("#btn-add-quick").addEventListener("click", () => openTransactionModal(null));
        $("#transaction-modal-close").addEventListener("click", closeTransactionModal);
        $("#transaction-cancel").addEventListener("click", closeTransactionModal);
        $("#transaction-modal .modal-backdrop").addEventListener("click", closeTransactionModal);

        $$('input[name="type"]').forEach((r) => r.addEventListener("change", () => {
            populateTxCategories(r.value, "");
        }));

        $("#transaction-form").addEventListener("submit", (e) => {
            e.preventDefault();
            const type = ($('input[name="type"]:checked') || {}).value;
            const category = $("#trans-category").value;
            const amount = parseAmount($("#trans-amount").value);
            const date = $("#trans-date").value;

            if (!type) return showToast("Pilih tipe transaksi.", "error");
            if (!category) { $("#trans-category").classList.add("invalid"); return showToast("Pilih kategori.", "error"); }
            $("#trans-category").classList.remove("invalid");
            if (!amount || amount <= 0) { $("#trans-amount").classList.add("invalid"); return showToast("Jumlah harus lebih dari 0.", "error"); }
            $("#trans-amount").classList.remove("invalid");
            if (!date) return showToast("Pilih tanggal.", "error");

            const payload = { type, category, amount, date, note: $("#trans-note").value.trim(), recurring: $("#trans-recurring").checked };
            if (editingTxId) { Store.updateTransaction(currentUser.id, editingTxId, payload); showToast("Transaksi diperbarui.", "success"); }
            else { Store.addTransaction(currentUser.id, payload); showToast("Transaksi disimpan.", "success"); }

            closeTransactionModal();
            buildCategoryFilter();
            renderTransactions();
            refreshDashboard();
            if (currentTab().tab === "budgets") renderBudgets();
        });
    }

    function reportMonthKeys() {
        const all = Store.getTransactions(currentUser.id);
        const set = new Set(all.map((t) => t.date.slice(0, 7)));
        const now = new Date();
        set.add(now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));
        return Array.from(set).sort().reverse();
    }

    function fillReportMonths() {
        const sel = $("#report-month");
        const prev = sel.value;
        sel.innerHTML = reportMonthKeys().map((k) => {
            const [y, m] = k.split("-");
            return `<option value="${k}">${MONTH_NAMES[Number(m) - 1]} ${y}</option>`;
        }).join("");
        if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
    }

    function refreshReports() {
        if (!currentUser) return;
        const all = Store.getTransactions(currentUser.id);
        fillReportMonths();

        const key = $("#report-month").value || reportMonthKeys()[0];
        const [y, m] = key.split("-").map(Number);
        const monthTx = all.filter((t) => {
            const d = new Date(t.date + "T00:00:00");
            return d.getFullYear() === y && d.getMonth() === m - 1;
        });
        const sum = Store.summarize(monthTx);

        $("#monthly-summary").innerHTML =
            `<div class="summary-item income"><div class="label">Pemasukan</div><div class="value">${formatMoney(sum.income)}</div></div>` +
            `<div class="summary-item expense"><div class="label">Pengeluaran</div><div class="value">${formatMoney(sum.expense)}</div></div>` +
            `<div class="summary-item"><div class="label">Jumlah Transaksi</div><div class="value">${monthTx.length}</div></div>`;

        Charts.renderMonthlyChart($("#monthly-chart"), all, y, m - 1);
        renderCategoryBreakdown($("#report-category-period").value);
        Charts.renderCashflowChart($("#cashflow-chart"), all, $("#cashflow-period").value);
    }

    function renderCategoryBreakdown(period) {
        const all = Store.getTransactions(currentUser.id);
        const rows = all.filter((t) => t.type === "expense" && Store.withinPeriod(t.date, period));
        const byCat = {};
        rows.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
        const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const wrap = $("#category-breakdown");
        if (!entries.length) {
            wrap.innerHTML = '<div class="empty-state" style="padding:var(--space-6)">' + ic("inbox", 36) + "<p>Belum ada pengeluaran pada periode ini</p></div>";
            refreshIcons();
            return;
        }
        const max = entries[0][1];
        wrap.innerHTML = entries.map(([cat, val], i) => {
            const color = Store.CATEGORY_COLORS[i % Store.CATEGORY_COLORS.length];
            return `<div class="breakdown-row">
                <span class="breakdown-label">${escapeHtml(cat)}</span>
                <span class="breakdown-amount">${formatMoney(val)}</span>
                <span class="breakdown-bar"><span class="breakdown-fill" style="width:${Math.max(4, (val / max) * 100)}%;background:${color}"></span></span>
            </div>`;
        }).join("");
    }

    function renderBudgets() {
        if (!currentUser) return;
        const budgets = Store.getBudgets(currentUser.id);
        const all = Store.getTransactions(currentUser.id);
        const list = $("#budgets-list");
        const empty = $("#empty-budgets");

        if (!budgets.length) {
            list.innerHTML = "";
            empty.hidden = false;
            refreshIcons();
            return;
        }
        empty.hidden = true;
        list.innerHTML = budgets.map((b) => {
            const spent = spentInMonth(all, b.category);
            const pct = b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0;
            const over = spent > b.amount;
            const warn = !over && pct >= 80;
            const cls = over ? "over" : warn ? "warn" : "";
            const remaining = b.amount - spent;
            return `<article class="budget-card">
                <div class="budget-head">
                    <span class="budget-title">${ic(catIcon(b.category), 16)} ${escapeHtml(b.category)}</span>
                    <div class="row-actions">
                        <button class="icon-btn" data-budget-edit="${b.id}" aria-label="Ubah">${ic("pencil", 16)}</button>
                        <button class="icon-btn danger" data-budget-delete="${b.id}" aria-label="Hapus">${ic("trash-2", 16)}</button>
                    </div>
                </div>
                <div class="budget-nums"><strong>${formatMoney(spent)}</strong> / ${formatMoney(b.amount)}</div>
                <div class="budget-track"><div class="budget-fill ${cls}" style="width:${pct}%"></div></div>
                <div class="budget-foot">
                    <span>${pct.toFixed(0)}% terpakai</span>
                    <span>${over ? "Lewat " + formatMoney(-remaining) : "Sisa " + formatMoney(remaining)}</span>
                </div>
            </article>`;
        }).join("");
        refreshIcons();
    }

    function openBudgetModal(budget) {
        const cats = Store.getUserData(currentUser.id).categories.expense;
        const isEdit = !!budget;
        const modal = document.createElement("div");
        modal.className = "modal";
        modal.innerHTML = `
            <div class="modal-backdrop" tabindex="-1"></div>
            <div class="modal-container">
                <header class="modal-header">
                    <h2>${isEdit ? "Ubah Anggaran" : "Buat Anggaran"}</h2>
                    <button class="modal-close" aria-label="Tutup">${ic("x", 20)}</button>
                </header>
                <form class="modal-body">
                    <div class="form-group">
                        <label for="budget-cat">Kategori *</label>
                        <select id="budget-cat" ${isEdit ? "disabled" : ""}>
                            <option value="">Pilih kategori</option>
                            ${cats.map((c) => `<option value="${escapeHtml(c)}" ${isEdit && c === budget.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="budget-amount">Batas Bulanan *</label>
                        <div class="amount-input-wrapper">
                            <span class="currency-prefix">Rp</span>
                            <input type="text" inputmode="numeric" autocomplete="off" id="budget-amount" placeholder="0" value="${isEdit ? formatThousands(budget.amount) : ""}">
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
                        <button type="submit" class="btn btn-primary">${isEdit ? "Simpan" : "Buat"}</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(modal);
        refreshIcons();
        attachAmountInput(modal.querySelector("#budget-amount"));
        const close = () => modal.remove();
        modal.querySelector(".modal-close").addEventListener("click", close);
        modal.querySelector("[data-cancel]").addEventListener("click", close);
        modal.querySelector(".modal-backdrop").addEventListener("click", close);
        modal.querySelector("form").addEventListener("submit", (e) => {
            e.preventDefault();
            const category = isEdit ? budget.category : modal.querySelector("#budget-cat").value;
            const amount = parseAmount(modal.querySelector("#budget-amount").value);
            if (!category) return showToast("Pilih kategori.", "error");
            if (!amount || amount <= 0) return showToast("Jumlah anggaran tidak valid.", "error");
            Store.upsertBudget(currentUser.id, { category, amount });
            close();
            renderBudgets();
            showToast(isEdit ? "Anggaran diperbarui." : "Anggaran dibuat.", "success");
        });
        setTimeout(() => modal.querySelector("#budget-amount").focus(), 60);
    }

    function bindBudgets() {
        $("#btn-add-budget").addEventListener("click", () => openBudgetModal(null));
        $("#btn-first-budget").addEventListener("click", () => openBudgetModal(null));
        $("#budgets-list").addEventListener("click", async (e) => {
            const edit = e.target.closest("[data-budget-edit]");
            const del = e.target.closest("[data-budget-delete]");
            if (edit) {
                const b = Store.getBudgets(currentUser.id).find((x) => x.id === edit.dataset.budgetEdit);
                if (b) openBudgetModal(b);
            } else if (del) {
                const ok = await confirmAction({ title: "Hapus Anggaran", message: "Anggaran ini akan dihapus.", okText: "Ya, Hapus" });
                if (!ok) return;
                Store.deleteBudget(currentUser.id, del.dataset.budgetDelete);
                renderBudgets();
                showToast("Anggaran dihapus.", "success");
            }
        });
    }

    function fillSettings() {
        const s = settings();
        $("#setting-name").value = currentUser.name;
        $("#setting-email").value = currentUser.email;
        $("#setting-currency").value = s.currency;
        $("#setting-date-format").value = s.dateFormat;
        $("#setting-dark-mode").checked = !!s.darkMode;
        $("#setting-notifications").checked = !!s.notifications;
        renderProfileAvatarPreview();
    }

    function readResizedImage(file, maxSize, cb) {
        if (!file || !/^image\//.test(file.type)) return cb(new Error("File harus berupa gambar."));
        if (file.size > 5 * 1024 * 1024) return cb(new Error("Ukuran file maksimal 5 MB."));
        const reader = new FileReader();
        reader.onerror = () => cb(new Error("Gagal membaca file."));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => cb(new Error("Gambar tidak dapat dibaca."));
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w; canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                try { cb(null, canvas.toDataURL("image/jpeg", 0.85)); }
                catch (e) { cb(new Error("Gagal memproses gambar.")); }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    function changeProfilePhoto(file) {
        readResizedImage(file, 256, (err, dataUrl) => {
            if (err) return showToast(err.message, "error");
            currentUser = Store.updateUser(currentUser.id, { avatar: dataUrl });
            updateUserUI();
            showToast("Foto profil diperbarui.", "success");
        });
    }

    function bindSettings() {
        $("#profile-form").addEventListener("submit", (e) => {
            e.preventDefault();
            const name = $("#setting-name").value.trim();
            const email = $("#setting-email").value.trim().toLowerCase();
            if (name.length < 2) return showToast("Nama minimal 2 karakter.", "error");
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("Email tidak valid.", "error");
            const other = Store.findUserByEmail(email);
            if (other && other.id !== currentUser.id) return showToast("Email sudah digunakan.", "error");
            currentUser = Store.updateUser(currentUser.id, { name, email });
            updateUserUI();
            showToast("Profil diperbarui.", "success");
        });

        $("#password-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const res = await Auth.changePassword(currentUser.id,
                $("#current-password").value, $("#new-password").value, $("#confirm-password").value);
            if (!res.ok) return showToast(res.error, "error");
            e.target.reset();
            showToast("Kata sandi diubah.", "success");
        });

        $("#setting-currency").addEventListener("change", (e) => {
            Store.saveSettings({ currency: e.target.value });
            refreshDashboard(); renderTransactions();
            if (currentTab().tab === "reports") refreshReports();
            showToast("Mata uang diperbarui.", "success");
        });
        $("#setting-date-format").addEventListener("change", (e) => {
            Store.saveSettings({ dateFormat: e.target.value });
            renderTransactions(); refreshDashboard();
            showToast("Format tanggal diperbarui.", "success");
        });
        $("#setting-dark-mode").addEventListener("change", (e) => {
            Store.saveSettings({ darkMode: e.target.checked });
            applyTheme(e.target.checked);
        });
        $("#setting-notifications").addEventListener("change", (e) => {
            Store.saveSettings({ notifications: e.target.checked });
            showToast(e.target.checked ? "Notifikasi diaktifkan." : "Notifikasi dimatikan.", "info");
        });

        $("#btn-change-photo").addEventListener("click", () => $("#photo-input").click());
        $("#photo-input").addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (file) changeProfilePhoto(file);
        });
        $("#btn-remove-photo").addEventListener("click", async () => {
            const ok = await confirmAction({ title: "Hapus Foto Profil", message: "Foto profil akan dihapus dan diganti inisial nama.", okText: "Ya, Hapus" });
            if (!ok) return;
            currentUser = Store.updateUser(currentUser.id, { avatar: "" });
            updateUserUI();
            showToast("Foto profil dihapus.", "info");
        });

        $("#btn-export-data").addEventListener("click", exportData);
        $("#btn-import-data").addEventListener("click", importData);
        $("#btn-clear-data").addEventListener("click", async () => {
            const ok = await confirmAction({ title: "Hapus Semua Data", message: "Semua transaksi & anggaran akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.", okText: "Ya, Hapus" });
            if (!ok) return;
            Store.clearUserData(currentUser.id);
            buildCategoryFilter();
            renderTransactions(); refreshDashboard();
            if (currentTab().tab === "reports") refreshReports();
            renderBudgets();
            showToast("Semua data dihapus.", "success");
        });
    }

    function exportData() {
        const payload = Store.exportData(currentUser.id);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "artaunh-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showToast("Data berhasil diekspor.", "success");
    }

    function importData() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const payload = JSON.parse(reader.result);
                    Store.importData(currentUser.id, payload);
                    buildCategoryFilter();
                    renderTransactions(); refreshDashboard();
                    if (currentTab().tab === "reports") refreshReports();
                    renderBudgets();
                    showToast("Data berhasil diimpor.", "success");
                } catch (err) {
                    showToast("Gagal mengimpor: " + err.message, "error");
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    function refreshAllCharts() {
        if (!currentUser) return;
        const tab = currentTab().tab;
        if (tab === "dashboard") refreshDashboard();
        else if (tab === "reports") refreshReports();
    }

    function bindGlobal() {
        window.addEventListener("hashchange", handleRoute);
        $("#sidebar-toggle").addEventListener("click", openSidebar);
        $("#theme-toggle").addEventListener("click", toggleTheme);
        $("#btn-theme").addEventListener("click", () => { closeUserMenu(); toggleTheme(); });
        $("#btn-profile").addEventListener("click", () => { closeUserMenu(); location.hash = "#settings"; });

        const trigger = $(".user-menu-trigger");
        const dropdown = $(".user-dropdown");
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const open = dropdown.hidden;
            dropdown.hidden = !open;
            trigger.setAttribute("aria-expanded", String(open));
        });
        document.addEventListener("click", (e) => {
            if (!e.target.closest("#user-menu")) closeUserMenu();
        });
        $("#btn-logout").addEventListener("click", async () => {
            closeUserMenu();
            const ok = await confirmAction({ title: "Keluar", message: "Kamu yakin ingin keluar dari akun ini?", okText: "Keluar", icon: "log-out" });
            if (ok) logoutUser();
        });

        $("#transaction-search").addEventListener("input", (e) => {
            txState.search = e.target.value; txState.page = 1; renderTransactions();
        });
        $("#filter-type").addEventListener("change", (e) => { txState.type = e.target.value; txState.page = 1; renderTransactions(); });
        $("#filter-category").addEventListener("change", (e) => { txState.category = e.target.value; txState.page = 1; renderTransactions(); });
        $("#filter-period").addEventListener("change", (e) => { txState.period = e.target.value; txState.page = 1; renderTransactions(); });
        $("#prev-page").addEventListener("click", () => { if (txState.page > 1) { txState.page--; renderTransactions(); } });
        $("#next-page").addEventListener("click", () => { txState.page++; renderTransactions(); });

        $("#expense-chart-period").addEventListener("change", () => {
            Charts.renderExpenseChart($("#expense-chart"), $("#expense-legend"), Store.getTransactions(currentUser.id), $("#expense-chart-period").value);
        });
        $("#trend-chart-period").addEventListener("change", (e) => {
            Charts.renderTrendChart($("#trend-chart"), Store.getTransactions(currentUser.id), e.target.value === "12months" ? 12 : 6);
        });
        $("#report-month").addEventListener("change", refreshReports);
        $("#report-category-period").addEventListener("change", (e) => renderCategoryBreakdown(e.target.value));
        $("#cashflow-period").addEventListener("change", () => {
            Charts.renderCashflowChart($("#cashflow-chart"), Store.getTransactions(currentUser.id), $("#cashflow-period").value);
        });

        window.addEventListener("online", () => { $("#offline-indicator").hidden = true; showToast("Kembali online.", "success"); });
        window.addEventListener("offline", () => { $("#offline-indicator").hidden = false; });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (!$("#transaction-modal").hidden) closeTransactionModal();
                if (!$("#auth-modal").hidden && currentUser) hideAuth();
                closeUserMenu();
                closeSidebar();
            }
        });
    }

    function closeUserMenu() {
        const dropdown = $(".user-dropdown");
        if (dropdown) dropdown.hidden = true;
        const trigger = $(".user-menu-trigger");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
    }

    async function init() {
        if (!window.ArtaUnhStore || !window.ArtaUnhStore.client) {
            const content = $("#loading-screen .loading-content");
            if (content) {
                content.innerHTML = '<img class="loading-logo" src="assets/logo-icon.webp" alt="" width="52" height="52">' +
                    '<span class="loading-text">Konfigurasi Supabase belum diisi</span>' +
                    '<p style="max-width:320px;text-align:center;opacity:.75;margin-top:8px">Isi url dan anonKey di <b>js/supabase-config.js</b>, lalu muat ulang halaman.</p>';
            }
            return;
        }
        bootAuth();
        bindGlobal();
        bindTransactionModal();
        bindTransactionTable();
        bindBudgets();
        bindSettings();
        Store.setErrorHandler((msg) => showToast(msg, "error"));
        applyTheme(settings().darkMode);
        if (!navigator.onLine) $("#offline-indicator").hidden = false;

        let user = null;
        try { user = await Auth.currentUser(); }
        catch (e) { console.error("[ArtaUnh] Gagal memulihkan sesi", e); }

        $("#loading-screen").hidden = true;
        if (user) startApp(user);
        else showAuth("login");
        refreshIcons();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
