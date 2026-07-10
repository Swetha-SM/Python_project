import datetime
import calendar
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import User, Expense, BudgetCategory, BankAccount
from app.auth import get_current_user

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/daily")
def get_daily_analysis(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns a full daily spending intelligence report:
    - Calendar position (days elapsed / remaining)
    - Today's transactions
    - Monthly totals vs budget
    - Spending velocity & end-of-month projection
    - Per-category pace analysis
    - Typed recommendation alerts
    """
    today = datetime.date.today()
    month_str = today.strftime("%Y-%m")

    # Calendar metrics
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_elapsed = today.day
    days_remaining = days_in_month - days_elapsed  # days after today

    # Today's spend
    today_spent = db.query(func.sum(Expense.amount)).filter(
        Expense.user_id == current_user.id,
        Expense.date == today
    ).scalar() or 0.0

    today_count = db.query(func.count(Expense.id)).filter(
        Expense.user_id == current_user.id,
        Expense.date == today
    ).scalar() or 0

    # Month totals
    month_spent = db.query(func.sum(Expense.amount)).filter(
        Expense.user_id == current_user.id,
        func.strftime("%Y-%m", Expense.date) == month_str
    ).scalar() or 0.0

    daily_avg = month_spent / days_elapsed if days_elapsed > 0 else 0.0
    projected_total = daily_avg * days_in_month

    # Budget
    budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month_str
    ).all()
    monthly_budget = sum(b.allocated_amount for b in budgets)
    remaining_budget = monthly_budget - month_spent

    projected_overspend = max(0.0, projected_total - monthly_budget)
    projected_savings = max(0.0, monthly_budget - projected_total)

    # Safe spend per remaining day
    safe_daily = remaining_budget / days_remaining if days_remaining > 0 else 0.0

    # Per-category analysis
    category_analysis = []
    for b in budgets:
        cat_spent = db.query(func.sum(Expense.amount)).filter(
            Expense.user_id == current_user.id,
            Expense.category == b.category_name,
            func.strftime("%Y-%m", Expense.date) == month_str
        ).scalar() or 0.0

        cat_daily_avg = cat_spent / days_elapsed if days_elapsed > 0 else 0.0
        cat_projected = cat_daily_avg * days_in_month
        cat_overrun = max(0.0, cat_projected - b.allocated_amount)
        pct_used = (cat_spent / b.allocated_amount * 100) if b.allocated_amount > 0 else 0.0

        category_analysis.append({
            "category": b.category_name,
            "allocated": round(b.allocated_amount, 2),
            "spent": round(cat_spent, 2),
            "remaining": round(b.allocated_amount - cat_spent, 2),
            "projected_total": round(cat_projected, 2),
            "projected_overrun": round(cat_overrun, 2),
            "pct_used": round(pct_used, 1),
            "pace": "over" if cat_projected > b.allocated_amount else ("on" if pct_used >= 70 else "under")
        })

    # Sort: over-budget first, then by pct_used desc
    category_analysis.sort(key=lambda x: (-x["projected_overrun"], -x["pct_used"]))

    # Bank / savings context
    bank = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()
    bank_balance = bank.balance if bank else current_user.bank_balance
    savings_goal = bank.savings_goal if bank else current_user.savings_goal

    # Build smart recommendations
    recommendations = []

    if days_elapsed < 3:
        recommendations.append({
            "type": "info",
            "icon": "fa-circle-info",
            "message": "Not enough data yet for projections.",
            "action": "Keep logging daily to unlock accurate spending predictions."
        })

    if today_count == 0:
        recommendations.append({
            "type": "info",
            "icon": "fa-pen-to-square",
            "message": "No expenses logged today.",
            "action": "Take 2 minutes now to record today's transactions."
        })

    if projected_overspend > 0 and days_elapsed >= 3:
        daily_cut_needed = (projected_total - monthly_budget) / days_remaining if days_remaining > 0 else 0
        recommendations.append({
            "type": "danger",
            "icon": "fa-circle-exclamation",
            "message": f"At this pace you will exceed your budget by \u20b9{projected_overspend:,.0f}.",
            "action": f"Cut daily spending by \u20b9{daily_cut_needed:,.0f} to stay on track."
        })

    if remaining_budget < savings_goal and savings_goal > 0:
        gap = savings_goal - remaining_budget
        recommendations.append({
            "type": "warning",
            "icon": "fa-piggy-bank",
            "message": f"Remaining budget (\u20b9{remaining_budget:,.0f}) is below your savings goal of \u20b9{savings_goal:,.0f}.",
            "action": f"You need to recover \u20b9{gap:,.0f} \u2014 switch to essentials-only spending."
        })

    overrun_cats = [c for c in category_analysis if c["projected_overrun"] > 0][:2]
    for cat in overrun_cats:
        recommendations.append({
            "type": "warning",
            "icon": "fa-chart-line",
            "message": f"{cat['category']} on track to overshoot by \u20b9{cat['projected_overrun']:,.0f}.",
            "action": f"Limit {cat['category'].lower()} to \u20b9{max(0, cat['remaining']):,.0f} for the rest of the month."
        })

    if not recommendations and projected_savings > 0 and days_elapsed >= 3:
        recommendations.append({
            "type": "success",
            "icon": "fa-circle-check",
            "message": f"Excellent! On current pace you'll save \u20b9{projected_savings:,.0f} extra this month.",
            "action": "Consider moving surplus to your emergency fund or investments."
        })

    # Calculate Estimated Exhaustion Date
    if remaining_budget <= 0:
        exhaustion_date = today.isoformat()
    elif daily_avg > 0:
        days_to_exhaust = int(remaining_budget / daily_avg)
        exhaustion_date = (today + datetime.timedelta(days=days_to_exhaust)).isoformat()
    else:
        exhaustion_date = "Safe (No current depletion)"

    # Calculate Overspending Risk Level
    budget_pct_used = (month_spent / monthly_budget * 100) if monthly_budget > 0 else 0
    if projected_overspend > 0:
        if projected_total > (monthly_budget * 1.15):
            risk_level = "High"
        else:
            risk_level = "Medium"
    else:
        if budget_pct_used >= 90 and days_remaining > 5:
            risk_level = "Medium"
        else:
            risk_level = "Low"

    return {
        "today": today.isoformat(),
        "month": month_str,
        "days_in_month": days_in_month,
        "days_elapsed": days_elapsed,
        "days_remaining": days_remaining,
        "today_spent": round(today_spent, 2),
        "today_transaction_count": today_count,
        "month_total_spent": round(month_spent, 2),
        "daily_average": round(daily_avg, 2),
        "projected_month_total": round(projected_total, 2),
        "monthly_budget": round(monthly_budget, 2),
        "remaining_budget": round(remaining_budget, 2),
        "projected_overspend": round(projected_overspend, 2),
        "projected_savings": round(projected_savings, 2),
        "safe_daily_budget": round(safe_daily, 2),
        "bank_balance": round(bank_balance, 2),
        "savings_goal": round(savings_goal, 2),
        "budget_pct_used": round(budget_pct_used, 1),
        "estimated_exhaustion_date": exhaustion_date,
        "overspending_risk_level": risk_level,
        "category_analysis": category_analysis,
        "recommendations": recommendations
    }
