// Global State Variables
let currentUser = null;
let currentMonth = "";
let categoryPieChartInstance = null;
let trendChartInstance = null;
let guardianChartInstance = null;
let loadedBills = [];
let notifiedBills = new Set();
let billCheckIntervalId = null;
let availableCategories = ["Housing", "Food", "Transportation", "Utilities", "Healthcare", "Entertainment", "Savings", "Emergency Fund"];

// Helper: Show Floating Toast Alerts
function showToast(message, isError = false) {
    const toast = document.getElementById("toast-notification");
    const toastMsg = document.getElementById("toast-message");
    
    toast.style.border = isError ? "1px solid var(--danger)" : "1px solid var(--primary)";
    toastMsg.textContent = message;
    
    toast.style.display = "block";
    setTimeout(() => {
        toast.style.display = "none";
    }, 4000);
}

// Helper: Headers containing Auth JWT token
function getAuthHeaders(contentType = "application/json") {
    const headers = {};
    const token = localStorage.getItem("token");
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    if (contentType) {
        headers["Content-Type"] = contentType;
    }
    return headers;
}

// Startup Initialization
document.addEventListener("DOMContentLoaded", () => {
    initMonthSelector();
    checkAuthSession();
    setupEventHandlers();
});

// Populate global month selector drop-down (current month + 6 months history + 2 months future)
function initMonthSelector() {
    const select = document.getElementById("global-month-select");
    select.innerHTML = "";
    
    const today = new Date();
    const activeYear = today.getFullYear();
    const activeMonth = today.getMonth(); // 0-indexed
    
    // YYYY-MM format for current month
    const currentMonthStr = `${activeYear}-${String(activeMonth + 1).padStart(2, '0')}`;
    currentMonth = currentMonthStr;
    
    // Generate list from 6 months ago to 2 months ahead
    for (let i = -6; i <= 2; i++) {
        const d = new Date(activeYear, activeMonth + i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const value = `${y}-${m}`;
        
        const option = document.createElement("option");
        option.value = value;
        option.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (value === currentMonthStr) {
            option.selected = true;
        }
        select.appendChild(option);
    }
}

// Session Checker on boot
async function checkAuthSession() {
    const token = localStorage.getItem("token");
    if (!token) {
        showScreen("auth");
        return;
    }
    
    try {
        const res = await fetch("/api/auth/profile", {
            method: "GET",
            headers: getAuthHeaders()
        });
        
        if (res.ok) {
            currentUser = await res.json();
            loginSuccessActions();
        } else {
            // Token expired or invalid
            localStorage.removeItem("token");
            showScreen("auth");
        }
    } catch (e) {
        showToast("Unable to connect to financial server. Running in offline/cached view.", true);
        showScreen("auth");
    }
}

// Configure Layout elements after successful login
function loginSuccessActions() {
    showScreen("app");
    document.getElementById("profile-name").textContent = currentUser.username;
    document.getElementById("profile-email").textContent = currentUser.email;
    document.getElementById("avatar-letter").textContent = currentUser.username.charAt(0).toUpperCase();
    document.getElementById("screen-subtitle").textContent = `Welcome back, ${currentUser.username}!`;
    
    // Pre-fill user details update inputs
    document.getElementById("param-salary").value = currentUser.monthly_salary;
    document.getElementById("param-savings-goal").value = currentUser.savings_goal;
    document.getElementById("param-family").value = currentUser.family_info || "";
    
    loadDashboardData();
    initDailyReminder(); // Check if 8 PM reminder should show
    startRealTimeBillReminderCheck();
}

// Navigation and Layout Control
function showScreen(type) {
    if (type === "auth") {
        document.getElementById("auth-screen").style.display = "flex";
        document.getElementById("app-screen").style.display = "none";
    } else {
        document.getElementById("auth-screen").style.display = "none";
        document.getElementById("app-screen").style.display = "flex";
    }
}

// Tab Switching
const screens = ["dashboard", "budget", "expenses", "bills", "reports", "advisor", "payments"];
function activateScreen(screenName) {
    // Set headers
    const screenTitles = {
        "dashboard": "Dashboard",
        "budget": "Budget Planner",
        "expenses": "Expenses Tracker",
        "bills": "Bill Reminders",
        "reports": "Financial Reports",
        "advisor": "AI Financial Advisor",
        "payments": "Virtual Bank"
    };
    
    document.getElementById("screen-title").textContent = screenTitles[screenName];
    
    // Switch navigation elements
    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.remove("active");
        if (item.getAttribute("data-screen") === screenName) {
            item.classList.add("active");
        }
    });
    
    // Toggle displays
    screens.forEach(screen => {
        const el = document.getElementById(`screen-${screen}`);
        if (screen === screenName) {
            el.classList.add("active-screen");
        } else {
            el.classList.remove("active-screen");
        }
    });
    
    // Load content dynamically for that screen
    if (screenName === "dashboard") loadDashboardData();
    else if (screenName === "budget") loadBudgetPlannerData();
    else if (screenName === "expenses") loadExpensesTrackerData();
    else if (screenName === "bills") loadBillsData();
    else if (screenName === "reports") loadReportsData();
    else if (screenName === "advisor") loadAdvisorScreenData();
    else if (screenName === "payments") loadPaymentsScreenData();
}


// --- DATA FETCHES & API TRIGGERS ---

