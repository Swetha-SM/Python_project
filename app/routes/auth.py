from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import UserCreate, UserLogin, UserUpdate, UserResponse, Token
from app.auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    # Check if username exists
    existing_username = db.query(User).filter(User.username == user_data.username).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken.",
        )
        
    # Check if email exists
    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered.",
        )
        
    hashed_pw = hash_password(user_data.password)
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=hashed_pw,
        monthly_salary=0.0,
        savings_goal=0.0,
        family_info=""
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@router.post("/login")
def login(login_data: UserLogin, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )
        
    token = create_access_token({"user_id": user.id})
    
    # Set as cookie (expires in 1 day)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=60 * 64 * 24, # 1 day
        samesite="lax",
        secure=False  # Set to True in production with HTTPS
    )
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "monthly_salary": user.monthly_salary,
            "savings_goal": user.savings_goal,
            "family_info": user.family_info
        }
    }

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"detail": "Successfully logged out."}

@router.get("/profile", response_model=UserResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    return current_user

@router.put("/profile", response_model=UserResponse)
def update_profile(profile_data: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if profile_data.monthly_salary is not None:
        if current_user.monthly_salary != profile_data.monthly_salary or current_user.bank_balance == 0.0:
            current_user.bank_balance += profile_data.monthly_salary
        current_user.monthly_salary = profile_data.monthly_salary

    if profile_data.savings_goal is not None:
        current_user.savings_goal = profile_data.savings_goal
    if profile_data.family_info is not None:
        current_user.family_info = profile_data.family_info
        
    db.commit()
    db.refresh(current_user)
    return current_user
