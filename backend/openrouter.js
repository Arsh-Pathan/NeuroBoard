const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/auto"; // High-availability Free Vision Model

async function callOpenRouter(messages) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function solveMath(expression) {
  const messages = [
    {
      role: "system",
      content:
        "You are a math solver. Solve the given math expression and return ONLY the final numerical answer. No explanation, no steps, just the number.",
    },
    {
      role: "user",
      content: `Solve: ${expression}`,
    },
  ];

  return callOpenRouter(messages);
}

async function solveImageMath(base64Image) {
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Identify all math expressions in the drawing. For each expression ending with '=', solve it.
          Return a JSON array of objects with: 
          - 'expr': the full expression (e.g., '2+2=')
          - 'ans': the numerical result (e.g., '4')
          - 'x': horizontal percentage (0 to 100) exactly where the answer should be placed (about 5-10% to the right of the expression's end)
          - 'y': vertical percentage (0 to 100) that aligns horizontally with the center of the expression
          - 'angle': angle of the expression in degrees (e.g., 5 if slanted down)
          
          VERY IMPORTANT: Be extremely precise with 'y' to align with the text.
          Return ONLY valid JSON array. Output: [{"expr":"...","ans":"...","x":0,"y":0,"angle":0}]`,
        },
        {
          type: "image_url",
          image_url: {
            url: base64Image,
          },
        },
      ],
    },
  ];

  const result = await callOpenRouter(messages);
  try {
    // Attempt to parse AI response as JSON (cleanup markdown if present)
    const cleaned = result.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("AI did not return valid JSON for multiple results:", result);
    return [];
  }
}

async function getTopicSuggestions(topic) {
  const messages = [
    {
      role: "system",
      content: `You are an educational diagram assistant. Given a topic, suggest exactly 3 educational diagrams that would help students understand the topic. Return ONLY a JSON array of 3 objects, each with "title" and "description" fields. No markdown, no code fences, just the raw JSON array.`,
    },
    {
      role: "user",
      content: `Topic: ${topic}`,
    },
  ];

  const raw = await callOpenRouter(messages);

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

module.exports = { solveMath, getTopicSuggestions, solveImageMath };