// Load Dashboard Screen data
async function loadDashboardData() {
    try {
        // 1. Fetch Expenses Summary Comparison
        const summaryRes = await fetch(`/api/expenses/summary?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (!summaryRes.ok) throw new Error("Failed summary fetch");
        const summary = await summaryRes.json();
        
        // Populate Top Widgets
        document.getElementById("card-salary").textContent = `₹${summary.monthly_salary.toLocaleString('en-IN')}`;
        document.getElementById("card-spent").textContent = `₹${summary.total_spent.toLocaleString('en-IN')}`;
        
        const remaining = summary.remaining_salary;
        const remainingCard = document.getElementById("card-remaining");
        const remainingDesc = document.getElementById("card-remaining-desc");
        const remainingIcon = document.getElementById("card-remaining-icon");
        
        remainingCard.textContent = `₹${remaining.toLocaleString('en-IN')}`;
        
        if (remaining < 0) {
            remainingDesc.textContent = "Deficit: Budget exceeded";
            remainingDesc.className = "stat-desc danger-text";
            remainingIcon.className = "stat-icon danger-bg";
            remainingIcon.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
        } else {
            remainingDesc.textContent = "Remaining safe balance";
            remainingDesc.className = "stat-desc success-text";
            remainingIcon.className = "stat-icon success-bg";
            remainingIcon.innerHTML = `<i class="fa-solid fa-scale-balanced"></i>`;
        }
        
        // Savings Progress card calculations
        const goal = currentUser.savings_goal;
        document.getElementById("card-savings-goal").textContent = `Goal: ₹${goal.toLocaleString('en-IN')}`;
        
        const pctSaved = goal > 0 ? Math.min(Math.round((remaining / goal) * 100), 100) : 0;
        document.getElementById("card-savings-progress").textContent = goal > 0 ? `${Math.max(0, pctSaved)}%` : "0%";
        
        // 2. Fetch Active Alerts (Due bills + Budget overruns)
        const alertsRes = await fetch(`/api/bills/alerts`, { headers: getAuthHeaders() });
        const alerts = alertsRes.ok ? await alertsRes.json() : [];
        
        // Fetch Bank Balance and Savings Deficit Alerts
        const balanceRes = await fetch("/api/payments/balance", { headers: getAuthHeaders() });
        let bankBalance = 0;
        let savingsAlert = null;
        if (balanceRes.ok) {
            const balData = await balanceRes.json();
            bankBalance = balData.bank_balance;
            savingsAlert = balData.savings_alert;
        }
        
        document.getElementById("card-bank-balance").textContent = `₹${bankBalance.toLocaleString('en-IN')}`;
        
        const balanceDesc = document.getElementById("card-bank-balance-desc");
        const balanceIcon = document.getElementById("card-bank-balance-icon");
        
        if (savingsAlert) {
            balanceDesc.textContent = "Deficit: Savings breached";
            balanceDesc.className = "stat-desc danger-text";
            balanceIcon.className = "stat-icon danger-bg";
            
            alerts.push({
                type: "savings_consumed",
                message: `⚠ ${savingsAlert}`,
                isDanger: true
            });
        } else {
            balanceDesc.textContent = "Virtual account funds";
            balanceDesc.className = "stat-desc";
            balanceIcon.className = "stat-icon info-bg";
        }

        // ── Fixed vs flexible category classification (mirrors backend rules) ──
        const FIXED_KW = ["housing","rent","emi","mortgage","insurance","loan","internet",
                          "broadband","utilities","electricity","water","gas","school fees",
                          "tuition","college fees","subscriptions","gym","emergency fund","savings"];
        function isCatFixed(name) {
            const k = name.toLowerCase();
            return FIXED_KW.some(kw => k === kw || k.includes(kw));
        }

        // Check for budget Category alerts with proper fixed/flexible logic
        summary.comparison.forEach(item => {
            const spent = item.spent;
            const alloc = item.allocated;
            if (alloc <= 0) return;

            const pct = (spent / alloc) * 100;
            const fixed = isCatFixed(item.category);

            if (spent > alloc) {
                // TRUE overspend — alert for ALL categories
                alerts.push({
                    type: "budget_exceeded",
                    message: `⚠ ${item.category} budget exceeded by ₹${item.exceeded_by.toLocaleString('en-IN')}`,
                    isDanger: true
                });
            } else if (!fixed && pct >= 80 && pct < 100) {
                // Near-limit warning — flexible categories only
                const remaining = Math.round(alloc - spent);
                alerts.push({
                    type: "near_limit",
                    message: `🟡 ${item.category} at ${Math.round(pct)}% — ₹${remaining.toLocaleString('en-IN')} remaining`,
                    isDanger: false
                });
            }
            // Fixed at 100% → no alert (planned payment completed)
        });

        
        // Check if savings target was not achieved (only show if it's the current month and remaining balance is lower)
        const todayStr = new Date().toISOString().slice(0,7);
        if (goal > 0 && currentMonth === todayStr && remaining < goal) {
            alerts.push({
                type: "savings_lagging",
                message: `⚠ Monthly savings target not achieved (₹${(goal - remaining).toLocaleString('en-IN')} short)`,
                isDanger: false
            });
        }
        
        const alertListEl = document.getElementById("dashboard-alerts-list");
        const alertCardEl = document.getElementById("dashboard-alerts-card");
        alertListEl.innerHTML = "";

        if (alerts.length > 0) {
            alertCardEl.style.display = "block";
            alerts.forEach(alert => {
                const div = document.createElement("div");
                div.className = alert.isDanger || alert.type === "bill_overdue" || alert.type === "savings_consumed" ? "alert-item danger-alert" : "alert-item";
                div.innerHTML = `<span>${alert.message}</span>`;
                alertListEl.appendChild(div);
            });
        } else {
            alertCardEl.style.display = "none";
        }
        
        // --- Smart Financial Guardian ---
        try {
            const guardianRes = await fetch("/api/analysis/daily", { headers: getAuthHeaders() });
            if (guardianRes.ok) {
                const gData = await guardianRes.json();
                
                // Update Badge
                const badgeEl = document.getElementById("guardian-risk-badge");
                badgeEl.textContent = `${gData.overspending_risk_level} Risk`;
                badgeEl.className = `risk-badge risk-${gData.overspending_risk_level}`;

                // Update Metrics
                document.getElementById("guardian-safe-daily").textContent = `₹${gData.safe_daily_budget.toLocaleString('en-IN')}`;
                document.getElementById("guardian-actual-daily").textContent = `₹${gData.daily_average.toLocaleString('en-IN')}`;
                document.getElementById("guardian-predicted-total").textContent = `₹${gData.projected_month_total.toLocaleString('en-IN')}`;
                
                let extDate = gData.estimated_exhaustion_date;
                if(extDate.length === 10) extDate = extDate; // YYYY-MM-DD
                document.getElementById("guardian-exhaustion-date").textContent = extDate;
                if(gData.overspending_risk_level === "High") {
                    document.getElementById("guardian-exhaustion-date").style.color = "var(--danger)";
                } else {
                    document.getElementById("guardian-exhaustion-date").style.color = "white";
                }

                // Update Progress Bar
                document.getElementById("guardian-util-pct").textContent = `${gData.budget_pct_used}%`;
                const barEl = document.getElementById("guardian-util-bar");
                barEl.style.width = `${Math.min(gData.budget_pct_used, 100)}%`;
                if (gData.budget_pct_used >= 100) {
                    barEl.className = "guardian-progress-bar danger";
                } else if (gData.budget_pct_used >= 85) {
                    barEl.className = "guardian-progress-bar warning";
                } else {
                    barEl.className = "guardian-progress-bar success";
                }

                // Draw Chart
                const ctx = document.getElementById('guardianChart');
                if (guardianChartInstance) guardianChartInstance.destroy();

                guardianChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['Spending Trajectory'],
                        datasets: [
                            {
                                label: 'Current Spent',
                                data: [gData.month_total_spent],
                                backgroundColor: 'rgba(99, 102, 241, 0.8)',
                                borderRadius: 4,
                            },
                            {
                                label: 'Predicted (Month-End)',
                                data: [gData.projected_month_total - gData.month_total_spent],
                                backgroundColor: 'rgba(129, 140, 248, 0.3)',
                                borderRadius: 4,
                            },
                            {
                                label: 'Total Budget',
                                data: [Math.max(0, gData.monthly_budget - gData.projected_month_total)],
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                borderColor: 'rgba(16, 185, 129, 0.5)',
                                borderWidth: 1,
                                borderDash: [5, 5],
                                borderRadius: 4,
                            }
                        ]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: true, position: 'bottom', labels: { color: 'rgba(255,255,255,0.7)', font: { size: 11, family: 'Inter' } } },
                            tooltip: { mode: 'index', intersect: false }
                        },
                        scales: {
                            x: {
                                stacked: true,
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: 'rgba(255,255,255,0.5)', callback: (val) => '₹' + val }
                            },
                            y: {
                                stacked: true,
                                grid: { display: false },
                                ticks: { display: false }
                            }
                        }
                    }
                });
            }
        } catch(e) {
            console.error("Failed to load Guardian stats", e);
        }

        // 3. Render Visual Summary from budget plan (not expense totals)
        const budgetRes = await fetch(`/api/budget/plan?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (budgetRes.ok) {
            const budgets = await budgetRes.json();
            const spentByCategory = {};
            summary.comparison.forEach(c => { spentByCategory[c.category] = c.spent; });
            const chartData = budgets.map(b => ({
                category:   b.category_name,
                allocated:  b.allocated_amount,
                percentage: b.percentage,
                spent:      spentByCategory[b.category_name] || 0
            }));
            renderCategoryPieChart(chartData);
        } else {
            renderCategoryPieChart(summary.comparison);
        }
        
        // 4. Fetch Spending Suggestions
        loadSuggestions();
        
        // 5. Shortlist upcoming bills
        loadUpcomingBillsDashboard(alerts);
        
    } catch (e) {
        showToast("Error retrieving financial dashboard details", true);
    }
}

// Helper: convert 6-digit hex colour to rgba() string
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────
//  Visual Summary — doughnut chart sized by budget allocation plan
//  Slice widths and legend reflect the Budget Allocations panel.
// ─────────────────────────────────────────────────────────────────
function renderCategoryPieChart(comparison) {
    const canvas = document.getElementById("categoryPieChart");
    if (!canvas) return;

    if (categoryPieChartInstance) {
        categoryPieChartInstance.destroy();
        categoryPieChartInstance = null;
    }

    const cats = comparison.filter(c => c.allocated > 0);

    if (cats.length === 0) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#64748b";
        ctx.font = "14px Plus Jakarta Sans";
        ctx.textAlign = "center";
        ctx.fillText("Set up your Budget Plan to see the chart", canvas.width / 2, canvas.height / 2);
        return;
    }

    const CATEGORY_COLORS = {
        "Housing":         "#6366f1",
        "Food":            "#10b981",
        "Transportation":  "#f59e0b",
        "Utilities":       "#38bdf8",
        "Healthcare":      "#f472b6",
        "Entertainment":   "#a78bfa",
        "Savings":         "#2dd4bf",
        "Emergency Fund":  "#fb923c"
    };
    const fallbackPalette = ["#6366f1","#10b981","#f59e0b","#38bdf8","#f472b6","#a78bfa","#2dd4bf","#fb923c"];
    const colorFor = (name, i) => CATEGORY_COLORS[name] || fallbackPalette[i % fallbackPalette.length];

    const labels        = cats.map(c => c.category);
    const allocated     = cats.map(c => c.allocated);
    const solidColors   = cats.map((c, i) => colorFor(c.category, i));
    const darkBorder    = "rgba(11,19,41,0.7)";

    const legendLabels = cats.map((c, i) => ({
        text:        `${c.category}   ₹${c.allocated.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${c.percentage}%)`,
        fillStyle:   colorFor(c.category, i),
        strokeStyle: "transparent",
        lineWidth:   0,
        hidden:      false,
        index:       i
    }));

    categoryPieChartInstance = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                label:           "Budget Plan",
                data:            allocated,
                backgroundColor: solidColors,
                borderColor:     darkBorder,
                borderWidth:     2,
                hoverOffset:     8
            }]
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            animation:           { animateRotate: true, duration: 800, easing: "easeInOutQuart" },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color:         "#94a3b8",
                        font:          { family: "Plus Jakarta Sans", size: 12 },
                        padding:       14,
                        boxWidth:      14,
                        boxHeight:     14,
                        usePointStyle: true,
                        pointStyle:    "rectRounded",
                        generateLabels: () => legendLabels
                    }
                },
                tooltip: {
                    backgroundColor: "rgba(11,19,41,0.96)",
                    borderColor:     "rgba(255,255,255,0.1)",
                    borderWidth:     1,
                    padding:         13,
                    callbacks: {
                        title: (items) => items[0].label,
                        label: (ctx) => {
                            const cat = cats[ctx.dataIndex];
                            if (!cat) return "";
                            const spent = cat.spent || 0;
                            const usedPct = cat.allocated > 0
                                ? Math.round((spent / cat.allocated) * 100)
                                : 0;
                            return [
                                `  Budget: ₹${cat.allocated.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${cat.percentage}%)`,
                                `  Spent:  ₹${spent.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${usedPct}% used)`
                            ];
                        }
                    }
                }
            },
            cutout: "55%"
        }
    });
}



