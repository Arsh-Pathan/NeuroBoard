const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/auto"; // High-availability Free Vision Model

const math = require("mathjs");
const nerdamer = require("nerdamer");
require("nerdamer/Solve");
require("nerdamer/Calculus");
require("nerdamer/Algebra");

async function callOpenRouter(messages) {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === "your_api_key_here") {
    throw new Error("Missing OPENROUTER_API_KEY. Please set it in backend/.env!");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 2048,
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeMathInput(raw) {
  if (!raw || typeof raw !== "string") return "";
  let expr = raw.trim();
  expr = expr
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[–−]/g, "-")
    .replace(/√/g, "sqrt")
    .replace(/π/g, "pi")
    .replace(/([0-9])\s*\(/g, "$1*(")
    .replace(/\)\s*([0-9])/g, ")*$1")
    .replace(/\|([^|]+)\|/g, "abs($1)")
    .replace(/\s+/g, " ")
    .trim();
  return expr;
}

function getVariables(expr) {
  const matches = expr.match(/[a-zA-Z]/g) || [];
  return Array.from(new Set(matches.filter((v) => !["e", "E", "i"].includes(v))));
}

function formatNumber(value) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toString();
    return parseFloat(value.toPrecision(12)).toString();
  }
  return value.toString();
}

function toSuperscript(value) {
  const map = {
    0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ",
  };
  return String(value).split("").map((ch) => map[ch] || ch).join("");
}

function formatMathString(raw) {
  if (raw === null || raw === undefined) return "";
  let text = String(raw).trim();
  text = text
    .replace(/sqrt\(/gi, "√(")
    .replace(/\bpi\b/gi, "π")
    .replace(/abs\(([^)]+)\)/gi, "|$1|")
    .replace(/([0-9A-Za-z\)\]])\^([0-9]+)/g, (_, base, exp) => `${base}${toSuperscript(exp)}`)
    .replace(/([0-9A-Za-z\)\]])\^\(([0-9]+)\)/g, (_, base, exp) => `${base}${toSuperscript(exp)}`);
  return text;
}

function formatSolutionArray(values) {
  if (!values) return [];
  if (Array.isArray(values)) return values.map((v) => formatMathString(v && v.toString ? v.toString() : String(v)));
  return [formatMathString(values.toString())];
}

function solveNumericExpression(expr) {
  const normalized = normalizeMathInput(expr);
  const value = math.evaluate(normalized);
  return [formatNumber(value)];
}

function solveEquation(expr) {
  const normalized = normalizeMathInput(expr);
  const parts = normalized.split("=").map((part) => part.trim());
  if (parts.length !== 2) return [];
  const [left, right] = parts;
  const equation = `(${left})-(${right})`;
  const variables = getVariables(equation);
  if (!variables.length) {
    const result = math.evaluate(equation);
    return [result === 0 ? "True" : "False"];
  }

  try {
    const solutions = nerdamer.solveEquations(equation, variables[0]);
    return formatSolutionArray(solutions);
  } catch {
    return [];
  }
}

function solveDerivative(expr) {
  const normalized = normalizeMathInput(expr);
  let variable = "x";
  let payload = normalized;
  const match = normalized.match(/d\/d([a-zA-Z])/i);
  if (match) {
    variable = match[1];
    payload = normalized.replace(/d\/d[a-zA-Z]\s*/i, "");
  }
  try {
    return [nerdamer.diff(payload, variable).toString()];
  } catch {
    return [];
  }
}

function solveIntegral(expr) {
  const normalized = normalizeMathInput(expr);
  let variable = "x";
  let payload = normalized;
  const match = normalized.match(/∫\s*(.*?)\s*d([a-zA-Z])/);
  if (match) {
    payload = match[1];
    variable = match[2];
  }
  try {
    return [nerdamer.integrate(payload, variable).toString() + " + C"];
  } catch {
    return [];
  }
}

function solveLimit(expr) {
  const normalized = normalizeMathInput(expr);
  const limitMatch = normalized.match(/lim\s*([a-zA-Z])\s*->\s*([\-\d\.]+)\s*(.*)/i);
  if (!limitMatch) return [];
  const variable = limitMatch[1];
  const target = parseFloat(limitMatch[2]);
  let func = limitMatch[3].trim();
  if (func.startsWith("(")) func = func.replace(/^\((.*)\)$/, "$1");
  try {
    const delta = 1e-6;
    const parser = math.parser();
    parser.set(variable, target + delta);
    const plus = parser.evaluate(func);
    parser.set(variable, target - delta);
    const minus = parser.evaluate(func);
    if (isFinite(plus) && isFinite(minus) && Math.abs(plus - minus) < 1e-3) {
      return [formatNumber((plus + minus) / 2)];
    }
    if (isFinite(plus)) return [formatNumber(plus)];
  } catch {
    return [];
  }
  return [];
}

