import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, BankAccount
from app.auth import get_current_user
from app.schemas import BankAccountCreate, BankAccountUpdate, BankAccountResponse

router = APIRouter(prefix="/api/bank", tags=["bank"])


@router.post("/account", response_model=BankAccountResponse, status_code=status.HTTP_201_CREATED)
def create_bank_account(
    data: BankAccountCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Creates a virtual bank account for the user.
    One account per user — raises 400 if already exists.
    """
    existing = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bank account already exists. Use PUT /api/bank/account to update."
        )

    account = BankAccount(
        user_id=current_user.id,
        bank_name=data.bank_name,
        account_holder=data.account_holder,
        account_number=data.account_number,
        ifsc_code=data.ifsc_code.upper(),
        balance=data.balance,
        salary=data.salary,
        savings_goal=data.savings_goal,
    )
    db.add(account)

    # Sync salary and savings_goal back to user profile as well
    current_user.monthly_salary = data.salary
    current_user.savings_goal = data.savings_goal
    current_user.bank_balance = data.balance

    db.commit()
    db.refresh(account)
    return account


@router.get("/account", response_model=BankAccountResponse)
def get_bank_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns the virtual bank account for the logged-in user."""
    account = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No bank account found. Create one first."
        )
    return account


@router.put("/account", response_model=BankAccountResponse)
def update_bank_account(
    data: BankAccountUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates virtual bank account details."""
    account = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No bank account found. Create one first."
        )

    if data.bank_name is not None:
        account.bank_name = data.bank_name
    if data.account_holder is not None:
        account.account_holder = data.account_holder
    if data.account_number is not None:
        account.account_number = data.account_number
    if data.ifsc_code is not None:
        account.ifsc_code = data.ifsc_code.upper()
    if data.balance is not None:
        account.balance = data.balance
        current_user.bank_balance = data.balance
    if data.salary is not None:
        account.salary = data.salary
        current_user.monthly_salary = data.salary
    if data.savings_goal is not None:
        account.savings_goal = data.savings_goal
        current_user.savings_goal = data.savings_goal

    account.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(account)
    return account


@router.get("/status")
def get_bank_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns full bank account status: balance, savings gap, and protection alerts.
    Used by payments screen and dashboard for real-time monitoring.
    """
    account = db.query(BankAccount).filter(BankAccount.user_id == current_user.id).first()
    if not account:
        return {
            "has_account": False,
            "bank_balance": 0.0,
            "savings_goal": 0.0,
            "savings_consumed": 0.0,
            "savings_alert": None,
        }

    savings_consumed = 0.0
    savings_alert = None

    if account.savings_goal > 0 and account.balance < account.savings_goal:
        savings_consumed = round(account.savings_goal - max(0.0, account.balance), 2)
        if savings_consumed > 0:
            savings_alert = (
                f"Savings Protection Alert: ₹{int(savings_consumed):,} of your planned "
                f"₹{int(account.savings_goal):,} savings has been consumed."
            )

    return {
        "has_account": True,
        "bank_name": account.bank_name,
        "account_holder": account.account_holder,
        "account_number_masked": "XXXX XXXX " + account.account_number[-4:],
        "ifsc_code": account.ifsc_code,
        "bank_balance": account.balance,
        "salary": account.salary,
        "savings_goal": account.savings_goal,
        "savings_consumed": savings_consumed,
        "savings_alert": savings_alert,
    }