// Fetch spending suggestions from router

async function loadSuggestions() {
    const listEl = document.getElementById("dashboard-suggestions-list");
    listEl.innerHTML = "<p style='color:var(--text-muted);font-size:13px;'>Analyzing trends...</p>";
    
    try {
        const res = await fetch(`/api/suggestions/?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        listEl.innerHTML = "";
        if (data.suggestions.length === 0) {
            listEl.innerHTML = "<div class='suggestion-card success'><p style='font-size:13px;'>All budgets on track — no alerts this month!</p></div>";
            return;
        }
        
        data.suggestions.forEach(item => {
            const card = document.createElement("div");
            card.className = `suggestion-card ${item.type}`;

            // Icon per type
            const iconMap = {
                danger:  '<i class="fa-solid fa-triangle-exclamation"></i>',
                warning: '<i class="fa-solid fa-clock"></i>',
                success: '<i class="fa-solid fa-circle-check"></i>',
                info:    '<i class="fa-solid fa-lightbulb"></i>',
            };
            // Status label badge
            const labelMap = {
                danger:  '🔴 Budget Exceeded',
                warning: '🟡 Near Budget Limit',
                success: '🟢 Budget Completed',
                info:    '💡 On Track',
            };

            const icon  = iconMap[item.type]  || iconMap.info;
            const label = labelMap[item.type] || '';

            card.innerHTML = `
                <div class="suggestion-icon">${icon}</div>
                <div class="suggestion-content">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                        <h4 style="margin:0;">${item.category}</h4>
                        <span class="suggestion-status-badge ${item.type}">${label}</span>
                    </div>
                    <p>${item.message}</p>
                </div>
            `;
            listEl.appendChild(card);
        });
    } catch (e) {
        listEl.innerHTML = "<p style='color:var(--danger);font-size:13px;'>Error generating suggestions.</p>";
    }
}


// Load small list of pending bill reminders on dashboard
async function loadUpcomingBillsDashboard(alerts) {
    const listEl = document.getElementById("dashboard-upcoming-bills");
    listEl.innerHTML = "";
    
    // Filter bill alerts
    const billAlerts = alerts.filter(a => a.type === "bill_upcoming" || a.type === "bill_overdue");
    
    if (billAlerts.length === 0) {
        listEl.innerHTML = "<p style='color:var(--text-muted);font-size:13.5px;padding: 4px 8px;'>No upcoming pending bills.</p>";
        return;
    }
    
    // Show top 3
    billAlerts.slice(0, 3).forEach(alert => {
        const div = document.createElement("div");
        div.className = alert.type === "bill_overdue" ? "alert-item danger-alert" : "alert-item";
        div.style.animation = "none";
        div.innerHTML = `<span>${alert.message} - <strong>₹${alert.amount.toLocaleString('en-IN')}</strong></span>`;
        listEl.appendChild(div);
    });
}

// --- BUDGET PLANNER SECTION ---

async function loadBudgetPlannerData() {
    try {
        const res = await fetch(`/api/budget/plan?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error();
        const budgets = await res.json();
        
        renderBudgetSliders(budgets);
    } catch (e) {
        showToast("Error retrieving budget planner details", true);
    }
}

// Create percentage sliders dynamically for category edits
function renderBudgetSliders(budgets) {
    const container = document.getElementById("budget-sliders-container");
    container.innerHTML = "";
    
    budgets.forEach(b => {
        const item = document.createElement("div");
        item.className = "budget-slider-item";
        
        item.innerHTML = `
            <div class="slider-info">
                <span>${b.category_name}</span>
                <span class="slider-val-info" id="val-info-${b.category_name}">₹${b.allocated_amount.toLocaleString('en-IN')} (${b.percentage}%)</span>
            </div>
            <div class="slider-input-container">
                <input type="range" class="budget-slider" 
                       id="slider-${b.category_name}" 
                       data-category="${b.category_name}" 
                       min="0" max="100" step="0.5" 
                       value="${b.percentage}">
                <input type="number" class="slider-percent-input" 
                       id="pct-input-${b.category_name}" 
                       min="0" max="100" step="0.5" 
                       value="${b.percentage}">
            </div>
        `;
        container.appendChild(item);
        
        // Link slider and input together
        const slider = item.querySelector(`input[type="range"]`);
        const numInput = item.querySelector(`input[type="number"]`);
        
        slider.addEventListener("input", (e) => {
            numInput.value = e.target.value;
            recalculateSliderAllocations();
        });
        
        numInput.addEventListener("input", (e) => {
            slider.value = e.target.value;
            recalculateSliderAllocations();
        });
    });
    
    recalculateSliderAllocations();
}

// Real-time updates of slider percentages and allocations
function recalculateSliderAllocations() {
    const salary = currentUser ? currentUser.monthly_salary : 0;
    // Scope to budget container only — the Advisor simulator also uses .budget-slider
    const sliders = document.querySelectorAll("#budget-sliders-container .budget-slider");
    
    let totalPct = 0;
    
    sliders.forEach(slider => {
        const cat = slider.getAttribute("data-category");
        if (!cat) return; // skip sliders without a category
        const pct = parseFloat(slider.value) || 0;
        totalPct += pct;
        
        // Update label text
        const amt = roundVal((pct / 100.0) * salary);
        const label = document.getElementById(`val-info-${cat}`);
        if (label) label.textContent = `₹${amt.toLocaleString('en-IN')} (${pct}%)`;
    });
    
    // Update total bar details
    const totalBadge = document.getElementById("total-allocated-percentage");
    const progress = document.getElementById("budget-allocation-progress");
    
    if (totalBadge) totalBadge.textContent = `${totalPct.toFixed(1)}%`;
    
    // Set widths and colors
    if (progress) progress.style.width = `${Math.min(totalPct, 100)}%`;
    if (Math.abs(totalPct - 100) < 0.1) {
        if (totalBadge) totalBadge.className = "total-pct-badge success-bg";
        if (progress) progress.className = "progress-bar success-bar";
    } else {
        if (totalBadge) totalBadge.className = "total-pct-badge danger-bg";
        if (progress) progress.className = "progress-bar danger-bar";
    }
}

function roundVal(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

// Set slider layouts to default recommended ratios
async function resetBudgetToDefaults() {
    try {
        const res = await fetch(`/api/budget/recommend`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        // Loop recommended percentages back to input boxes
        data.recommendations.forEach(rec => {
            const slider = document.getElementById(`slider-${rec.category_name}`);
            const input = document.getElementById(`pct-input-${rec.category_name}`);
            
            if (slider && input) {
                slider.value = rec.percentage;
                input.value = rec.percentage;
            }
        });
        
        recalculateSliderAllocations();
        showToast("Ratios reset to default allocations. Save when ready.");
    } catch (e) {
        showToast("Error retrieving allocations", true);
    }
}

// --- EXPENSES TRACKER SECTION ---

async function loadExpensesTrackerData() {
    // Populate expense category modal selector dropdown
    const select = document.getElementById("expense-category");
    select.innerHTML = "";
    
    try {
        // Fetch categories available from current budget
        const budgetRes = await fetch(`/api/budget/plan?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        let categories = availableCategories;
        if (budgetRes.ok) {
            const budgets = await budgetRes.json();
            categories = budgets.map(b => b.category_name);
        }
        
        categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        
        // Load Expense transactions list
        const expRes = await fetch(`/api/expenses/?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (!expRes.ok) throw new Error();
        const expenses = await expRes.json();
        
        renderExpensesTable(expenses);
    } catch (e) {
        showToast("Error loading expenses tracker", true);
    }
}

// Write transactions out to page table rows
function renderExpensesTable(expenses) {
    const tbody = document.getElementById("expenses-table-body");
    tbody.innerHTML = "";
    
    if (expenses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No expenses recorded for this month.</td></tr>`;
        return;
    }
    
    expenses.forEach(exp => {
        const tr = document.createElement("tr");
        
        const dateStr = new Date(exp.date).toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' });
        const receiptLink = exp.receipt_path 
            ? `<a href="${exp.receipt_path}" target="_blank" class="receipt-link"><i class="fa-solid fa-file-image"></i> View</a>` 
            : `<span style="color:var(--text-muted);">None</span>`;
            
        // Get badge class name based on payment method
        let badgeClass = "cash";
        const pm = exp.payment_method.toLowerCase();
        if (pm.includes("card")) badgeClass = "card";
        else if (pm.includes("upi")) badgeClass = "upi";
        else if (pm.includes("banking")) badgeClass = "netbanking";
        
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><strong>${exp.category}</strong></td>
            <td>₹${exp.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td><span class="payment-badge ${badgeClass}">${exp.payment_method}</span></td>
            <td>${exp.description || '<span style="color:var(--text-muted); font-style:italic;">N/A</span>'}</td>
            <td>${receiptLink}</td>
            <td>
                <button class="action-btn-icon danger-hover" onclick="deleteExpenseItem(${exp.id})" title="Delete Transaction">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Submit Expense Form (Multipart form)
async function submitExpenseForm(e) {
    e.preventDefault();
    
    const amount = document.getElementById("expense-amount").value;
    const category = document.getElementById("expense-category").value;
    const paymentMethod = document.getElementById("expense-payment-method").value;
    const description = document.getElementById("expense-description").value;
    const date = document.getElementById("expense-date").value;
    const receiptFile = document.getElementById("expense-receipt").files[0];
    
    // Construct FormData (required for files)
    const formData = new FormData();
    formData.append("amount", amount);
    formData.append("category", category);
    formData.append("payment_method", paymentMethod);
    formData.append("description", description);
    formData.append("date", date);
    if (receiptFile) {
        formData.append("receipt", receiptFile);
    }
    
    try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/expenses/", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
                // Note: Do NOT set Content-Type header manually when sending FormData, 
                // browser needs to generate boundary parameter
            },
            body: formData
        });
        
        if (res.ok) {
            showToast("Expense transaction recorded successfully!");
            document.getElementById("add-expense-form").reset();
            document.getElementById("add-expense-modal").style.display = "none";
            loadExpensesTrackerData();
            // Refresh daily intelligence analysis after every expense entry
            refreshDailyAnalysisIfOpen();
        } else {
            const err = await res.json();
            showToast(err.detail || "Error saving transaction details", true);
        }
    } catch (e) {
        showToast("Error processing network transaction", true);
    }
}

// Delete individual transaction
async function deleteExpenseItem(id) {
    if (!confirm("Are you sure you want to delete this expense transaction?")) return;
    
    try {
        const res = await fetch(`/api/expenses/${id}`, {
            method: "DELETE",
            headers: getAuthHeaders(null)
        });
        if (res.ok) {
            showToast("Transaction deleted.");
            loadExpensesTrackerData();
        } else {
            showToast("Error deleting item", true);
        }
    } catch (e) {
        showToast("Network error during deletion", true);
    }
}

// --- BILL REMINDERS SECTION ---

async function loadBillsData() {
    try {
        const res = await fetch("/api/bills/", {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error();
        const bills = await res.json();
        loadedBills = bills;
        renderBillsTable(bills);
    } catch (e) {
        showToast("Error fetching bill reminders", true);
    }
}

// Render bill reminders into listing
function renderBillsTable(bills) {
    const tbody = document.getElementById("bills-table-body");
    tbody.innerHTML = "";
    
    if (bills.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No bill reminders set.</td></tr>`;
        return;
    }
    
    const today = new Date();
    today.setHours(0,0,0,0);
    const now = new Date();
    
    bills.forEach(bill => {
        const tr = document.createElement("tr");
        
        const dueDate = new Date(bill.due_date);
        
        // Show Date and Time
        const dateStr = dueDate.toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' }) + 
                        ", " + 
                        dueDate.toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit', hour12: true });
        
        // Color code due date (Pending state)
        let dateClass = "";
        if (bill.status === "Pending") {
            if (now > dueDate) {
                dateClass = "danger-text";
            } else {
                const midnightDue = new Date(dueDate);
                midnightDue.setHours(0,0,0,0);
                const delta = Math.round((midnightDue - today) / (1000 * 60 * 60 * 24));
                if (delta <= 3) dateClass = "warning-text";
            }
        }
        
        const statusBadge = bill.status === "Paid" 
            ? `<span class="status-badge paid" onclick="toggleBillStatus(${bill.id}, 'Pending')" title="Mark as Pending"><i class="fa-solid fa-circle-check"></i> Paid</span>`
            : `<span class="status-badge pending" onclick="toggleBillStatus(${bill.id}, 'Paid')" title="Mark as Paid"><i class="fa-solid fa-clock"></i> Pending</span>`;
            
        tr.innerHTML = `
            <td><strong>${bill.title}</strong></td>
            <td>₹${bill.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td class="${dateClass}"><strong>${dateStr}</strong></td>
            <td>${statusBadge}</td>
            <td>
                <button class="action-btn-icon" onclick="editBillItem(${bill.id})" title="Edit Reminder" style="margin-right: 8px; color: var(--primary);">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="action-btn-icon danger-hover" onclick="deleteBillItem(${bill.id})" title="Delete Reminder">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Toggle Bill status Paid vs Pending
async function toggleBillStatus(id, newStatus) {
    try {
        const res = await fetch(`/api/bills/${id}/status?status_val=${newStatus}`, {
            method: "PATCH",
            headers: getAuthHeaders(null)
        });
        if (res.ok) {
            showToast(`Bill marked as ${newStatus}`);
            loadBillsData();
        } else {
            showToast("Error updating bill status", true);
        }
    } catch (e) {
        showToast("Network error toggle status", true);
    }
}

// Delete Bill Reminder
async function deleteBillItem(id) {
    if (!confirm("Are you sure you want to delete this bill reminder?")) return;
    try {
        const res = await fetch(`/api/bills/${id}`, {
            method: "DELETE",
            headers: getAuthHeaders(null)
        });
        if (res.ok) {
            showToast("Bill reminder deleted.");
            loadBillsData();
        } else {
            showToast("Error deleting bill reminder", true);
        }
    } catch (e) {
        showToast("Network error delete bill", true);
    }
}

// Edit Bill Reminder Modal Prepopulate
function editBillItem(id) {
    const bill = loadedBills.find(b => b.id === id);
    if (!bill) return;

    document.getElementById("edit-bill-id").value = bill.id;
    document.getElementById("edit-bill-title").value = bill.title;
    document.getElementById("edit-bill-amount").value = bill.amount;
    
    // Format bill.due_date to YYYY-MM-DDTHH:MM for datetime-local picker
    const d = new Date(bill.due_date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    document.getElementById("edit-bill-due-date").value = `${year}-${month}-${date}T${hours}:${minutes}`;
    
    document.getElementById("edit-bill-category").value = bill.category || "Other";
    document.getElementById("edit-bill-status").value = bill.status;

    document.getElementById("edit-bill-modal").style.display = "flex";
}

// Create new Bill Alert
async function submitBillForm(e) {
    e.preventDefault();
    
    const title = document.getElementById("bill-title").value;
    const amount = parseFloat(document.getElementById("bill-amount").value);
    const dueDate = document.getElementById("bill-due-date").value;
    const category = document.getElementById("bill-category").value;
    
    try {
        const res = await fetch("/api/bills/", {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
                title: title,
                amount: amount,
                due_date: dueDate,
                category: category
            })
        });
        
        if (res.ok) {
            showToast("Bill reminder configured!");
            document.getElementById("add-bill-form").reset();
            loadBillsData();
        } else {
            showToast("Error configuring reminder", true);
        }
    } catch (e) {
        showToast("Network error configuring bill", true);
    }
}

// --- REPORTS SCREEN ---

let currentReportRange = "daily";

async function loadReportsData() {
    try {
        const res = await fetch(`/api/reports/data?range_type=${currentReportRange}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        // 1. Draw Time-series Trend Graph
        renderTrendGraph(data.trend);
        
        // 2. Render summary calculations
        renderCategorySummaryTable(data.categories, data.total_spent);

        // 3. Smart Financial Guardian (Monthly only)
        const guardianContainer = document.getElementById("report-predictive-insights-container");
        if (currentReportRange === "monthly") {
            try {
                const gRes = await fetch("/api/analysis/daily", { headers: getAuthHeaders() });
                if (gRes.ok) {
                    const gData = await gRes.json();
                    guardianContainer.style.display = "grid";
                    document.getElementById("report-pred-total").textContent = `₹${gData.projected_month_total.toLocaleString('en-IN')}`;
                    document.getElementById("report-pred-overspend").textContent = gData.projected_overspend > 0 ? `₹${gData.projected_overspend.toLocaleString('en-IN')}` : "₹0";
                    document.getElementById("report-pred-overspend").style.color = gData.projected_overspend > 0 ? "var(--danger)" : "var(--success)";
                    
                    const rBadge = document.getElementById("report-pred-risk");
                    rBadge.textContent = `${gData.overspending_risk_level} Risk`;
                    rBadge.className = `risk-badge risk-${gData.overspending_risk_level}`;
                    
                    // Format a smart message
                    let msg = "";
                    if (gData.recommendations.length > 0) {
                        msg = gData.recommendations[0].message + " " + gData.recommendations[0].action;
                    } else if (gData.projected_savings > 0) {
                        msg = `You are on track to save an extra ₹${gData.projected_savings.toLocaleString('en-IN')} this month. Keep it up!`;
                    } else {
                        msg = "Spending is aligned with your budget.";
                    }
                    document.getElementById("report-pred-message").textContent = msg;
                } else {
                    guardianContainer.style.display = "none";
                }
            } catch (e) {
                guardianContainer.style.display = "none";
            }
        } else {
            guardianContainer.style.display = "none";
        }

    } catch (e) {
        showToast("Error loading financial reports", true);
    }
}

// Render Time-series Chart
function renderTrendGraph(trend) {
    const canvas = document.getElementById("reportTrendChart");
    if (!canvas) return;
    
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }
    
    if (trend.length === 0) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#64748b";
        ctx.font = "14px Plus Jakarta Sans";
        ctx.textAlign = "center";
        ctx.fillText("No transactions recorded for trend mapping", canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const labels = trend.map(item => item.label);
    const amounts = trend.map(item => item.amount);
    
    // Title mapping based on active range selection
    const titles = {
        "daily": "Daily Spendings Trend (Last 30 Days)",
        "weekly": "Weekly Spendings Trend (Last 12 Weeks)",
        "monthly": "Monthly Spendings Trend (Last 12 Months)",
        "annual": "Annual Spendings Trend (Last 5 Years)"
    };
    
    document.getElementById("report-graph-title").innerHTML = `<i class="fa-solid fa-chart-area"></i> ${titles[currentReportRange]}`;
    
    trendChartInstance = new Chart(canvas, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Expenses",
                data: amounts,
                borderColor: "#6366f1",
                backgroundColor: "rgba(99, 102, 241, 0.08)",
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: "#a855f7",
                pointBorderColor: "white",
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#94a3b8", font: { family: "Plus Jakarta Sans" } }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { 
                        color: "#94a3b8", 
                        font: { family: "Plus Jakarta Sans" },
                        callback: function(value) { return "₹" + value.toLocaleString(); }
                    }
                }
            }
        }
    });
}

