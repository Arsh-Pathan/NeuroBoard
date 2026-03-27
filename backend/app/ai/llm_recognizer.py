import os
import json
import httpx
import logging

logger = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are a vision AI that analyzes whiteboard canvas screenshots.
Your job is to identify ALL drawn content and classify each item as either a SHAPE or a MATH EQUATION.

Respond with ONLY valid JSON (no markdown, no code fences) matching this exact schema:
{
  "shapes": [
    {
      "type": "circle" | "rectangle" | "triangle" | "diamond" | "arrow" | "line",
      "x": <number, top-left x of bounding box>,
      "y": <number, top-left y of bounding box>,
      "width": <number>,
      "height": <number>,
      "radius": <number or null, only for circles>,
      "points": [x1, y1, x2, y2] or null (only for arrows/lines)
    }
  ],
  "math": {
    "equation": "<the recognized equation as a string, e.g. '2+x=5'>",
    "solution": "<the solved result, e.g. 'x = 3'>"
  } or null if no math is found,
  "raw_text": "<any other text you can read on the canvas>"
}

Rules:
- If you see rough/freehand circles, classify them as "circle" and estimate the bounding box.
- If you see rough rectangles/squares, classify as "rectangle".
- If you see arrow-like strokes, classify as "arrow" with start/end points.
- If you see handwritten math (equations, expressions), put them in "math" and solve them.
- Coordinates should be in pixel space relative to the image dimensions.
- If the canvas is empty or you can't identify anything, return {"shapes": [], "math": null, "raw_text": ""}.
- Always solve math equations completely. For algebra like "2+x=5", solve for x.
"""


async def recognize_with_llm(image_base64: str) -> dict | None:
    """Send canvas screenshot to OpenRouter vision model for recognition."""
    if not OPENROUTER_API_KEY:
        logger.warning("OPENROUTER_API_KEY not set, skipping LLM recognition")
        return None

    # Ensure proper data URI format
    if not image_base64.startswith("data:"):
        image_base64 = f"data:image/png;base64,{image_base64}"

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyze this whiteboard canvas screenshot. Identify all shapes and math equations."},
                    {"type": "image_url", "image_url": {"url": image_base64}},
                ],
            },
        ],
        "temperature": 0.1,
        "max_tokens": 2048,
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://neuroboard.arsh-io.website",
        "X-Title": "NeuroBoard AI Canvas",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
            resp.raise_for_status()

        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        # Strip markdown code fences if the model wraps output
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        if content.startswith("json"):
            content = content[4:].strip()

        return json.loads(content)

    except httpx.HTTPStatusError as e:
        logger.error("OpenRouter API error: %s %s", e.response.status_code, e.response.text[:200])
        return None
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        logger.error("Failed to parse LLM response: %s", e)
        return None
    except Exception as e:
        logger.error("LLM recognition failed: %s", e)
        return None
