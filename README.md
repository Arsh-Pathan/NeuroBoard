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

#### 1. Local Development (Docker Compose)
- We use Docker to host services (frontend, backend, mongodb, nginx).
- Use `docker-compose up --build -d` to run the stack.
- Access at your configured domain or `http://localhost`.

#### 2. Cloud Deployment (CodeHost)
- CodeHost is optimized for student projects. To deploy:
- 1. Create a ZIP of the root directory (ensure the `Dockerfile` is at the root).
- 2. Upload the ZIP to the [CodeHost Dashboard](https://code-host.online/dashboard).
- 3. **Note:** The project is now **self-sustained**. It includes its own local MongoDB instance, so you do **not** need to set `MONGO_URI` (though you still can if you want an external DB).
- 4. CodeHost will automatically detect the root `Dockerfile` and build the entire stack.

### API Documentation
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

