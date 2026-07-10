import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Expense, BudgetCategory
from app.auth import get_current_user
from typing import List

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])

# ── Category Classification ──────────────────────────────────────────────────
# Fixed: recurring, non-negotiable monthly bills.
# Paying exactly 100% of a fixed budget = planned behaviour → show ✅, never ⚠.
FIXED_CATEGORIES = {
    "housing", "rent", "emi", "mortgage",
    "insurance", "health insurance", "life insurance",
    "school fees", "tuition", "college fees",
    "loan", "loan payment", "personal loan", "car loan", "home loan",
    "internet", "internet bill", "broadband",
    "utilities", "electricity", "water", "gas",
    "subscriptions", "gym",
    "emergency fund", "savings",
}

# Flexible: discretionary spending where 80–99% = caution, >100% = over budget.
FLEXIBLE_CATEGORIES = {
    "food", "groceries", "dining", "restaurant",
    "entertainment", "leisure", "movies", "streaming",
    "shopping", "clothing", "fashion",
    "travel", "vacation", "holidays",
    "healthcare", "medical", "pharmacy",
    "transportation", "fuel", "cab", "ride-share",
    "personal care", "beauty", "salon",
    "gifts", "donations",
}


def classify(cat_name: str) -> str:
    """Return 'fixed', 'flexible', or 'other'."""
    key = cat_name.lower().strip()
    if key in FIXED_CATEGORIES:
        return "fixed"
    if key in FLEXIBLE_CATEGORIES:
        return "flexible"
    # Fuzzy: if name contains a fixed keyword treat as fixed
    for kw in ("rent", "emi", "loan", "insurance", "fee", "internet", "utility", "utilities", "savings", "emergency"):
        if kw in key:
            return "fixed"
    return "flexible"   # default: treat unknown as flexible (stricter)


