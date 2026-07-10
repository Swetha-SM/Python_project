import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Date
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    monthly_salary = Column(Float, default=0.0)
    savings_goal = Column(Float, default=0.0)
    bank_balance = Column(Float, default=0.0)
    family_info = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


    # Relationships
    budgets = relationship("BudgetCategory", back_populates="user", cascade="all, delete-orphan")
    expenses = relationship("Expense", back_populates="user", cascade="all, delete-orphan")
    bills = relationship("BillReminder", back_populates="user", cascade="all, delete-orphan")
    bank_account = relationship("BankAccount", back_populates="user", uselist=False, cascade="all, delete-orphan")


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    bank_name = Column(String(150), nullable=False)
    account_holder = Column(String(150), nullable=False)
    account_number = Column(String(20), nullable=False)
    ifsc_code = Column(String(20), nullable=False)
    balance = Column(Float, default=0.0)
    salary = Column(Float, default=0.0)
    savings_goal = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="bank_account")



class BudgetCategory(Base):
    __tablename__ = "budget_categories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_name = Column(String(100), nullable=False)
    percentage = Column(Float, nullable=False)  # Percentage out of 100
    allocated_amount = Column(Float, nullable=False)
    month = Column(String(7), nullable=False)  # YYYY-MM

    # Relationships
    user = relationship("User", back_populates="budgets")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String(100), nullable=False)
    payment_method = Column(String(50), nullable=False)  # Cash, Credit Card, Debit Card, UPI, Net Banking
    description = Column(String(255), nullable=True)
    date = Column(Date, nullable=False)  # Actual transaction date
    receipt_path = Column(String(500), nullable=True)  # File path to receipt
    merchant = Column(String(100), nullable=True)  # Virtual Payment Merchant
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


    # Relationships
    user = relationship("User", back_populates="expenses")


class BillReminder(Base):
    __tablename__ = "bill_reminders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(150), nullable=False)  # Rent, Water, Electricity, EMI, Insurance, Internet, etc.
    amount = Column(Float, nullable=False)
    due_date = Column(DateTime, nullable=False)
    status = Column(String(20), default="Pending", nullable=False)  # Pending, Paid
    category = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="bills")
