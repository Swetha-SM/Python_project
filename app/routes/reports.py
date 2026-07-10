import csv
import io
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import User, Expense, BudgetCategory
from app.auth import get_current_user
from typing import List, Optional

router = APIRouter(prefix="/api/reports", tags=["reports"])

@router.get("/data")
def get_report_data(
    range_type: str = Query("monthly", regex="^(daily|weekly|monthly|annual)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns aggregated financial report data:
    - total income vs total expense in the range
    - time-series expense trends
    - category breakdown
    """
    today = datetime.date.today()
    expenses = db.query(Expense).filter(Expense.user_id == current_user.id)
    
    # 1. Filter based on range type
    if range_type == "daily":
        # Last 30 days
        start_date = today - datetime.timedelta(days=30)
        expenses = expenses.filter(Expense.date >= start_date)
        
        # Trend group by date
        trend_query = db.query(
            Expense.date.label("group_key"),
            func.sum(Expense.amount).label("total")
        ).filter(
            Expense.user_id == current_user.id,
            Expense.date >= start_date
        ).group_by(Expense.date).order_by(Expense.date.asc()).all()
        
        trend = [{"label": row.group_key.strftime("%Y-%m-%d"), "amount": row.total} for row in trend_query]
        
    elif range_type == "weekly":
        # Last 12 weeks
        start_date = today - datetime.timedelta(weeks=12)
        expenses = expenses.filter(Expense.date >= start_date)
        
        # SQLite vs MySQL group by week: let's do grouping in Python for safety,
        # or use SQLAlchemy func extract (works for SQLite/MySQL mostly)
        # To be completely database-agnostic, let's load transactions in range and group in python
        raw_expenses = expenses.order_by(Expense.date.asc()).all()
        trend_map = {}
        for exp in raw_expenses:
            # ISO year and week number
            iso_year, iso_week, _ = exp.date.isocalendar()
            week_key = f"{iso_year}-W{iso_week}"
            trend_map[week_key] = trend_map.get(week_key, 0.0) + exp.amount
        trend = [{"label": k, "amount": v} for k, v in trend_map.items()]
        
    elif range_type == "monthly":
        # Last 12 months
        # Start of 11 months ago
        first_day_current_month = today.replace(day=1)
        # Approx 330 days ago
        start_date = (first_day_current_month - datetime.timedelta(days=330)).replace(day=1)
        expenses = expenses.filter(Expense.date >= start_date)
        
        raw_expenses = expenses.order_by(Expense.date.asc()).all()
        trend_map = {}
        for exp in raw_expenses:
            month_key = exp.date.strftime("%Y-%m")
            trend_map[month_key] = trend_map.get(month_key, 0.0) + exp.amount
        trend = [{"label": k, "amount": v} for k, v in trend_map.items()]
        
    elif range_type == "annual":
        # Last 5 years
        start_date = datetime.date(today.year - 4, 1, 1)
        expenses = expenses.filter(Expense.date >= start_date)
        
        raw_expenses = expenses.order_by(Expense.date.asc()).all()
        trend_map = {}
        for exp in raw_expenses:
            year_key = str(exp.date.year)
            trend_map[year_key] = trend_map.get(year_key, 0.0) + exp.amount
        trend = [{"label": k, "amount": v} for k, v in trend_map.items()]

    # 2. Get category breakdown in this range
    category_query = db.query(
        Expense.category,
        func.sum(Expense.amount).label("total")
    ).filter(
        Expense.user_id == current_user.id,
        Expense.date >= start_date
    ).group_by(Expense.category).all()
    
    categories = [{"category": row.category, "amount": row.total} for row in category_query]
    
    total_spent = sum(item["amount"] for item in categories)
    
    # Calculate savings progress for this range (if monthly)
    # Using user's current salary * months in range vs what they actually saved
    # Let's return these details
    return {
        "range_type": range_type,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": today.strftime("%Y-%m-%d"),
        "total_spent": round(total_spent, 2),
        "income": current_user.monthly_salary, # Reference monthly salary
        "trend": trend,
        "categories": categories
    }

@router.get("/export/csv")
def export_expenses_csv(
    month: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generates and downloads a CSV report of all expenses, optionally filtered by month."""
    query = db.query(Expense).filter(Expense.user_id == current_user.id)
    
    if month:
        try:
            year_val, month_val = map(int, month.split("-"))
            start_date = datetime.date(year_val, month_val, 1)
            if month_val == 12:
                end_date = datetime.date(year_val + 1, 1, 1)
            else:
                end_date = datetime.date(year_val, month_val + 1, 1)
            query = query.filter(Expense.date >= start_date, Expense.date < end_date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid month format. Expected YYYY-MM."
            )
            
    expenses = query.order_by(Expense.date.desc()).all()
    
    # Create CSV in-memory buffer
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write CSV Header
    writer.writerow([
        "Expense ID", 
        "Date", 
        "Category", 
        "Amount (INR)", 
        "Payment Method", 
        "Description", 
        "Receipt Attached"
    ])
    
    # Write rows
    for exp in expenses:
        writer.writerow([
            exp.id,
            exp.date.strftime("%Y-%m-%d"),
            exp.category,
            exp.amount,
            exp.payment_method,
            exp.description or "",
            "Yes" if exp.receipt_path else "No"
        ])
        
    output.seek(0)
    
    filename = f"household_expenses_{month or 'all'}_{datetime.date.today().strftime('%Y%m%d')}.csv"
    
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
