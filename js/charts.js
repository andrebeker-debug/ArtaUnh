(function (global) {
    "use strict";

    const Store = global.ArtaUnhStore;

    function cssVar(name, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name);
        return (v && v.trim()) || fallback;
    }

    function palette() {
        return {
            primary: cssVar("--color-primary", "#533afd"),
            income: cssVar("--color-income", "#12b76a"),
            expense: cssVar("--color-expense", "#f04438"),
            text: cssVar("--color-text-secondary", "#475467"),
            grid: cssVar("--color-border", "#e6e8f0"),
            surface: cssVar("--color-surface", "#ffffff"),
        };
    }

    function destroy(canvas) {
        if (!canvas) return;
        const existing = global.Chart && global.Chart.getChart ? global.Chart.getChart(canvas) : null;
        if (existing) existing.destroy();
    }

    function fmt(n) {
        return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
    }

    function monthKey(dateStr) { return String(dateStr).slice(0, 7); }
    function shortMonth(key) {
        const [y, m] = key.split("-");
        const names = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        return names[Number(m) - 1] + " " + String(y).slice(2);
    }

    function renderExpenseChart(canvas, legendEl, transactions, period) {
        if (!canvas || !global.Chart) return;
        const rows = transactions.filter((t) => t.type === "expense" && (!period || Store.withinPeriod(t.date, period)));
        const byCat = {};
        rows.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
        const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const labels = entries.map((e) => e[0]);
        const values = entries.map((e) => e[1]);
        const total = values.reduce((a, b) => a + b, 0) || 0;

        destroy(canvas);
        if (!labels.length) { canvas.style.display = "none"; if (legendEl) legendEl.innerHTML = emptyMsg(); return; }
        canvas.style.display = "block";

        const colors = labels.map((_, i) => Store.CATEGORY_COLORS[i % Store.CATEGORY_COLORS.length]);
        const p = palette();

        const totalLabel = {
            id: "expenseTotalLabel",
            afterDraw(chart) {
                const area = chart.chartArea;
                if (!area) return;
                const ctx = chart.ctx;
                const x = (area.left + area.right) / 2;
                const y = (area.top + area.bottom) / 2;
                ctx.save();
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = cssVar("--color-text-tertiary", "#7d7568");
                ctx.font = "600 10px " + cssVar("--font-sans", "sans-serif");
                ctx.fillText("TOTAL", x, y - 15);
                ctx.fillStyle = cssVar("--color-text", "#17130f");
                ctx.font = "700 17px " + cssVar("--font-mono", "monospace");
                ctx.fillText("Rp " + fmt(total), x, y + 5);
                ctx.restore();
            },
        };

        const chart = new global.Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: p.surface,
                    borderWidth: 2,
                    hoverOffset: 10,
                    spacing: 2,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: "68%",
                layout: { padding: 6 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                const pct = total ? Math.round((c.parsed / total) * 100) : 0;
                                return " Rp " + fmt(c.parsed) + "  •  " + pct + "%";
                            },
                        },
                    },
                },
            },
            plugins: [totalLabel],
        });

        if (legendEl) {
            legendEl.innerHTML = labels.map((l, i) => {
                const pct = total ? Math.round((values[i] / total) * 100) : 0;
                return `<div class="legend-item" data-index="${i}" title="${escapeHtml(l)}">` +
                    `<span class="legend-swatch" style="background:${colors[i]}"></span>` +
                    `<span class="legend-meta">` +
                    `<span class="legend-name">${escapeHtml(l)}</span>` +
                    `<span class="legend-amount">Rp ${fmt(values[i])} · ${pct}%</span>` +
                    `</span></div>`;
            }).join("");

            Array.from(legendEl.children).forEach((el) => {
                const i = Number(el.dataset.index);
                el.addEventListener("mouseenter", () => {
                    el.classList.add("active");
                    chart.setActiveElements([{ datasetIndex: 0, index: i }]);
                    chart.update();
                });
                el.addEventListener("mouseleave", () => {
                    el.classList.remove("active");
                    chart.setActiveElements([]);
                    chart.update();
                });
            });
        }
    }

    function renderTrendChart(canvas, transactions, months) {
        if (!canvas || !global.Chart) return;
        months = months || 6;
        const now = new Date();
        const keys = [];
        for (let i = months - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            keys.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
        }
        const income = keys.map((k) => 0);
        const expense = keys.map((k) => 0);
        transactions.forEach((t) => {
            const idx = keys.indexOf(monthKey(t.date));
            if (idx === -1) return;
            if (t.type === "income") income[idx] += t.amount; else expense[idx] += t.amount;
        });

        const p = palette();
        destroy(canvas);
        new global.Chart(canvas.getContext("2d"), {
            type: "line",
            data: {
                labels: keys.map(shortMonth),
                datasets: [
                    { label: "Pemasukan", data: income, borderColor: p.income, backgroundColor: "rgba(18,183,106,0.12)", fill: true, tension: 0.35, borderWidth: 2, pointRadius: 3, pointBackgroundColor: p.income },
                    { label: "Pengeluaran", data: expense, borderColor: p.expense, backgroundColor: "rgba(240,68,56,0.12)", fill: true, tension: 0.35, borderWidth: 2, pointRadius: 3, pointBackgroundColor: p.expense },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, color: p.text } },
                    tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": Rp " + fmt(c.parsed.y) } },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: p.text } },
                    y: { beginAtZero: true, grid: { color: p.grid }, ticks: { color: p.text, callback: (v) => fmt(v) } },
                },
            },
        });
    }

    function renderMonthlyChart(canvas, transactions, year, monthIndex) {
        if (!canvas || !global.Chart) return;
        const inMonth = monthIndex != null ? transactions.filter((t) => {
            const d = new Date(t.date + "T00:00:00");
            return d.getFullYear() === year && d.getMonth() === monthIndex;
        }) : transactions.filter((t) => new Date(t.date + "T00:00:00").getFullYear() === year);

        const p = palette();
        let income = 0, expense = 0;
        inMonth.forEach((t) => { if (t.type === "income") income += t.amount; else expense += t.amount; });

        destroy(canvas);
        new global.Chart(canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: ["Pemasukan", "Pengeluaran"],
                datasets: [{ data: [income, expense], backgroundColor: [p.income, p.expense], borderRadius: 8, maxBarThickness: 80 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " Rp " + fmt(c.parsed.y) } } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: p.text } },
                    y: { beginAtZero: true, grid: { color: p.grid }, ticks: { color: p.text, callback: (v) => fmt(v) } },
                },
            },
        });
    }

    function renderCashflowChart(canvas, transactions, period) {
        if (!canvas || !global.Chart) return;
        const rows = transactions.filter((t) => !period || Store.withinPeriod(t.date, period));
        const byDay = {};
        rows.forEach((t) => {
            byDay[t.date] = byDay[t.date] || { income: 0, expense: 0 };
            byDay[t.date][t.type] += t.amount;
        });
        const days = Object.keys(byDay).sort();
        const income = days.map((d) => byDay[d].income);
        const expense = days.map((d) => byDay[d].expense);

        const p = palette();
        destroy(canvas);
        if (!days.length) { canvas.style.display = "none"; return; }
        canvas.style.display = "block";
        new global.Chart(canvas.getContext("2d"), {
            type: "line",
            data: {
                labels: days.map((d) => d.slice(8) + "/" + d.slice(5, 7)),
                datasets: [
                    { label: "Pemasukan", data: income, borderColor: p.income, backgroundColor: "rgba(18,183,106,0.15)", fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0 },
                    { label: "Pengeluaran", data: expense, borderColor: p.expense, backgroundColor: "rgba(240,68,56,0.15)", fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0 },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, color: p.text } },
                    tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": Rp " + fmt(c.parsed.y) } },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: p.text, maxRotation: 0, autoSkip: true } },
                    y: { beginAtZero: true, grid: { color: p.grid }, ticks: { color: p.text, callback: (v) => fmt(v) } },
                },
            },
        });
    }

    function destroyAll(canvases) {
        (canvases || []).forEach((c) => destroy(c));
    }

    function emptyMsg() {
        return '<div class="legend-item" style="width:100%;justify-content:center;color:var(--color-text-tertiary)">Belum ada data untuk periode ini</div>';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    global.ArtaUnhCharts = { renderExpenseChart, renderTrendChart, renderMonthlyChart, renderCashflowChart, destroyAll };
})(window);
