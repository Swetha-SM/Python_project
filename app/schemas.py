from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict
from datetime import datetime, date

# --- AUTH & USER SCHEMAS ---

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserUpdate(BaseModel):
    monthly_salary: Optional[float] = Field(None, ge=0)
    savings_goal: Optional[float] = Field(None, ge=0)
    family_info: Optional[str] = Field(None, max_length=500)

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    monthly_salary: float
    savings_goal: float
    bank_balance: float
    family_info: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    user_id: Optional[int] = None


# --- BANK ACCOUNT SCHEMAS ---

class BankAccountCreate(BaseModel):
    bank_name: str = Field(..., min_length=2, max_length=150)
    account_holder: str = Field(..., min_length=2, max_length=150)
    account_number: str = Field(..., min_length=4, max_length=20)
    ifsc_code: str = Field(..., min_length=4, max_length=20)
    balance: float = Field(..., ge=0)
    salary: float = Field(..., ge=0)
    savings_goal: float = Field(..., ge=0)

class BankAccountUpdate(BaseModel):
    bank_name: Optional[str] = Field(None, max_length=150)
    account_holder: Optional[str] = Field(None, max_length=150)
    account_number: Optional[str] = Field(None, max_length=20)
    ifsc_code: Optional[str] = Field(None, max_length=20)
    balance: Optional[float] = Field(None, ge=0)
    salary: Optional[float] = Field(None, ge=0)
    savings_goal: Optional[float] = Field(None, ge=0)

class BankAccountResponse(BaseModel):
    id: int
    user_id: int
    bank_name: str
    account_holder: str
    account_number: str
    ifsc_code: str
    balance: float
    salary: float
    savings_goal: float
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True




# --- BUDGET SCHEMAS ---

class BudgetCategoryCreate(BaseModel):
    category_name: str
    percentage: float = Field(..., ge=0, le=100)
    allocated_amount: float
    month: str  # YYYY-MM

class BudgetAllocationItem(BaseModel):
    category_name: str
    percentage: float = Field(..., ge=0, le=100)

class BudgetUpdatePlan(BaseModel):
    month: str
    allocations: List[BudgetAllocationItem]

class BudgetResponse(BaseModel):
    id: int
    category_name: str
    percentage: float
    allocated_amount: float
    month: str

    class Config:
        from_attributes = True


# --- EXPENSE SCHEMAS ---

class ExpenseCreate(BaseModel):
    amount: float = Field(..., gt=0)
    category: str
    payment_method: str
    description: Optional[str] = None
    date: date

class ExpenseResponse(BaseModel):
    id: int
    amount: float
    category: str
    payment_method: str
    description: Optional[str]
    date: date
    receipt_path: Optional[str]
    merchant: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True



# --- BILL REMINDER SCHEMAS ---

class BillReminderCreate(BaseModel):
    title: str
    amount: float = Field(..., gt=0)
    due_date: datetime
    status: Optional[str] = "Pending"  # Pending, Paid
    category: Optional[str] = None

class BillReminderResponse(BaseModel):
    id: int
    title: str
    amount: float
    due_date: datetime
    status: str
    category: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# --- DASHBOARD & ANALYTICS ---

class DashboardSummary(BaseModel):
    monthly_salary: float
    savings_goal: float
    total_expenses: float
    remaining_budget: float
    savings_progress: float  # Percentage of savings goal reached
    emergency_fund_saved: float
    alerts: List[str]