function solveMatrix(expr) {
  const normalized = normalizeMathInput(expr);
  try {
    const matrix = math.evaluate(normalized);
    if (!Array.isArray(matrix) || !Array.isArray(matrix[0])) return [];
    const results = [];
    const det = math.det(matrix);
    results.push(`determinant = ${formatNumber(det)}`);
    if (matrix.length === matrix[0].length) {
      try {
        const inv = math.inv(matrix);
        results.push(`inverse = ${JSON.stringify(inv)}`);
      } catch {
        results.push("inverse = not invertible");
      }
    }
    return results;
  } catch {
    return [];
  }
}

function solveVector(expr) {
  const normalized = normalizeMathInput(expr);
  const assignments = normalized.split(";").map((part) => part.trim()).filter(Boolean);
  const vars = {};
  assignments.forEach((assignment) => {
    const match = assignment.match(/^([a-zA-Z])\s*=\s*\(([^)]+)\)$/);
    if (match) {
      vars[match[1]] = match[2].split(",").map((n) => parseFloat(n.trim()));
    }
  });
  if (!vars.a || !vars.b) return [];
  const results = [];
  const dot = math.dot(vars.a, vars.b);
  results.push(`a · b = ${formatNumber(dot)}`);
  if (vars.a.length === 3 && vars.b.length === 3) {
    const cross = math.cross(vars.a, vars.b);
    results.push(`a × b = [${cross.join(", ")}]`);
  }
  results.push(`|a| = ${formatNumber(math.norm(vars.a))}`);
  return results;
}

function solveSummation(expr) {
  const normalized = normalizeMathInput(expr);
  const sigmaMatch = normalized.match(/Σ\s*\(\s*([a-zA-Z])\s*=\s*([\d\.]+)\.\.([\d\.]+)\s*\)\s*(.+)/);
  if (!sigmaMatch) return [];
  const variable = sigmaMatch[1];
  const start = parseInt(sigmaMatch[2], 10);
  const end = parseInt(sigmaMatch[3], 10);
  const term = sigmaMatch[4];
  let total = 0;
  for (let i = start; i <= end; i += 1) {
    total += math.evaluate(term.replace(new RegExp(variable, "g"), `(${i})`));
  }
  return [formatNumber(total)];
}

