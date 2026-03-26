# AI Smart Canvas

This is an AI-powered digital whiteboard designed for classrooms, engineers, and collaborative learning.

## Project Overview

AI Smart Canvas transforms a normal digital whiteboard into an intelligent assistant capable of:
- Converting rough sketches into clean diagrams
- Recognizing handwritten math and solving it
- Understanding written topics and suggesting related diagrams
- Automatically aligning shapes
- Supporting collaborative drawing via WebSockets
- Working on touch screens, tablets, and smart boards

## Architecture Diagram (Conceptual)
Current structure consists of:
- **Frontend**: React, TypeScript, Fabric.js
- **Backend**: Python, FastAPI, Clean Architecture
- **Database**: MongoDB
- **Real-time**: WebSockets
- **Deployment**: Docker, Nginx, GitHub Actions

## Setup Instructions

### Backend (Python/FastAPI)
1. Navigate to the `backend` directory.
2. Create a virtual environment: `python -m venv venv`
3. Activate the environment: `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux).
4. Install dependencies: `pip install -r requirements.txt`
5. Run the dev server: `uvicorn app.main:app --reload`

### Frontend (React/TypeScript)
*(Detailed instructions to be added once frontend is initialized)*

### Deployment Instructions
1. We use Docker to host services (frontend, backend, mongodb, nginx).
2. Use `docker-compose up --build -d` to run the stack.
3. Access at your configured domain or `http://localhost`.

## API Documentation
Standard FastAPI Swagger docs are available at `/docs` when running the backend. Key endpoints soon to be implemented:
- `POST /detect-shapes`
- `POST /solve-math`
- `POST /generate-diagram`
- `POST /analyze-topic`
- `POST /save-board`
- `GET /board/{id}`

## Future Improvements
- Add advanced custom shape detection
- Integration with specialized LLM agents for deep subject explanations
- Full history rewind and playback features

