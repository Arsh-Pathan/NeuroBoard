import logging
from app.models.ai_process_model import (
    AIProcessRequest,
    AIProcessResponse,
    DetectedShape,
    MathResult,
)
from app.ai.llm_recognizer import recognize_with_llm
from app.ai.shape_detection.detector import ShapeDetector
from app.ai.math_recognition.recognizer import MathRecognizer
from app.ai.math_recognition.solver import MathSolver

logger = logging.getLogger(__name__)


class AIProcessService:
    """
    Unified AI pipeline that processes a canvas screenshot.

    Strategy:
    1. Try OpenRouter LLM vision (best quality for handwriting + shapes)
    2. Fall back to local OpenCV shape detection + pytesseract OCR
    """

    def __init__(self):
        self.shape_detector = ShapeDetector()
        self.math_recognizer = MathRecognizer()
        self.math_solver = MathSolver()

    async def process(self, request: AIProcessRequest) -> AIProcessResponse:
        image = request.image_base64

        # --- Strategy 1: LLM Vision (OpenRouter) ---
        llm_result = await recognize_with_llm(image)
        if llm_result:
            return self._parse_llm_result(llm_result)

        # --- Strategy 2: Local fallback ---
        logger.info("Falling back to local OpenCV + Tesseract pipeline")
        return self._local_fallback(image)

    def _parse_llm_result(self, data: dict) -> AIProcessResponse:
        """Parse the structured JSON from the LLM into our response model."""
        shapes = []
        for s in data.get("shapes", []):
            shapes.append(
                DetectedShape(
                    type=s.get("type", "rectangle"),
                    x=float(s.get("x", 0)),
                    y=float(s.get("y", 0)),
                    width=float(s.get("width", 50)),
                    height=float(s.get("height", 50)),
                    radius=float(s["radius"]) if s.get("radius") else None,
                    points=[float(p) for p in s["points"]] if s.get("points") else None,
                    confidence=float(s.get("confidence", 0.9)),
                )
            )

        math = None
        if data.get("math") and data["math"].get("equation"):
            math = MathResult(
                equation=data["math"]["equation"],
                solution=data["math"].get("solution", ""),
            )

        return AIProcessResponse(
            shapes=shapes,
            math=math,
            raw_text=data.get("raw_text", ""),
        )

    def _local_fallback(self, image_base64: str) -> AIProcessResponse:
        """Use OpenCV for shapes and Tesseract for math as fallback."""
        shapes = []
        math = None
        raw_text = ""

        # Shape detection from image
        try:
            detected = self.shape_detector.detect_from_image(image_base64)
            for s in detected:
                shapes.append(
                    DetectedShape(
                        type=s["type"],
                        x=s["x"],
                        y=s["y"],
                        width=s["width"],
                        height=s["height"],
                        radius=s.get("radius"),
                        points=s.get("points"),
                        confidence=s.get("confidence", 0.8),
                    )
                )
        except Exception as e:
            logger.error("Shape detection failed: %s", e)

        # Math OCR
        try:
            equation_text = self.math_recognizer.extract_text(image_base64)
            if equation_text:
                raw_text = equation_text
                solution = self.math_solver.solve(equation_text)
                if solution and not solution.startswith("Error"):
                    math = MathResult(equation=equation_text, solution=solution)
        except Exception as e:
            logger.error("Math recognition failed: %s", e)

        return AIProcessResponse(
            shapes=shapes,
            math=math,
            raw_text=raw_text,
        )
