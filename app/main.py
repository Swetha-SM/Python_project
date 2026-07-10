import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.database import engine, Base
from app.routes import auth, budget, expenses, bills, reports, suggestions, payments, bank, analysis

from app.config import HOST, PORT

# Initialize database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Intelligent Household Finance Management System",
    description="FastAPI backend for tracking household budget, expenses, bill reminders, and suggestions.",
    version="1.0.0"
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure static directories exist
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "uploads"), exist_ok=True)

# Register Router Modules
app.include_router(auth.router)
app.include_router(budget.router)
app.include_router(expenses.router)
app.include_router(bills.router)
app.include_router(reports.router)
app.include_router(suggestions.router)
app.include_router(payments.router)
app.include_router(bank.router)
app.include_router(analysis.router)



# Mount Static Files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Serve index.html at root
@app.get("/")
def read_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Household Finance API is running. index.html not found yet."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
