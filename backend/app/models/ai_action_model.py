from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import datetime


class AIActionRecord(BaseModel):
    board_id: str
    timestamp: datetime
    shapes_detected: List[Any] = []
    math_result: Optional[Any] = None
    raw_text: str = ""
    source: str = "llm"  # 'llm' or 'local'
