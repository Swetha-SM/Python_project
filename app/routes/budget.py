from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, BudgetCategory
from app.schemas import BudgetUpdatePlan, BudgetResponse
from app.auth import get_current_user
from typing import List
import datetime

router = APIRouter(prefix="/api/budget", tags=["budget"])

# Standard default categories and percentages (sums to 100%)
DEFAULT_RECOMMENDATION = {
    "Housing": 30.0,
    "Food": 20.0,
    "Transportation": 10.0,
    "Utilities": 8.0,
    "Healthcare": 7.0,
    "Entertainment": 5.0,
    "Savings": 15.0,
    "Emergency Fund": 5.0
}

@router.get("/recommend")
def get_recommendation(current_user: User = Depends(get_current_user)):
    """Returns the recommended budget allocation based on the user's salary."""
    salary = current_user.monthly_salary
    allocations = []
    for cat_name, pct in DEFAULT_RECOMMENDATION.items():
        allocations.append({
            "category_name": cat_name,
            "percentage": pct,
            "allocated_amount": round((pct / 100.0) * salary, 2)
        })
    return {
        "monthly_salary": salary,
        "recommendations": allocations
    }

@router.get("/plan", response_model=List[BudgetResponse])
def get_budget_plan(month: str = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Retrieves the budget plan for a given month (YYYY-MM).
    If it doesn't exist, automatically populates it with the default recommendation.
    """
    if not month:
        # Default to current month
        month = datetime.date.today().strftime("%Y-%m")
        
    budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month
    ).all()
    
    # If no budget plan exists for this month, initialize with recommendations
    if not budgets:
        salary = current_user.monthly_salary
        budgets = []
        for cat_name, pct in DEFAULT_RECOMMENDATION.items():
            allocated = round((pct / 100.0) * salary, 2)
            db_budget = BudgetCategory(
                user_id=current_user.id,
                category_name=cat_name,
                percentage=pct,
                allocated_amount=allocated,
                month=month
            )
            db.add(db_budget)
            budgets.append(db_budget)
        db.commit()
        # Refresh to get IDs
        for b in budgets:
            db.refresh(b)
            
    return budgets

@router.put("/plan", response_model=List[BudgetResponse])
def save_budget_plan(plan: BudgetUpdatePlan, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Saves and updates a custom budget plan.
    Ensures total percentage is exactly 100%.
    """
    total_pct = sum(item.percentage for item in plan.allocations)
    if abs(total_pct - 100.0) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Total percentage must equal 100%. Currently it is {total_pct}%."
        )
        
    salary = current_user.monthly_salary
    month = plan.month
    
    # Fetch existing categories for the user and month
    existing_budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month
    ).all()
    
    # Create lookup map
    budget_map = {b.category_name: b for b in existing_budgets}
    
    updated_budgets = []
    
    for item in plan.allocations:
        allocated = round((item.percentage / 100.0) * salary, 2)
        if item.category_name in budget_map:
            # Update existing
            db_budget = budget_map[item.category_name]
            db_budget.percentage = item.percentage
            db_budget.allocated_amount = allocated
        else:
            # Create new
            db_budget = BudgetCategory(
                user_id=current_user.id,
                category_name=item.category_name,
                percentage=item.percentage,
                allocated_amount=allocated,
                month=month
            )
            db.add(db_budget)
        updated_budgets.append(db_budget)
        
    # Delete categories that were not included in the new plan
    categories_to_keep = {item.category_name for item in plan.allocations}
    for cat_name, db_budget in budget_map.items():
        if cat_name not in categories_to_keep:
            db.delete(db_budget)
            
    db.commit()
    
    # Retrieve final listing
    final_budgets = db.query(BudgetCategory).filter(
        BudgetCategory.user_id == current_user.id,
        BudgetCategory.month == month
    ).all()
    
    return final_budgets
