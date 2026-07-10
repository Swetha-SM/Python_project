import os
import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Form, File, UploadFile
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Expense, BudgetCategory
from app.schemas import ExpenseResponse
from app.auth import get_current_user
from app.config import UPLOAD_DIR
from typing import List, Optional

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

@router.get("/", response_model=List[ExpenseResponse])
def get_expenses(
    month: Optional[str] = None,
    category: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves all expenses, optionally filtered by month (YYYY-MM) and/or category."""
    query = db.query(Expense).filter(Expense.user_id == current_user.id)
    
    if month:
        # Filter by year and month
        try:
            year_val, month_val = map(int, month.split("-"))
            # SQLite / MySQL date filtering: expense.date is Date
            # Use extract or simple date ranges
            start_date = datetime.date(year_val, month_val, 1)
            if month_val == 12:
                end_date = datetime.date(year_val + 1, 1, 1)
            else:
                end_date = datetime.date(year_val, month_val + 1, 1)
            query = query.filter(Expense.date >= start_date, Expense.date < end_date)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid month format. Expected YYYY-MM."
            )
            
    if category:
        query = query.filter(Expense.category == category)
        
    # Sort by date descending
    return query.order_by(Expense.date.desc(), Expense.id.desc()).all()


@router.post("/", response_model=ExpenseResponse, status_code=status.HTTP_201_CREATED)
def create_expense(
    amount: float = Form(...),
    category: str = Form(...),
    payment_method: str = Form(...),
    description: Optional[str] = Form(None),
    date: str = Form(...),
    merchant: Optional[str] = Form(None),
    receipt: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Creates a new expense.
    Accepts form data for compatibility with receipt file uploads.
    """
    try:
        parsed_date = datetime.datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid date format. Expected YYYY-MM-DD."
        )
        
    receipt_path = None
    if receipt and receipt.filename:
        # Generate secure unique name
        ext = os.path.splitext(receipt.filename)[1]
        unique_filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(UPLOAD_DIR, unique_filename)
        
        # Save file to disk
        try:
            with open(filepath, "wb") as f:
                content = receipt.file.read()
                f.write(content)
            receipt_path = f"/static/uploads/{unique_filename}"
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to save receipt file: {str(e)}"
            )

    # Subtract amount from virtual bank balance
    current_user.bank_balance = round(current_user.bank_balance - amount, 2)

    new_expense = Expense(
        user_id=current_user.id,
        amount=amount,
        category=category,
        payment_method=payment_method,
        description=description,
        date=parsed_date,
        receipt_path=receipt_path,
        merchant=merchant
    )
    db.add(new_expense)
    db.commit()
    db.refresh(new_expense)
    
    return new_expense


@router.delete("/{expense_id}", status_code=status.HTTP_200_OK)
def delete_expense(
    expense_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes an expense record and removes associated receipt from disk."""
    expense = db.query(Expense).filter(
        Expense.id == expense_id,
        Expense.user_id == current_user.id
    ).first()
    
    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found."
        )
        
    # Delete file if exists
    if expense.receipt_path:
        filename = os.path.basename(expense.receipt_path)
        filepath = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception:
                pass # Fail silently if file can't be deleted
                
    db.delete(expense)
    db.commit()
    return {"detail": "Expense successfully deleted."}

@router.get("/summary")
def get_expense_summary(
    month: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns category-wise spending totals and compares them to budget allocations for the month."""
    if not month:
        month = datetime.date.today().strftime("%Y-%m")
        
    try:
        year_val, month_val = map(int, month.split("-"))
        start_date = datetime.date(year_val, month_val, 1)
        if month_val == 12:
            end_date = datetime.date(year_val + 1, 1, 1)
        else:
            end_date = datetime.date(year_val, month_val + 1, 1)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid month format. Expected YYYY-MM."
        )
        
    # Query budget allocations
    budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month
    ).all()
    
    # Query all expenses for this month
    expenses = db.query(Expense).filter(
        Expense.user_id == current_user.id,
        Expense.date >= start_date,
        Expense.date < end_date
    ).all()
    
    # Compile category totals
    category_totals = {}
    for exp in expenses:
        category_totals[exp.category] = category_totals.get(exp.category, 0.0) + exp.amount
        
    # Prepare comparison object
    budget_comparison = []
    total_budget_allocated = 0.0
    total_spent = sum(exp.amount for exp in expenses)
    
    for budget in budgets:
        spent = round(category_totals.get(budget.category_name, 0.0), 2)
        remaining = round(budget.allocated_amount - spent, 2)
        exceeded = spent > budget.allocated_amount
        exceeded_by = round(spent - budget.allocated_amount, 2) if exceeded else 0.0
        
        budget_comparison.append({
            "category": budget.category_name,
            "allocated": budget.allocated_amount,
            "percentage": budget.percentage,
            "spent": spent,
            "remaining": remaining,
            "exceeded": exceeded,
            "exceeded_by": exceeded_by
        })
        total_budget_allocated += budget.allocated_amount
        
    # Include other spendings not in current budget categories
    budget_categories = {b.category_name for b in budgets}
    misc_spent = 0.0
    for cat, amt in category_totals.items():
        if cat not in budget_categories:
            misc_spent += amt
            
    if misc_spent > 0:
        budget_comparison.append({
            "category": "Other / Unallocated",
            "allocated": 0.0,
            "percentage": 0.0,
            "spent": round(misc_spent, 2),
            "remaining": round(-misc_spent, 2),
            "exceeded": True,
            "exceeded_by": round(misc_spent, 2)
        })
        
    return {
        "month": month,
        "monthly_salary": current_user.monthly_salary,
        "total_budget_allocated": round(total_budget_allocated, 2),
        "total_spent": round(total_spent, 2),
        "remaining_salary": round(current_user.monthly_salary - total_spent, 2),
        "comparison": budget_comparison
    }
