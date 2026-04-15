from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.coach import chat

router = APIRouter(prefix="/coach", tags=["coach"])

_DAILY_LIMIT = 20

# In-memory rate limiter: {(athlete_id, date): count}
_message_counts: dict[tuple[str, date], int] = defaultdict(int)


class ChatMessage(BaseModel):
    role: str   # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    athlete_id: str
    message: str
    history: list[ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str
    messages_today: int


@router.post("/chat")
async def coach_chat(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
) -> ChatResponse:
    """Send a message to the AI coach and get a data-grounded reply."""
    today = date.today()
    key = (req.athlete_id, today)
    count = _message_counts[key]

    if count >= _DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily message limit of {_DAILY_LIMIT} reached. Try again tomorrow.",
        )

    history = [{"role": m.role, "content": m.content} for m in req.history]
    reply = await chat(req.athlete_id, req.message, history, db)

    _message_counts[key] += 1
    return ChatResponse(reply=reply, messages_today=_message_counts[key])