@router.get("/")
def get_spending_suggestions(
    month: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Analyses current month's expenses against budget allocations.
    Fixed expenses at 100% → ✅ Budget Completed (not a warning).
    Flexible expenses 80-99% → 🟡 Near Limit; >100% → 🔴 Exceeded.
    """
    if not month:
        month = datetime.date.today().strftime("%Y-%m")

    try:
        year_val, month_val = map(int, month.split("-"))
        start_date = datetime.date(year_val, month_val, 1)
        end_date = (
            datetime.date(year_val + 1, 1, 1)
            if month_val == 12
            else datetime.date(year_val, month_val + 1, 1)
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid month format. Expected YYYY-MM.",
        )

    budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month,
    ).all()

    expenses = db.query(Expense).filter(
        Expense.user_id == current_user.id,
        Expense.date >= start_date,
        Expense.date < end_date,
    ).all()

    category_totals: dict[str, float] = {}
    for exp in expenses:
        category_totals[exp.category] = category_totals.get(exp.category, 0.0) + exp.amount

    total_spent = sum(exp.amount for exp in expenses)
    remaining_balance = current_user.monthly_salary - total_spent

    suggestions = []

    for budget in budgets:
        cat   = budget.category_name
        spent = category_totals.get(cat, 0.0)
        alloc = budget.allocated_amount
        kind  = classify(cat)

        if alloc <= 0:
            # No budget set – flag any spending as unplanned
            if spent > 0:
                suggestions.append({
                    "category": cat,
                    "type": "warning",
                    "message": f"₹{int(spent):,} spent on {cat} with no budget allocated. Consider adding it to your budget plan.",
                })
            continue

        pct = (spent / alloc) * 100.0

        # ── OVERSPENT (applies to ALL categories) ───────────────────────
        if spent > alloc:
            excess = spent - alloc
            excess_pct = round(pct - 100.0, 1)

            if kind == "fixed":
                suggestions.append({
                    "category": cat,
                    "type": "danger",
                    "message": (
                        f"⚠ {cat} (fixed expense) exceeded the plan by ₹{int(excess):,} ({excess_pct}% over). "
                        f"This is unusual — check for an unexpected charge or rate increase."
                    ),
                })
            else:
                # Flexible category-specific tips
                tips = {
                    "food":          f"Consider meal planning and cooking at home to save ₹{int(excess):,} next month.",
                    "groceries":     f"Use grocery lists and avoid impulse buys to cut ₹{int(excess):,}.",
                    "entertainment": f"Pause one streaming subscription or skip one outing to recover ₹{int(excess):,}.",
                    "travel":        f"Plan trips in advance or use budget transport options to avoid ₹{int(excess):,} overruns.",
                    "shopping":      f"Apply a 24-hour rule before purchases — could save ₹{int(excess):,}.",
                    "healthcare":    f"Check if generic medicines or preventive care can reduce this ₹{int(excess):,} overspend.",
                    "transportation": f"Try carpooling or public transit to save ₹{int(excess):,} on transport.",
                }
                tip = tips.get(cat.lower(), f"Review recent {cat.lower()} purchases to identify ₹{int(excess):,} in savings.")
                suggestions.append({
                    "category": cat,
                    "type": "danger",
                    "message": (
                        f"🔴 {cat} budget exceeded by ₹{int(excess):,} ({excess_pct}% over). {tip}"
                    ),
                })

        # ── EXACTLY AT BUDGET (100 %) ────────────────────────────────────
        elif pct >= 99.5:   # treat 99.5–100 as "complete" to handle float rounding
            if kind == "fixed":
                suggestions.append({
                    "category": cat,
                    "type": "success",
                    "message": (
                        f"✅ {cat} — Budget Completed. Your planned fixed expense of ₹{int(alloc):,} "
                        f"has been paid in full. Great financial discipline!"
                    ),
                })
            else:
                suggestions.append({
                    "category": cat,
                    "type": "success",
                    "message": (
                        f"✅ {cat} — Budget Completed (₹{int(alloc):,} used). "
                        f"You've hit your limit — try to avoid any further {cat.lower()} spending this month."
                    ),
                })

        # ── NEAR LIMIT: flexible 80–99 % ────────────────────────────────
        elif kind == "flexible" and pct >= 80.0:
            remaining = alloc - spent
            suggestions.append({
                "category": cat,
                "type": "warning",
                "message": (
                    f"🟡 {cat} is at {round(pct, 1)}% of budget — only ₹{int(remaining):,} left for the rest of the month. "
                    f"Slow down on {cat.lower()} to stay within plan."
                ),
            })

        # ── WELL UNDER BUDGET (< 80 %) ──────────────────────────────────
        else:
            remaining = alloc - spent
            if spent > 0:
                suggestions.append({
                    "category": cat,
                    "type": "info",
                    "message": (
                        f"💡 {cat}: ₹{int(spent):,} of ₹{int(alloc):,} used ({round(pct,1)}%). "
                        f"₹{int(remaining):,} remaining — you're on track."
                    ),
                })
            # If nothing spent yet, skip (no-news = good news for fixed; silence for flexible)

    # ── SAVINGS GOAL ─────────────────────────────────────────────────────────
    savings_goal = current_user.savings_goal
    if savings_goal > 0:
        if remaining_balance < savings_goal:
            deficit = savings_goal - remaining_balance
            suggestions.append({
                "category": "Savings Goal",
                "type": "warning",
                "message": (
                    f"🟡 Savings goal of ₹{int(savings_goal):,} is at risk — current balance is "
                    f"₹{int(remaining_balance):,} (₹{int(deficit):,} short). Cut non-essential spend to close the gap."
                ),
            })
        else:
            surplus = remaining_balance - savings_goal
            suggestions.append({
                "category": "Savings Goal",
                "type": "success",
                "message": (
                    f"✅ Savings goal of ₹{int(savings_goal):,} achieved! You have a surplus of "
                    f"₹{int(surplus):,} this month — consider moving it to your Emergency Fund."
                ),
            })

    # ── CATCH-ALL: nothing to report ─────────────────────────────────────────
    if not suggestions:
        if total_spent == 0:
            suggestions.append({
                "category": "General",
                "type": "info",
                "message": "Welcome! No transactions recorded yet. Start logging expenses to get personalised insights.",
            })
        else:
            suggestions.append({
                "category": "General",
                "type": "success",
                "message": (
                    f"🎉 Excellent! All categories are on track. "
                    f"You've spent ₹{int(total_spent):,} with ₹{int(remaining_balance):,} remaining — keep it up!"
                ),
            })

    return {"month": month, "suggestions": suggestions}

@router.get("/advisor")

def get_advisor_advice(
    month: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Acts as an AI Financial Advisor by comparing expenses to last month's expenditures,
    suggesting specific reduction goals, and calculating long-term savings projections.
    """
    if not month:
        month = datetime.date.today().strftime("%Y-%m")
        
    try:
        year_val, month_val = map(int, month.split("-"))
        cur_start = datetime.date(year_val, month_val, 1)
        if month_val == 12:
            cur_end = datetime.date(year_val + 1, 1, 1)
        else:
            cur_end = datetime.date(year_val, month_val + 1, 1)
            
        # Previous Month calculations
        if month_val == 1:
            prev_year = year_val - 1
            prev_month = 12
        else:
            prev_year = year_val
            prev_month = month_val - 1
        prev_start = datetime.date(prev_year, prev_month, 1)
        prev_end = cur_start
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid month format. Expected YYYY-MM."
        )
        
    # Get current month expenses
    cur_expenses = db.query(Expense).filter(
        Expense.user_id == current_user.id,
        Expense.date >= cur_start,
        Expense.date < cur_end
    ).all()
    
    # Get previous month expenses
    prev_expenses = db.query(Expense).filter(
        Expense.user_id == current_user.id,
        Expense.date >= prev_start,
        Expense.date < prev_end
    ).all()
    
    # Aggregate current month expenses by category
    cur_cats = {}
    for exp in cur_expenses:
        cur_cats[exp.category] = cur_cats.get(exp.category, 0.0) + exp.amount
        
    # Aggregate previous month expenses by category
    prev_cats = {}
    for exp in prev_expenses:
        prev_cats[exp.category] = prev_cats.get(exp.category, 0.0) + exp.amount
        
    # Get budget allocations to calculate overruns
    budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month
    ).all()
    budget_map = {b.category_name: b.allocated_amount for b in budgets}
    
    total_spent = sum(exp.amount for exp in cur_expenses)
    remaining_balance = current_user.monthly_salary - total_spent
    
    comparison_points = []
    reduction_points = []
    projection_points = []
    
    # 1. Month-over-Month Comparisons
    for cat, cur_amt in cur_cats.items():
        prev_amt = prev_cats.get(cat, 0.0)
        if prev_amt > 0:
            pct_change = ((cur_amt - prev_amt) / prev_amt) * 100.0
            if pct_change >= 5.0:
                comparison_points.append(
                    f"Your {cat.lower() if cat.lower() != 'food' else 'food'} expenses increased by {int(pct_change)}% compared to last month."
                )
        elif cur_amt > 0 and cat in budget_map:
            # Check against budget limit if no previous month spending exists
            allocated = budget_map[cat]
            if allocated > 0 and cur_amt > allocated:
                pct_over = ((cur_amt - allocated) / allocated) * 100.0
                comparison_points.append(
                    f"Your {cat.lower()} expenses exceeded the allocated budget by {int(pct_over)}% this month."
                )
                
    # If no comparison points were generated
    if not comparison_points:
        if total_spent > 0:
            comparison_points.append("Your monthly spending patterns are stable compared to last month.")
        else:
            comparison_points.append("Start tracking your daily transactions to analyze month-over-month trends.")
            
    # 2. Targeted Reduction Advice
    for cat, cur_amt in cur_cats.items():
        allocated = budget_map.get(cat, 0.0)
        if allocated > 0 and cur_amt > allocated:
            excess = cur_amt - allocated
            if cat.lower() in ["food", "groceries"]:
                reduction_points.append(f"Reduce restaurant and dining spending by ₹{int(excess)}.")
            elif cat.lower() in ["entertainment", "leisure"]:
                reduction_points.append(f"Trim entertainment and streaming spending by ₹{int(excess)}.")
            elif cat.lower() in ["transportation", "travel"]:
                reduction_points.append(f"Reduce ride-shares and private travel spending by ₹{int(excess)}.")
            else:
                reduction_points.append(f"Trim down spending on {cat.lower()} by ₹{int(excess)}.")
                
    if not reduction_points:
        if remaining_balance < current_user.savings_goal:
            deficit = current_user.savings_goal - remaining_balance
            reduction_points.append(f"Consider reducing non-essential expenses by ₹{int(deficit)} to meet your savings target.")
        else:
            reduction_points.append("Great job! You are within your budget categories. Keep maintaining this pace.")
            
    # 3. Savings Predictions / Projections
    # Calculate a baseline recommendation (e.g. ₹3,000, or user's target savings goal, or actual remaining surplus)
    savings_goal = current_user.savings_goal if current_user.savings_goal > 0 else 3000.0
    projection_points.append(
        f"If you save ₹{int(savings_goal)} every month, you can accumulate ₹{int(savings_goal * 12)} in one year."
    )
    projection_points.append(
        f"By maintaining this rate of ₹{int(savings_goal)} monthly, your savings will grow to ₹{int(savings_goal * 60)} in five years."
    )
    
    # Suggest actions for surplus
    if remaining_balance > savings_goal:
        surplus = remaining_balance - savings_goal
        projection_points.append(
            f"You have an extra surplus of ₹{int(surplus)} this month. Move it to your Emergency Fund to secure your buffer!"
        )
        
    return {
        "month": month,
        "salary": current_user.monthly_salary,
        "total_spent": total_spent,
        "remaining_balance": remaining_balance,
        "savings_goal": savings_goal,
        "comparisons": comparison_points,
        "reductions": reduction_points,
        "projections": projection_points
    }