// Render category-wise summary listing rows in Reports screen
function renderCategorySummaryTable(categories, totalSpent) {
    const tbody = document.getElementById("reports-category-summary-body");
    tbody.innerHTML = "";
    
    if (categories.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No transaction breakdown details available.</td></tr>`;
        return;
    }
    
    categories.forEach(cat => {
        const pct = totalSpent > 0 ? ((cat.amount / totalSpent) * 100).toFixed(1) : 0;
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${cat.category}</strong></td>
            <td>₹${cat.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>
                <div style="display:flex; align-items:center; gap: 12px;">
                    <div class="progress-bar-container" style="flex-grow:1; max-width: 150px; height: 6px;">
                        <div class="progress-bar" style="width: ${pct}%;"></div>
                    </div>
                    <span>${pct}%</span>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadAdvisorScreenData() {
    try {
        const res = await fetch(`/api/suggestions/advisor?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        // 1. Populate comparisons list
        const compList = document.getElementById("advisor-comparisons-list");
        compList.innerHTML = "";
        data.comparisons.forEach(point => {
            const li = document.createElement("li");
            li.innerHTML = `<i class="fa-solid fa-arrow-trend-up" style="color:var(--warning); margin-right:8px;"></i> ${point}`;
            compList.appendChild(li);
        });
        
        // 2. Populate reductions list
        const redList = document.getElementById("advisor-reductions-list");
        redList.innerHTML = "";
        data.reductions.forEach(point => {
            const li = document.createElement("li");
            li.innerHTML = `<i class="fa-solid fa-circle-minus" style="color:var(--danger); margin-right:8px;"></i> ${point}`;
            redList.appendChild(li);
        });
        
        // 3. Populate projections list
        const projList = document.getElementById("advisor-projections-list");
        projList.innerHTML = "";
        data.projections.forEach(point => {
            const li = document.createElement("li");
            li.innerHTML = `<i class="fa-solid fa-piggy-bank" style="color:var(--success); margin-right:8px;"></i> ${point}`;
            projList.appendChild(li);
        });
        
        // 4. Initialize simulator default savings amount
        const simSlider = document.getElementById("simulator-savings-slider");
        const simInput = document.getElementById("simulator-savings-input");
        
        const defaultVal = data.savings_goal > 0 ? data.savings_goal : 3000;
        simSlider.value = defaultVal;
        simInput.value = defaultVal;
        updateProjectionsSimulation(defaultVal);
        
    } catch (e) {
        showToast("Error retrieving financial advisor advice", true);
    }
}

