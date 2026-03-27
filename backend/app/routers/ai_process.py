from fastapi import APIRouter, Depends
from app.models.ai_process_model import AIProcessRequest, AIProcessResponse
from app.services.ai_process_service import AIProcessService

router = APIRouter(tags=["AI Processing"])

_service = None


def get_service() -> AIProcessService:
    global _service
    if _service is None:
        _service = AIProcessService()
    return _service


@router.post("/ai-process", response_model=AIProcessResponse)
async def ai_process(
    request: AIProcessRequest,
    service: AIProcessService = Depends(get_service),
):
    """
    Unified AI endpoint: accepts a canvas screenshot (base64) and returns
    detected shapes + solved math equations.

    Uses OpenRouter LLM vision as primary, falls back to local OpenCV + Tesseract.
    """
    return await service.process(request)
