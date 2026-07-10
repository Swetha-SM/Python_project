import os
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./household_finance.db")
JWT_SECRET = os.getenv("JWT_SECRET", "8f9a2b5d4e7c3b2a1f0e9d8c7b6a5f4e3d2c1b0a7f6e5d4c3b2a1f0e9d8c7b6a")
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

# Server Settings
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))

# Upload Directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
