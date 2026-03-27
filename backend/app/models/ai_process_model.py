from pydantic import BaseModel
from typing import List, Optional


class AIProcessRequest(BaseModel):
    image_base64: str


class DetectedShape(BaseModel):
    type: str  # 'rectangle', 'circle', 'triangle', 'line', 'arrow', 'diamond'
    x: float
    y: float
    width: float
    height: float
    radius: Optional[float] = None  # for circles
    points: Optional[List[float]] = None  # for arrows/lines [x1,y1,x2,y2]
    confidence: float = 0.9


class MathResult(BaseModel):
    equation: str
    solution: str


class AIProcessResponse(BaseModel):
    shapes: List[DetectedShape] = []
    math: Optional[MathResult] = None
    raw_text: str = ""
    error: Optional[str] = None