function updateProjectionsSimulation(val) {
    const amount = parseFloat(val) || 0;
    document.getElementById("simulator-amount-label").textContent = `₹${amount.toLocaleString('en-IN')}`;
    
    const oneYear = amount * 12;
    const threeYears = amount * 36;
    const fiveYears = amount * 60;
    
    document.getElementById("sim-1yr").textContent = `₹${oneYear.toLocaleString('en-IN')}`;
    document.getElementById("sim-3yr").textContent = `₹${threeYears.toLocaleString('en-IN')}`;
    document.getElementById("sim-5yr").textContent = `₹${fiveYears.toLocaleString('en-IN')}`;
}

let currentBankAccount = null;

async function loadPaymentsScreenData() {
    const select = document.getElementById("pay-category");
    select.innerHTML = "";
    
    try {
        const budgetRes = await fetch(`/api/budget/plan?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        let categories = availableCategories;
        if (budgetRes.ok) {
            const budgets = await budgetRes.json();
            categories = budgets.map(b => b.category_name);
        }
        
        categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        
        // Fetch Bank Account status
        const statusRes = await fetch("/api/bank/status", { headers: getAuthHeaders() });
        if (!statusRes.ok) throw new Error();
        const statusData = await statusRes.json();
        
        const noAccountPanel = document.getElementById("bank-no-account-panel");
        const displayCard = document.getElementById("bank-account-display");
        const setupFormPanel = document.getElementById("bank-setup-form-panel");
        const paymentRow = document.getElementById("bank-payment-row");

        if (statusData.has_account) {
            currentBankAccount = statusData;
            noAccountPanel.style.display = "none";
            displayCard.style.display = "block";
            setupFormPanel.style.display = "none";
            paymentRow.style.display = "grid";

            // Update card UI values
            document.getElementById("bcard-bank-name").textContent = statusData.bank_name;
            document.getElementById("bcard-account-number").textContent = statusData.account_number_masked;
            document.getElementById("bcard-holder").textContent = statusData.account_holder;
            document.getElementById("bcard-ifsc").textContent = statusData.ifsc_code;
            document.getElementById("bcard-balance").textContent = `₹${statusData.bank_balance.toLocaleString('en-IN')}`;
            document.getElementById("bcard-salary").textContent = `₹${statusData.salary.toLocaleString('en-IN')}`;
            document.getElementById("bcard-savings-goal").textContent = `₹${statusData.savings_goal.toLocaleString('en-IN')}`;

            // Handle Savings Protection Alert display
            const savingsAlertEl = document.getElementById("bank-savings-alert");
            const savingsAlertTextEl = document.getElementById("bank-savings-alert-text");
            if (statusData.savings_alert) {
                savingsAlertEl.style.display = "block";
                savingsAlertTextEl.textContent = statusData.savings_alert;
            } else {
                savingsAlertEl.style.display = "none";
            }
        } else {
            currentBankAccount = null;
            noAccountPanel.style.display = "block";
            displayCard.style.display = "none";
            setupFormPanel.style.display = "none";
            paymentRow.style.display = "none";
        }
        
        // Fetch recent payments (expenses with merchants)
        const expRes = await fetch(`/api/expenses/?month=${currentMonth}`, {
            headers: getAuthHeaders()
        });
        if (!expRes.ok) throw new Error();
        const expenses = await expRes.json();
        
        const tbody = document.getElementById("recent-payments-tbody");
        tbody.innerHTML = "";
        
        const payExpenses = expenses.filter(exp => exp.merchant);
        if (payExpenses.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">No simulated payments yet.</td></tr>`;
            return;
        }
        
        payExpenses.forEach(exp => {
            const tr = document.createElement("tr");
            const dateStr = new Date(exp.date).toLocaleDateString("en-IN", { day: '2-digit', month: 'short' });
            tr.innerHTML = `
                <td><strong>${exp.merchant}</strong></td>
                <td><span style="font-size:12px;color:var(--text-muted);">${exp.category}</span></td>
                <td>₹${exp.amount.toLocaleString('en-IN')}</td>
                <td>${dateStr}</td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (e) {
        showToast("Error loading payments panel data", true);
    }
}

// Show Setup form in "Create" mode
function showCreateBankForm() {
    document.getElementById("bank-no-account-panel").style.display = "none";
    document.getElementById("bank-account-display").style.display = "none";
    document.getElementById("bank-setup-form-panel").style.display = "block";
    document.getElementById("bank-payment-row").style.display = "none";

    document.getElementById("bank-form-title").textContent = "Create Bank Account";
    document.getElementById("bank-form-btn-text").textContent = "Save Account";
    document.getElementById("bank-account-form").reset();
    
    // Autofill with user parameters if they exist
    if (currentUser) {
        document.getElementById("ba-account-holder").value = currentUser.username;
        document.getElementById("ba-salary").value = currentUser.monthly_salary || "";
        document.getElementById("ba-savings-goal").value = currentUser.savings_goal || "";
    }
}

// Show Setup form in "Edit" mode
function showEditBankForm() {
    if (!currentBankAccount) return;

    document.getElementById("bank-no-account-panel").style.display = "none";
    document.getElementById("bank-account-display").style.display = "none";
    document.getElementById("bank-setup-form-panel").style.display = "block";
    document.getElementById("bank-payment-row").style.display = "none";

    document.getElementById("bank-form-title").textContent = "Edit Bank Account Details";
    document.getElementById("bank-form-btn-text").textContent = "Update Account Details";

    document.getElementById("ba-bank-name").value = currentBankAccount.bank_name;
    document.getElementById("ba-account-holder").value = currentBankAccount.account_holder;
    // For account number, populate placeholder/masked or let them type new one
    document.getElementById("ba-account-number").value = "";
    document.getElementById("ba-account-number").placeholder = "Enter new or existing number";
    document.getElementById("ba-ifsc").value = currentBankAccount.ifsc_code;
    document.getElementById("ba-salary").value = currentBankAccount.salary;
    document.getElementById("ba-balance").value = currentBankAccount.bank_balance;
    document.getElementById("ba-savings-goal").value = currentBankAccount.savings_goal;
}

// Hide setup form and return to appropriate panel
function cancelBankForm() {
    document.getElementById("bank-setup-form-panel").style.display = "none";
    if (currentBankAccount) {
        document.getElementById("bank-account-display").style.display = "block";
        document.getElementById("bank-payment-row").style.display = "grid";
    } else {
        document.getElementById("bank-no-account-panel").style.display = "block";
    }
}

// Create/Update Bank Account Form Handler
async function submitBankAccountForm(e) {
    e.preventDefault();
    
    const payload = {
        bank_name: document.getElementById("ba-bank-name").value,
        account_holder: document.getElementById("ba-account-holder").value,
        account_number: document.getElementById("ba-account-number").value,
        ifsc_code: document.getElementById("ba-ifsc").value,
        balance: parseFloat(document.getElementById("ba-balance").value),
        salary: parseFloat(document.getElementById("ba-salary").value),
        savings_goal: parseFloat(document.getElementById("ba-savings-goal").value)
    };

    const isEdit = currentBankAccount !== null;

    if (isEdit && !payload.account_number) {
        // If edit and account number left blank, use current bank account number
        payload.account_number = currentBankAccount.account_number_masked.replace(/X/g, "").trim();
    }

    try {
        const url = "/api/bank/account";
        const method = isEdit ? "PUT" : "POST";

        const res = await fetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast(isEdit ? "Bank account details updated!" : "Virtual bank account created successfully!");
            // Reload user profile in memory to update dashboard widgets
            const profRes = await fetch("/api/auth/profile", { headers: getAuthHeaders() });
            if (profRes.ok) currentUser = await profRes.json();
            
            loadPaymentsScreenData();
        } else {
            const err = await res.json();
            // FastAPI validation errors return detail as an array of {loc, msg, type} objects
            let errMsg = "Error saving bank details";
            if (err.detail) {
                if (typeof err.detail === "string") {
                    errMsg = err.detail;
                } else if (Array.isArray(err.detail)) {
                    // Extract the first validation message
                    errMsg = err.detail.map(e => `${e.loc ? e.loc.join(" → ") : ""}: ${e.msg}`).join("; ");
                }
            }
            showToast(errMsg, true);
        }
    } catch (e) {
        showToast("Network error saving bank details", true);
    }
}

async function submitVirtualPayment(e) {
    e.preventDefault();
    
    const merchant = document.getElementById("pay-merchant").value;
    const category = document.getElementById("pay-category").value;
    const method = document.getElementById("pay-method").value;
    const amount = parseFloat(document.getElementById("pay-amount").value);
    const date = document.getElementById("pay-date").value;
    const desc = document.getElementById("pay-description").value;
    
    try {
        const res = await fetch("/api/payments/pay", {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
                merchant: merchant,
                category: category,
                payment_method: method,
                amount: amount,
                date: date,
                description: desc
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            showToast("Transaction authorized successfully!");
            
            if (data.budget_exceeded) {
                alert(`⚠️ BUDGET EXCEEDED!\n\n${data.budget_alert}`);
            }
            if (data.savings_alert) {
                alert(`⚠️ SAVINGS BREACH!\n\n${data.savings_alert}`);
            }
            
            document.getElementById("simulate-payment-form").reset();
            document.getElementById("pay-date").value = new Date().toISOString().slice(0, 10);
            loadPaymentsScreenData();
        } else {
            const err = await res.json();
            showToast(err.detail || "Transaction authorization declined", true);
        }
    } catch (e) {
        showToast("Network error authorizing payment", true);
    }
}


// --- EVENT HANDLERS SETUP ---



function setupEventHandlers() {
    // Navigation Screen clicks
    document.querySelectorAll(".nav-menu .nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const screen = item.getAttribute("data-screen");
            activateScreen(screen);
        });
    });
    
    // Auth screen transitions
    document.getElementById("go-to-register").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("login-card").style.display = "none";
        document.getElementById("register-card").style.display = "block";
    });
    
    document.getElementById("go-to-login").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("login-card").style.display = "block";
        document.getElementById("register-card").style.display = "none";
    });
    
    // Global Month Selection
    document.getElementById("global-month-select").addEventListener("change", (e) => {
        currentMonth = e.target.value;
        const activeNav = document.querySelector(".nav-item.active");
        if (activeNav) {
            activateScreen(activeNav.getAttribute("data-screen"));
        }
    });
    
    // Login Submit
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email").value;
        const password = document.getElementById("login-password").value;
        
        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });
            
            if (res.ok) {
                const data = await res.json();
                localStorage.setItem("token", data.access_token);
                currentUser = data.user;
                showToast("Logged in successfully!");
                loginSuccessActions();
            } else {
                const err = await res.json();
                showToast(err.detail || "Authentication failed. Check details.", true);
            }
        } catch (err) {
            showToast("Server error during login", true);
        }
    });
    
    // Register Submit
    document.getElementById("register-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("register-username").value;
        const email = document.getElementById("register-email").value;
        const password = document.getElementById("register-password").value;
        
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, email, password })
            });
            
            if (res.ok) {
                showToast("Account registered! Please login.");
                document.getElementById("register-form").reset();
                document.getElementById("register-card").style.display = "none";
                document.getElementById("login-card").style.display = "block";
            } else {
                const err = await res.json();
                showToast(err.detail || "Registration failed.", true);
            }
        } catch (err) {
            showToast("Server error during registration", true);
        }
    });
    
    // Logout Submit
    document.getElementById("logout-btn").addEventListener("click", async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch (e) {}
        
        localStorage.removeItem("token");
        currentUser = null;
        showToast("Logged out successfully.");
        showScreen("auth");
    });
    
    // Update profile parameters
    document.getElementById("profile-params-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const salary = parseFloat(document.getElementById("param-salary").value);
        const savingsGoal = parseFloat(document.getElementById("param-savings-goal").value);
        const familyInfo = document.getElementById("param-family").value;
        
        try {
            const res = await fetch("/api/auth/profile", {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    monthly_salary: salary,
                    savings_goal: savingsGoal,
                    family_info: familyInfo
                })
            });
            
            if (res.ok) {
                currentUser = await res.json();
                showToast("Financial profile parameters updated!");
                
                // Regenerate current month's budget values with new salary
                const budgetRes = await fetch(`/api/budget/plan?month=${currentMonth}`, {
                    headers: getAuthHeaders()
                });
                if (budgetRes.ok) {
                    // Fetch existing allocations
                    const currentBudgets = await budgetRes.json();
                    
                    // Put all current percentages in format
                    const updateAllocations = currentBudgets.map(b => ({
                        category_name: b.category_name,
                        percentage: b.percentage
                    }));
                    
                    // Save plan back to trigger recalculation with the new salary
                    await fetch("/api/budget/plan", {
                        method: "PUT",
                        headers: getAuthHeaders(),
                        body: JSON.stringify({
                            month: currentMonth,
                            allocations: updateAllocations
                        })
                    });
                }
                
                loadBudgetPlannerData();
            } else {
                showToast("Failed to update profile", true);
            }
        } catch (err) {
            showToast("Network error updating parameters", true);
        }
    });
    
    // Save Customized Slider Budget layout
    document.getElementById("budget-sliders-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const sliders = document.querySelectorAll("#budget-sliders-container .budget-slider");
        const allocations = [];
        let totalPct = 0;
        
        sliders.forEach(slider => {
            const cat = slider.getAttribute("data-category");
            if (!cat) return; // skip non-budget sliders
            const pct = parseFloat(slider.value) || 0;
            totalPct += pct;
            allocations.push({
                category_name: cat,
                percentage: pct
            });
        });
        
        if (Math.abs(totalPct - 100) > 0.1) {
            showToast(`Save failed: Total percentage must equal 100% (currently ${totalPct.toFixed(1)}%)`, true);
            return;
        }
        
        try {
            const res = await fetch("/api/budget/plan", {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    month: currentMonth,
                    allocations: allocations
                })
            });
            
            if (res.ok) {
                showToast("Budget allocation layout saved successfully!");
                loadBudgetPlannerData();
                if (document.getElementById("screen-dashboard")?.classList.contains("active-screen")) {
                    loadDashboardData();
                }
            } else {
                const err = await res.json();
                showToast(err.detail || "Error saving budget plan", true);
            }
        } catch (e) {
            showToast("Network error saving budget plan", true);
        }
    });
    
    // Reset budget to defaults recommendations trigger
    document.getElementById("btn-reset-default").addEventListener("click", (e) => {
        e.preventDefault();
        resetBudgetToDefaults();
    });
    
    // Modal buttons clicks
    document.getElementById("btn-add-expense-modal").addEventListener("click", () => {
        document.getElementById("expense-date").value = new Date().toISOString().slice(0, 10);
        document.getElementById("add-expense-modal").style.display = "flex";
    });
    
    document.getElementById("close-expense-modal").addEventListener("click", () => {
        document.getElementById("add-expense-modal").style.display = "none";
    });
    
    // Add Expense Submit
    document.getElementById("add-expense-form").addEventListener("submit", submitExpenseForm);
    
    // Add Bill reminder Submit
    document.getElementById("add-bill-form").addEventListener("submit", submitBillForm);
    
    // Switch to Bills view from dashboard button click
    document.getElementById("dash-go-to-bills").addEventListener("click", () => {
        activateScreen("bills");
    });
    
    // Range selector click triggers in reports
    document.querySelectorAll(".reports-tabs .tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".reports-tabs .tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentReportRange = btn.getAttribute("data-range");
            loadReportsData();
        });
    });
    
    // Download reports CSV export
    document.getElementById("btn-export-csv").addEventListener("click", () => {
        const token = localStorage.getItem("token");
        window.location.href = `/api/reports/export/csv?month=${currentMonth}&token=${token}`;
    });
    
    // Export PDF (Print page layout)
    document.getElementById("btn-export-pdf").addEventListener("click", () => {
        window.print();
    });

    // Simulator Slider and Input Events
    const simSlider = document.getElementById("simulator-savings-slider");
    const simInput = document.getElementById("simulator-savings-input");
    
    if (simSlider && simInput) {
        simSlider.addEventListener("input", (e) => {
            simInput.value = e.target.value;
            updateProjectionsSimulation(e.target.value);
        });
        
        simInput.addEventListener("input", (e) => {
            simSlider.value = e.target.value;
            updateProjectionsSimulation(e.target.value);
        });
    }

    // Virtual Payment Form Submit and Initializer
    const payForm = document.getElementById("simulate-payment-form");
    if (payForm) {
        payForm.addEventListener("submit", submitVirtualPayment);
        document.getElementById("pay-date").value = new Date().toISOString().slice(0, 10);
    }
    
    // Virtual Bank Account Setup / Edit Handlers
    const btnShowBankForm = document.getElementById("btn-show-bank-form");
    const btnEditBankAccount = document.getElementById("btn-edit-bank-account");
    const btnCancelBankForm = document.getElementById("btn-cancel-bank-form");
    const bankAccountForm = document.getElementById("bank-account-form");

    if (btnShowBankForm) {
        btnShowBankForm.addEventListener("click", showCreateBankForm);
    }
    if (btnEditBankAccount) {
        btnEditBankAccount.addEventListener("click", showEditBankForm);
    }
    if (btnCancelBankForm) {
        btnCancelBankForm.addEventListener("click", cancelBankForm);
    }
    if (bankAccountForm) {
        bankAccountForm.addEventListener("submit", submitBankAccountForm);
    }

    // Virtual Bank navigation click trigger
    document.querySelectorAll(".nav-menu .nav-item").forEach(item => {
        if (item.getAttribute("data-screen") === "payments") {
            item.addEventListener("click", () => {
                document.getElementById("pay-date").value = new Date().toISOString().slice(0, 10);
            });
        }
    });

    // Set default value for bill-due-date to current local date and time
    const billDueDateInput = document.getElementById("bill-due-date");
    if (billDueDateInput) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        billDueDateInput.value = `${year}-${month}-${date}T${hours}:${minutes}`;
    }

    // Edit Bill modal handlers
    const editBillModal = document.getElementById("edit-bill-modal");
    const closeEditBillModalBtn = document.getElementById("close-edit-bill-modal");
    if (closeEditBillModalBtn) {
        closeEditBillModalBtn.addEventListener("click", () => {
            editBillModal.style.display = "none";
        });
    }

    const editBillForm = document.getElementById("edit-bill-form");
    if (editBillForm) {
        editBillForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("edit-bill-id").value;
            const title = document.getElementById("edit-bill-title").value;
            const amount = parseFloat(document.getElementById("edit-bill-amount").value);
            const dueDate = document.getElementById("edit-bill-due-date").value;
            const category = document.getElementById("edit-bill-category").value;
            const status = document.getElementById("edit-bill-status").value;

            try {
                const res = await fetch(`/api/bills/${id}`, {
                    method: "PUT",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        title: title,
                        amount: amount,
                        due_date: dueDate,
                        category: category,
                        status: status
                    })
                });

                if (res.ok) {
                    showToast("Bill reminder updated!");
                    editBillModal.style.display = "none";
                    loadBillsData();
                    loadDashboardData();
                } else {
                    showToast("Error updating reminder", true);
                }
            } catch (err) {
                showToast("Network error updating bill", true);
            }
        });
    }
}


// ======================================================================
// DAILY INTELLIGENCE ENGINE
// ======================================================================

/**
 * Called once after login. Shows the evening reminder banner if:
 *  - Current hour >= 20 (8 PM)
 *  - User hasn't dismissed it today
 * Also wires up all banner button handlers.
 */
function initDailyReminder() {
    const banner = document.getElementById("daily-reminder-banner");
    if (!banner) return;

    const todayKey = new Date().toISOString().slice(0, 10);
    const dismissed = localStorage.getItem("finsmart_checkin_dismissed");
    const hour = new Date().getHours();

    // Show banner from 8 PM (20:00) onwards if not dismissed today
    if (hour >= 20 && dismissed !== todayKey) {
        const greetings = [
            "Good evening! Time to review your spending.",
            "It's check-in time — how did your wallet do today?",
            "Evening! Log your expenses before the day ends.",
            "Financial health check — record today's transactions!"
        ];
        const msgEl = document.getElementById("reminder-banner-time-msg");
        if (msgEl) msgEl.textContent = greetings[Math.floor(Math.random() * greetings.length)];
        banner.style.display = "block";
    }

    // Wire: Log Expenses button
    const btnLog = document.getElementById("btn-reminder-log");
    if (btnLog) {
        btnLog.onclick = () => {
            // Open add-expense modal (reuse existing flow)
            const modal = document.getElementById("add-expense-modal");
            if (modal) {
                // Pre-set date to today
                const dateEl = document.getElementById("expense-date");
                if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
                modal.style.display = "flex";
            }
        };
    }

    // Wire: View Analysis button
    const btnAnalysis = document.getElementById("btn-reminder-analysis");
    if (btnAnalysis) {
        btnAnalysis.onclick = () => loadDailyAnalysis();
    }

    // Wire: Dismiss button (snooze until tomorrow)
    const btnDismiss = document.getElementById("btn-reminder-dismiss");
    if (btnDismiss) {
        btnDismiss.onclick = () => {
            localStorage.setItem("finsmart_checkin_dismissed", todayKey);
            banner.style.display = "none";
        };
    }

    // Wire: Log Expense Now button inside the analysis modal
    const daLogBtn = document.getElementById("da-btn-log-expense");
    if (daLogBtn) {
        daLogBtn.onclick = () => {
            document.getElementById("daily-analysis-modal").style.display = "none";
            const modal = document.getElementById("add-expense-modal");
            if (modal) {
                const dateEl = document.getElementById("expense-date");
                if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
                modal.style.display = "flex";
            }
        };
    }

    // Recurring check every minute so banner appears exactly at 8 PM
    // if user has the tab open before 8 PM
    setInterval(() => {
        const nowHour = new Date().getHours();
        const nowKey  = new Date().toISOString().slice(0, 10);
        const dis = localStorage.getItem("finsmart_checkin_dismissed");
        if (nowHour >= 20 && dis !== nowKey && currentUser) {
            banner.style.display = "block";
        }
    }, 60000);
}

/**
 * Fetch /api/analysis/daily and open the analysis modal with rendered data.
 */
async function loadDailyAnalysis() {
    try {
        const res = await fetch("/api/analysis/daily", { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Analysis fetch failed");
        const data = await res.json();
        renderDailyAnalysis(data);
        document.getElementById("daily-analysis-modal").style.display = "flex";
    } catch (e) {
        showToast("Could not load spending analysis. Try again.", true);
    }
}

/**
 * If the analysis modal is already open, silently refresh its data.
 */
function refreshDailyAnalysisIfOpen() {
    const modal = document.getElementById("daily-analysis-modal");
    if (modal && modal.style.display !== "none") {
        loadDailyAnalysis();
    }
}

/** Populate every element inside the daily analysis modal */
function renderDailyAnalysis(d) {
    const fmt = (n) => `\u20b9${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    // Header date label
    const dateLabel = document.getElementById("da-date-label");
    if (dateLabel) {
        const readable = new Date(d.today + 'T00:00:00').toLocaleDateString('en-IN', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
        dateLabel.textContent = readable;
    }

    // Summary boxes
    setText("da-today-spent",    fmt(d.today_spent));
    setText("da-today-txns",     `${d.today_transaction_count} transaction${d.today_transaction_count !== 1 ? 's' : ''} today`);
    setText("da-month-spent",    fmt(d.month_total_spent));
    setText("da-month-budget",   `of ${fmt(d.monthly_budget)} budget`);
    setText("da-days-remaining", d.days_remaining);
    setText("da-days-elapsed",   `Day ${d.days_elapsed} of ${d.days_in_month}`);
    setText("da-safe-daily",     fmt(d.safe_daily_budget));

    // Budget ring
    const pct = Math.min(d.budget_pct_used, 100);
    const circumference = 2 * Math.PI * 48; // r=48
    const offset = circumference - (pct / 100) * circumference;
    const ringCircle = document.getElementById("da-ring-circle");
    const ringPct    = document.getElementById("da-ring-pct");
    if (ringCircle) {
        ringCircle.style.strokeDashoffset = offset.toFixed(2);
        // Colour: green < 75%, amber 75-99%, red >= 100%
        if (pct >= 100)      ringCircle.style.stroke = "#ef4444";
        else if (pct >= 75)  ringCircle.style.stroke = "#f59e0b";
        else                 ringCircle.style.stroke = "#6366f1";
    }
    if (ringPct) ringPct.textContent = `${pct.toFixed(1)}%`;

    // Forecast panel
    setText("da-daily-avg",   fmt(d.daily_average));
    setText("da-proj-total",  fmt(d.projected_month_total));
    setText("da-budget-total", fmt(d.monthly_budget));

    const outcomeEl = document.getElementById("da-projection-outcome");
    if (outcomeEl) {
        if (d.projected_overspend > 0) {
            outcomeEl.className = "da-projection-outcome overshoot";
            outcomeEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Projected overshoot: ${fmt(d.projected_overspend)}`;
        } else {
            outcomeEl.className = "da-projection-outcome surplus";
            outcomeEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Projected surplus: ${fmt(d.projected_savings)}`;
        }
    }

    // Category pace grid
    renderCategoryPaceGrid(d.category_analysis);

    // Recommendations
    renderRecommendationCards(d.recommendations);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function renderCategoryPaceGrid(categories) {
    const grid = document.getElementById("da-category-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!categories || categories.length === 0) {
        grid.innerHTML = `<div style="color:var(--text-muted); font-size:13px; padding:8px;">No budget categories configured for this month.</div>`;
        return;
    }

    categories.forEach(cat => {
        const pct = Math.min(cat.pct_used, 120); // cap bar at 120% visually
        const barPct = Math.min(pct, 100);

        let barColor, badgeLabel;
        if (cat.pace === "over") {
            barColor = "#ef4444"; badgeLabel = "over";
        } else if (cat.pace === "on") {
            barColor = "#f59e0b"; badgeLabel = "on";
        } else {
            barColor = "#10b981"; badgeLabel = "under";
        }

        const fmt = (n) => `\u20b9${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

        const card = document.createElement("div");
        card.className = "pace-card";
        card.innerHTML = `
            <div class="pace-card-header">
                <span class="pace-card-name">${cat.category}</span>
                <span class="pace-badge ${cat.pace}">${badgeLabel}</span>
            </div>
            <div class="pace-bar-track">
                <div class="pace-bar-fill" style="width:${barPct}%; background:${barColor};"></div>
            </div>
            <div class="pace-card-amounts">
                <span>Spent: <strong>${fmt(cat.spent)}</strong></span>
                <span>of ${fmt(cat.allocated)}</span>
            </div>
            ${cat.projected_overrun > 0
                ? `<div style="font-size:11px; color:#ef4444; margin-top:6px;">⚠ +${fmt(cat.projected_overrun)} projected over</div>`
                : `<div style="font-size:11px; color:var(--text-muted); margin-top:6px;">Remaining: ${fmt(Math.max(0, cat.remaining))}</div>`
            }
        `;
        grid.appendChild(card);
    });
}

function renderRecommendationCards(recs) {
    const container = document.getElementById("da-recommendations-list");
    if (!container) return;
    container.innerHTML = "";

    if (!recs || recs.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); font-size:13px; padding:8px;">All clear — no alerts at this time.</div>`;
        return;
    }

    recs.forEach(rec => {
        const card = document.createElement("div");
        card.className = `rec-card ${rec.type}`;
        card.innerHTML = `
            <div class="rec-card-icon"><i class="fa-solid ${rec.icon}"></i></div>
            <div class="rec-card-body">
                <div class="rec-card-msg">${rec.message}</div>
                <div class="rec-card-action">${rec.action}</div>
            </div>
        `;
        container.appendChild(card);
    });
}

function startRealTimeBillReminderCheck() {
    if (billCheckIntervalId) {
        clearInterval(billCheckIntervalId);
    }
    
    // Immediate initial check
    runBillCheck();
    
    billCheckIntervalId = setInterval(runBillCheck, 30000); // Check every 30 seconds
}

async function runBillCheck() {
    // Only run if the user is authenticated (token exists)
    if (!localStorage.getItem("token")) return;
    
    try {
        const res = await fetch("/api/bills/?status_filter=Pending", {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            const pendingBills = await res.json();
            const now = new Date();
            
            pendingBills.forEach(bill => {
                const dueDate = new Date(bill.due_date);
                if (now >= dueDate) {
                    // It is due now!
                    if (!notifiedBills.has(bill.id)) {
                        // Trigger reminder alert toast
                        showToast(`⏰ Bill Due: "${bill.title}" of ₹${bill.amount.toLocaleString('en-IN')} is due now!`);
                        notifiedBills.add(bill.id);
                        
                        // Reload data to update tables/charts
                        loadDashboardData();
                        if (document.getElementById("screen-bills")?.classList.contains("active-screen")) {
                            loadBillsData();
                        }
                    }
                }
            });
        }
    } catch (e) {
        console.error("Error in real-time bill check", e);
    }
}
