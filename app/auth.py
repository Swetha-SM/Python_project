import datetime
import hashlib
import os
import jwt
from fastapi import Request, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.config import JWT_SECRET, ACCESS_TOKEN_EXPIRE_MINUTES
from app.database import get_db
from app.models import User

# --- PASSWORD HASHING ---
def hash_password(password: str) -> str:
    """Hash password using PBKDF2 with SHA-256 and a random salt."""
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return salt.hex() + ":" + pw_hash.hex()

def verify_password(password: str, hashed_password: str) -> bool:
    """Verify password against its hash value."""
    try:
        salt_hex, hash_hex = hashed_password.split(":")
        salt = bytes.fromhex(salt_hex)
        pw_hash = bytes.fromhex(hash_hex)
        check_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
        return check_hash == pw_hash
    except Exception:
        return False

# --- JWT TOKENS ---
def create_access_token(data: dict) -> str:
    """Generate JWT Access Token."""
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")
    return encoded_jwt

def decode_access_token(token: str) -> int | None:
    """Decode JWT token and return the user ID or None."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        return int(user_id) if user_id else None
    except jwt.PyJWTError:
        return None

# --- FASTAPI DEPENDENCY ---
def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    FastAPI dependency to retrieve the current logged-in user.
    Looks for JWT token in Authorization header or in an 'access_token' cookie.
    """
    token = None
    
    # 1. Check Authorization Header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        
    # 2. Fallback to access_token Cookie (useful for frontend SPA page loads)
    if not token:
        token = request.cookies.get("access_token")
        
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
        )
        
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
        
    return user
