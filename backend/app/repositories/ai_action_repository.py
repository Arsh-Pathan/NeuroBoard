from datetime import datetime, timezone
from typing import List
from app.models.ai_action_model import AIActionRecord
from app.database.mongo import db

ai_actions_collection = db.get_collection("ai_actions")


class AIActionRepository:
    async def save_action(self, record: AIActionRecord) -> None:
        await ai_actions_collection.insert_one(record.model_dump())

    async def get_actions_for_board(self, board_id: str, limit: int = 50) -> List[AIActionRecord]:
        cursor = ai_actions_collection.find(
            {"board_id": board_id}
        ).sort("timestamp", -1).limit(limit)

        results = []
        async for doc in cursor:
            doc.pop("_id", None)
            results.append(AIActionRecord(**doc))
        return results
