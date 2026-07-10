import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import User, Expense, BudgetCategory, BankAccount
from app.auth import get_current_user
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/api/payments", tags=["payments"])


class PaymentCreate(BaseModel):
    merchant: str = Field(..., min_length=1, max_length=100)
    category: str = Field(..., min_length=1)
    payment_method: str = Field(..., min_length=1)
    amount: float = Field(..., gt=0)
    description: Optional[str] = None
    date: Optional[str] = None  # YYYY-MM-DD


@router.post("/pay")
def make_virtual_payment(
    payload: PaymentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Deducts from virtual bank account balance, logs expense, and returns
    real-time budget overrun & savings protection alerts.
    """
    # 1. Resolve bank account
    account = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No virtual bank account found. Please create one first in the Virtual Bank tab."
        )

    # 2. Parse date
    trans_date = datetime.date.today()
    if payload.date:
        try:
            trans_date = datetime.datetime.strptime(payload.date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format. Expected YYYY-MM-DD."
            )

    # 3. Deduct from virtual bank balance
    account.balance = round(account.balance - payload.amount, 2)
    # Keep user.bank_balance in sync
    current_user.bank_balance = account.balance

    # 4. Create expense transaction
    new_expense = Expense(
        user_id=current_user.id,
        amount=payload.amount,
        category=payload.category,
        payment_method=payload.payment_method,
        description=f"Virtual payment at {payload.merchant}: {payload.description or ''}".strip(": "),
        date=trans_date,
        merchant=payload.merchant
    )
    db.add(new_expense)
    db.commit()
    db.refresh(new_expense)

    # 5. Check category budget overrun
    month = trans_date.strftime("%Y-%m")
    year_val, month_val = trans_date.year, trans_date.month
    month_start = datetime.date(year_val, month_val, 1)
    month_end = datetime.date(year_val, month_val + 1, 1) if month_val < 12 else datetime.date(year_val + 1, 1, 1)

    budget = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.category_name == payload.category,
        BudgetCategory.month == month
    ).first()

    total_spent_cat = db.query(func.sum(Expense.amount)).filter(
        Expense.user_id == current_user.id,
        Expense.category == payload.category,
        Expense.date >= month_start,
        Expense.date < month_end
    ).scalar() or 0.0

    budget_exceeded = False
    exceeded_amount = 0.0
    budget_alert = None

    if budget and total_spent_cat > budget.allocated_amount:
        budget_exceeded = True
        exceeded_amount = round(total_spent_cat - budget.allocated_amount, 2)
        budget_alert = (
            f"Red Alert: {payload.category} budget exceeded by "
            f"₹{int(exceeded_amount):,} (Spent ₹{int(total_spent_cat):,} / "
            f"Budget ₹{int(budget.allocated_amount):,})"
        )

    # 6. Check savings protection
    savings_goal = account.savings_goal
    savings_consumed = 0.0
    savings_alert = None

    if savings_goal > 0 and account.balance < savings_goal:
        savings_consumed = round(savings_goal - max(0.0, account.balance), 2)
        if savings_consumed > 0:
            savings_alert = (
                f"Savings Protection Alert: ₹{int(savings_consumed):,} of your planned "
                f"₹{int(savings_goal):,} savings has been consumed."
            )

    db.commit()

    return {
        "expense": {
            "id": new_expense.id,
            "amount": new_expense.amount,
            "category": new_expense.category,
            "merchant": new_expense.merchant,
            "date": new_expense.date.strftime("%Y-%m-%d"),
            "description": new_expense.description,
        },
        "bank_balance": account.balance,
        "budget_exceeded": budget_exceeded,
        "exceeded_amount": exceeded_amount,
        "budget_alert": budget_alert,
        "savings_consumed": savings_consumed,
        "savings_alert": savings_alert,
    }


@router.get("/balance")
def get_bank_balance_and_alerts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves current virtual balance and savings protection status."""
    account = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()

    if not account:
        return {
            "bank_balance": current_user.bank_balance,
            "savings_goal": current_user.savings_goal,
            "savings_consumed": 0.0,
            "savings_alert": None,
        }

    savings_goal = account.savings_goal
    savings_consumed = 0.0
    savings_alert = None

    if savings_goal > 0 and account.balance < savings_goal:
        savings_consumed = round(savings_goal - max(0.0, account.balance), 2)
        if savings_consumed > 0:
            savings_alert = (
                f"Savings Protection Alert: ₹{int(savings_consumed):,} of your planned "
                f"₹{int(savings_goal):,} savings has been consumed."
            )

    return {
        "bank_balance": account.balance,
        "savings_goal": savings_goal,
        "savings_consumed": savings_consumed,
        "savings_alert": savings_alert,
    }
