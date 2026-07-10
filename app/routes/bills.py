import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, BillReminder
from app.schemas import BillReminderCreate, BillReminderResponse
from app.auth import get_current_user
from typing import List, Optional

router = APIRouter(prefix="/api/bills", tags=["bills"])

@router.get("/", response_model=List[BillReminderResponse])
def get_bills(
    status_filter: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves all bill reminders for the current user, optionally filtered by status (Paid/Pending)."""
    query = db.query(BillReminder).filter(BillReminder.user_id == current_user.id)
    if status_filter:
        query = query.filter(BillReminder.status == status_filter)
    return query.order_by(BillReminder.due_date.asc()).all()

@router.post("/", response_model=BillReminderResponse, status_code=status.HTTP_201_CREATED)
def create_bill(
    bill_data: BillReminderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Creates a new bill reminder."""
    new_bill = BillReminder(
        user_id=current_user.id,
        title=bill_data.title,
        amount=bill_data.amount,
        due_date=bill_data.due_date,
        status=bill_data.status or "Pending",
        category=bill_data.category
    )
    db.add(new_bill)
    db.commit()
    db.refresh(new_bill)
    return new_bill

@router.patch("/{bill_id}/status", response_model=BillReminderResponse)
def update_bill_status(
    bill_id: int,
    status_val: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates the paid status of a bill reminder (Pending vs Paid)."""
    if status_val not in ["Pending", "Paid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be either 'Pending' or 'Paid'."
        )
        
    bill = db.query(BillReminder).filter(
        BillReminder.id == bill_id,
        BillReminder.user_id == current_user.id
    ).first()
    
    if not bill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill reminder not found."
        )
        
    bill.status = status_val
    db.commit()
    db.refresh(bill)
    return bill

@router.delete("/{bill_id}", status_code=status.HTTP_200_OK)
def delete_bill(
    bill_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes a bill reminder."""
    bill = db.query(BillReminder).filter(
        BillReminder.id == bill_id,
        BillReminder.user_id == current_user.id
    ).first()
    
    if not bill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill reminder not found."
        )
        
    db.delete(bill)
    db.commit()
    return {"detail": "Bill reminder successfully deleted."}

@router.get("/alerts")
def get_bill_alerts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns alerts for upcoming and overdue bills, as well as budget issues.
    - Upcoming bills due in <= 3 days.
    - Overdue bills that are still Pending.
    """
    now = datetime.datetime.now()
    pending_bills = db.query(BillReminder).filter(
        BillReminder.user_id == current_user.id,
        BillReminder.status == "Pending"
    ).all()
    
    alerts = []
    for bill in pending_bills:
        if now > bill.due_date:
            # Overdue
            delta_seconds = (now - bill.due_date).total_seconds()
            delta_days = int(delta_seconds / 86400)
            if delta_days == 0:
                time_str = "today"
                hours = int(delta_seconds / 3600)
                if hours > 0:
                    time_str += f" ({hours}h ago)"
                else:
                    mins = int(delta_seconds / 60)
                    time_str += f" ({mins}m ago)"
                message = f"⚠ {bill.title} bill was due {time_str} (Due: {bill.due_date.strftime('%d %b, %I:%M %p')})"
            else:
                message = f"⚠ {bill.title} bill is overdue by {delta_days} days (Due: {bill.due_date.strftime('%d %b, %I:%M %p')})"
                
            alerts.append({
                "type": "bill_overdue",
                "bill_id": bill.id,
                "title": bill.title,
                "amount": bill.amount,
                "due_date": bill.due_date,
                "message": message,
                "days": -delta_days if delta_days > 0 else 0
            })
        else:
            # Upcoming (due in <= 3 days)
            delta_seconds = (bill.due_date - now).total_seconds()
            delta_days = int(delta_seconds / 86400)
            
            if delta_seconds <= 3 * 86400:
                if delta_days == 0:
                    hours = int(delta_seconds / 3600)
                    if hours > 0:
                        day_str = f"in {hours} hours"
                    else:
                        mins = int(delta_seconds / 60)
                        day_str = f"in {mins} minutes"
                elif delta_days == 1:
                    day_str = "tomorrow"
                else:
                    day_str = f"in {delta_days} days"
                    
                alerts.append({
                    "type": "bill_upcoming",
                    "bill_id": bill.id,
                    "title": bill.title,
                    "amount": bill.amount,
                    "due_date": bill.due_date,
                    "message": f"⚠ {bill.title} bill due {day_str} ({bill.due_date.strftime('%d %b, %I:%M %p')})",
                    "days": delta_days
                })
                
    return alerts

@router.put("/{bill_id}", response_model=BillReminderResponse)
def update_bill(
    bill_id: int,
    bill_data: BillReminderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates a bill reminder details (title, amount, due_date, status, category)."""
    bill = db.query(BillReminder).filter(
        BillReminder.id == bill_id,
        BillReminder.user_id == current_user.id
    ).first()
    
    if not bill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill reminder not found."
        )
        
    bill.title = bill_data.title
    bill.amount = bill_data.amount
    bill.due_date = bill_data.due_date
    bill.status = bill_data.status or bill.status
    bill.category = bill_data.category
    
    db.commit()
    db.refresh(bill)
    return bill