function solveStatistics(expr) {
  const normalized = normalizeMathInput(expr);
  const funcMatch = normalized.match(/(mean|median|variance|stdev|std)\s*\((\[.*\])\)/i);
  if (!funcMatch) return [];
  const func = funcMatch[1].toLowerCase();
  const arrayText = funcMatch[2];
  try {
    const array = math.evaluate(arrayText);
    if (!Array.isArray(array)) return [];
    switch (func) {
      case "mean":
        return [`${formatNumber(math.mean(array))}`];
      case "median":
        return [`${formatNumber(math.median(array))}`];
      case "variance":
        return [`${formatNumber(math.variance(array))}`];
      case "std":
      case "stdev":
        return [`${formatNumber(math.std(array))}`];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

function solveGeometry(expr) {
  const normalizedLower = expr.toLowerCase();
  if (/triangle\s+sides\s*([\d\.,\s]+)/i.test(normalizedLower)) {
    const match = normalizedLower.match(/triangle\s+sides\s*([\d\.,\s]+)/i);
    const sides = match[1].split(/[,\s]+/).map((n) => parseFloat(n.trim())).filter(Boolean);
    if (sides.length === 3) {
      const [a, b, c] = sides;
      const s = (a + b + c) / 2;
      const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
      return [`area = ${formatNumber(area)}`];
    }
  }
  if (/circle\s+(?:radius|r)\s*([\d\.]+)/i.test(normalizedLower)) {
    const match = normalizedLower.match(/circle\s+(?:radius|r)\s*([\d\.]+)/i);
    const r = parseFloat(match[1]);
    const area = Math.PI * r * r;
    return [`area = ${formatNumber(area)}`];
  }
  return [];
}

function solveFunctionAnalysis(expr) {
  const normalized = normalizeMathInput(expr);
  const funcText = normalized.replace(/^y\s*=\s*/i, "");
  const results = [];
  try {
    const roots = nerdamer.solveEquations(`(${funcText})`, "x");
    if (roots && roots.length) results.push(`roots = ${formatSolutionArray(roots).join(", ")}`);
  } catch {}
  try {
    results.push(`derivative = ${nerdamer.diff(funcText, "x").toString()}`);
  } catch {}
  if (/\//.test(funcText)) {
    results.push("domain: x ≠ values that make denominator zero");
  } else {
    results.push("domain: all real numbers");
  }
  results.push("range: depends on function shape");
  return results;
}

async function explainSteps(expression, solutionItems) {
  try {
    const solutionText = Array.isArray(solutionItems) ? solutionItems.join(", ") : String(solutionItems);
    const messages = [
      {
        role: "system",
        content: "You are a patient math tutor. Explain step by step how to solve the given expression. Return only enumerated steps, each starting with Step 1, Step 2, etc. Do not include any extra text or markdown formatting.",
      },
      {
        role: "user",
        content: `Expression: ${expression}\nSolution: ${solutionText}`,
      },
    ];
    const raw = await callOpenRouter(messages);
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    console.error("Explain steps failed", err);
    return [];
  }
}

async function extractExpressionFromImage(base64Image) {
  const messages = [
    {
      role: "system",
      content: "You are a handwritten math OCR assistant. Convert the supplied image into a single clean math expression or equation. Return ONLY valid JSON: { \"expression\": \"...\" }. No explanations.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Convert the handwriting in this image into a mathematical expression or equation."
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
  const raw = await callOpenRouter(messages);
  let cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  const parsed = safeJsonParse(cleaned);
  if (parsed && parsed.expression) return { expression: parsed.expression };
  return { expression: cleaned };
}

async function solveExpression(rawExpression) {
  const cleaned = normalizeMathInput(rawExpression);
  if (!cleaned) throw new Error("Empty expression");
  const solution = [];
  let category = "arithmetic";
  if (/d\/d|derivative|∫|integral|lim|limit/i.test(cleaned)) {
    if (/d\/d|derivative/i.test(cleaned)) {
      category = "calculus";
      solution.push(...solveDerivative(cleaned));
    }
    if (/∫|integral/i.test(cleaned)) {
      category = "calculus";
      solution.push(...solveIntegral(cleaned));
    }
    if (/lim|limit/i.test(cleaned)) {
      category = "calculus";
      solution.push(...solveLimit(cleaned));
    }
  } else if (/\b(mean|median|variance|std|stdev)\b/i.test(cleaned)) {
    category = "statistics";
    solution.push(...solveStatistics(cleaned));
  } else if (/Σ|sigma|sum\s*\(/i.test(cleaned)) {
    category = "series";
    solution.push(...solveSummation(cleaned));
  } else if (/^\s*\[\[/.test(cleaned)) {
    category = "matrix";
    solution.push(...solveMatrix(cleaned));
  } else if (/\b(dot|cross|projection|magnitude)\b/i.test(cleaned) && /[a-zA-Z]=\s*\(/i.test(cleaned)) {
    category = "vector";
    solution.push(...solveVector(cleaned));
  } else if (/\btriangle\b|\bcircle\b|\bpolygon\b|\bdistance\b/i.test(cleaned)) {
    category = "geometry";
    solution.push(...solveGeometry(cleaned));
  } else if (/^y\s*=/.test(cleaned) || /sin\(|cos\(|tan\(/i.test(cleaned)) {
    category = "graph";
    solution.push(...solveFunctionAnalysis(cleaned));
  } else if (cleaned.includes("=")) {
    category = "equation";
    solution.push(...solveEquation(cleaned));
  }
  if (!solution.length) {
    try {
      solution.push(...solveNumericExpression(cleaned));
      category = "arithmetic";
    } catch (err) {
      const messages = [
        {
          role: "system",
          content: "You are a math solver. Solve the expression and return only the final answer. No explanation.",
        },
        {
          role: "user",
          content: `Solve: ${cleaned}`,
        },
      ];
      const fallback = await callOpenRouter(messages);
      solution.push(fallback);
      category = "ai_fallback";
    }
  }

  solution = solution.map(formatMathString);
  const steps = await explainSteps(cleaned, solution);
  return {
    expression: cleaned,
    solution,
    steps,
    category,
  };
}

async function solveMath(expression) {
  return solveExpression(expression);
}

async function solveImageMath(base64Image) {
  const ocr = await extractExpressionFromImage(base64Image);
  const expr = ocr.expression || ocr.text || "";
  if (!expr.trim()) {
    return {
      expression: "",
      solution: [],
      steps: [],
      ocr: expr,
    };
  }
  const result = await solveExpression(expr);
  return {
    ...result,
    ocr: expr,
  };
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
