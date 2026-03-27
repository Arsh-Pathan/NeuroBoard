from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import canvas, math, diagram, suggestions, websockets, board, ai_process

# Initialize the main FastAPI app
app = FastAPI(
    title="AI Smart Canvas API",
    description="Backend for AI-powered digital whiteboard",
    version="1.0.0"
)

# Configure CORS so the frontend can communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to frontend domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(canvas.router)
app.include_router(math.router)
app.include_router(diagram.router)
app.include_router(suggestions.router)
app.include_router(websockets.router)
app.include_router(board.router)
app.include_router(ai_process.router)

@app.get("/")
def read_root():
    """
    Health check endpoint to ensure the API is running.
    """
    return {"status": "ok", "message": "Welcome to AI Smart Canvas API"}
