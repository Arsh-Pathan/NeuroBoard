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
      role: "system",
      content: `You are an OCR and Math parser. You MUST return ONLY valid JSON.
      Return exactly this format:
      {
        "expressions": [
          { "expression": "4-3=", "result": 1 },
          { "expression": "1+2=", "result": 3 }
        ]
      }
      Rules:
      - No explanations, no extra text, no markdown block quotes.
      - Each line is a separate expression.
      - Evaluate the math accurately following standard BODMAS.
      - Replace implicit multiplication, e.g., 2(3+4) becomes 2*(3+4).
      - If no math is found, return { "expressions": [] }.`
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Identify and solve all math expressions ending in '=' in this image.`
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
    // 1. Cleanup raw AI text heavily
    let cleaned = result.trim();
    // Remove markdown code blocks
    cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    // Extract everything between first { and last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    
    console.log("[AI Image response] Raw:", result);
    console.log("[AI Image response] Cleaned:", cleaned);
    
    const parsed = JSON.parse(cleaned);
    
    if (parsed && Array.isArray(parsed.expressions)) {
      // Map to the format CanvasBoard expects (expr, ans)
      return parsed.expressions.map(item => ({
        expr: item.expression,
        ans: item.result
      }));
    }
    
    return [];
  } catch (e) {
    console.error("AI JSON parsing failed:", e.message);
    console.error("AI Response was:", result);
    
    // 2. Fallback: naive text parsing if the AI stubbornly returned text
    // We split by lines, extract math-looking parts, normalize, and evaluate safely.
    const fallbackResults = [];
    const lines = result.split('\n');
    
    // Minimal safe evaluator for Node.js backend
    const evaluateMath = (expr) => {
      try {
        // Normalize symbols and implicit multiplication
        let clean = expr
          .replace(/×/g, '*')
          .replace(/÷/g, '/')
          .replace(/–/g, '-')
          .replace(/−/g, '-')
          .replace(/\s+/g, '');
        
        // 2(3) -> 2*(3)
        clean = clean.replace(/(\d)(\()/g, '$1*$2');
        // (2)(3) -> (2)*(3)
        clean = clean.replace(/(\))(\()/g, '$1*$2');
        
        // Only allow math chars safely
        if (/[^0-9+\-*/().]/.test(clean)) return null;
        
        // Safe Function eval
        const val = new Function(`return ${clean}`)();
        return isFinite(val) ? val : null;
      } catch {
        return null;
      }
    };

    for (const line of lines) {
      // Find anything that looks like an expression optionally ending with =
      const match = line.match(/([0-9()+\-*/.,x×÷–−\s]+)=/i) || line.match(/([0-9()+\-*/.,x×÷–−\s]{3,})/i);
      if (match) {
        let rawExpr = match[1].trim();
        if (!rawExpr) continue;
        
        const ans = evaluateMath(rawExpr);
        if (ans !== null && ans !== undefined) {
          fallbackResults.push({
            expr: rawExpr + "=",
            ans: ans
          });
        }
      }
    }
    
    if (fallbackResults.length > 0) {
      console.log("[AI Image response] Recovered using local fallback parser:", fallbackResults);
      return fallbackResults;
    }

    return []; // Safe empty array so frontend doesn't crash
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
