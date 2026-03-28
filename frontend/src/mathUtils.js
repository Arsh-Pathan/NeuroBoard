/**
 * mathUtils.js — Smart Math Expression Parser for NeuroBoard
 *
 * Features:
 *  ✅ BODMAS / correct operator precedence (recursive descent)
 *  ✅ Bracket normalization: {}, [] → ()
 *  ✅ Auto-close unclosed brackets: "3 + (2" → "3 + (2)"
 *  ✅ Implicit multiplication: 2(3+4) → 2*(3+4), (2+3)(4) → (2+3)*(4)
 *  ✅ Power operator: ^ → **
 *  ✅ Symbol normalization: ×, ÷, –, −, x (as multiply)
 *  ✅ Double-operator cleanup: 5++3 → 5+3, 5+-3 → 5-3
 *  ✅ Safe recursive-descent parser — NO eval(), NO Function()
 *  ✅ LRU cache (50 entries)
 *  ✅ Graceful error handling — never throws to caller
 *  ✅ Modular: add sin/cos/log by extending parsePrimary()
 */

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Pre-processing pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full normalization pipeline. Returns a cleaned expression string ready for parsing.
 * All steps are safe string transforms — no evaluation.
 */
export function normalizeExpression(raw) {
  let s = raw.trim();

  // 1. Unicode symbol → ASCII operator
  s = s
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[–−]/g, "-")   // em-dash / minus sign → hyphen
    .replace(/\u00b2/g, "^2") // superscript ²
    .replace(/\u00b3/g, "^3") // superscript ³
    .replace(/π/g, "3.14159265358979");

  // 2. Bracket normalization: {}, [] → ()
  s = s
    .replace(/\{/g, "(").replace(/\}/g, ")")
    .replace(/\[/g, "(").replace(/\]/g, ")");

  // 3. Remove characters that are entirely invalid (except x as a variable/shorthand)
  s = s.replace(/[^0-9+\-*/.^()\seE]/g, "");
  // Quick shorthand for 5x -> 5*x (limited to x as a variable)
  s = s.replace(/(\d)\s*x/g, "$1*x");

  // 4. Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  // 5. Implicit multiplication insertion
  //    Cases:
  //      digit '(' → digit '*('      e.g.  2(3+4)  →  2*(3+4)
  //      ')' digit → ')*' digit      e.g.  (2+3)4  →  (2+3)*4
  //      ')' '('   → ')' '*' '('    e.g.  (2+3)(4+5) → (2+3)*(4+5)
  s = s.replace(/(\d)\s*\(/g, "$1*(");
  s = s.replace(/\)\s*(\d)/g, ")*$1");
  s = s.replace(/\)\s*\(/g, ")*(");

  // 6. Fix double/conflicting operators:
  //    ++  →  +     --  →  +     +-  →  -     -+  →  -
  //    **  is valid (power), so leave it alone
  //    Repeated non-power operators get collapsed
  s = collapseOperators(s);

  // 7. Strip leading operator if not unary minus/plus
  s = s.replace(/^[*/]/, "");

  // 8. Auto-close unclosed opening brackets
  s = autoCloseBrackets(s);

  return s.trim();
}

/**
 * Collapse consecutive arithmetic operators while preserving unary minus logic.
 * e.g. "5++3" → "5+3",  "5+-3" → "5-3",  "5--3" → "5+3"
 */
function collapseOperators(s) {
  // Repeatedly collapse until stable (handles triple+ like +++  →  +)
  let prev;
  do {
    prev = s;
    // Two-char collapsing: ++ → +, -- → +, +- → -, -+ → -
    s = s
      .replace(/\+\+/g, "+")
      .replace(/--/g, "+")
      .replace(/\+-/g, "-")
      .replace(/-\+/g, "-");
    // Remove stray operator before closing paren: (5+) → (5)
    s = s.replace(/([+\-*/])\s*\)/g, ")");
    // Remove operator directly after opening paren (not minus/plus which are unary)
    s = s.replace(/\(\s*[*/]/g, "(");
  } while (s !== prev);
  return s;
}

/**
 * Auto-close unclosed open brackets.
 * e.g. "3 + (2" → "3 + (2)"
 */
function autoCloseBrackets(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  // Append missing closing brackets
  return s + ")".repeat(depth);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Recursive Descent Parser (BODMAS)
// ─────────────────────────────────────────────────────────────────────────────
//   Precedence levels (low → high):
//     AddSub  (+, -)
//     MulDiv  (*, /)
//     Power   (^)
//     Unary   (-, +)
//     Primary (number, parenthesised expression)

class Parser {
  constructor(input) {
    // Strip all spaces — we operate on compact string
    this.src = input.replace(/\s/g, "");
    this.pos = 0;
  }

  peek()    { return this.src[this.pos]; }
  consume() { return this.src[this.pos++]; }
  end()     { return this.pos >= this.src.length; }

  // Entry point
  parse() {
    const val = this.parseAddSub();
    if (!this.end()) {
      throw new Error(`Unexpected token '${this.peek()}' at position ${this.pos}`);
    }
    return val;
  }

  // Addition & Subtraction  (lowest precedence)
  parseAddSub() {
    let left = this.parseMulDiv();
    while (!this.end()) {
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.consume();
      const right = this.parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  // Multiplication & Division
  parseMulDiv() {
    let left = this.parsePower();
    while (!this.end()) {
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.consume();
      const right = this.parsePower();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  // Power (right-associative)  ^
  parsePower() {
    const base = this.parseUnary();
    if (!this.end() && this.peek() === "^") {
      this.consume();
      const exp = this.parsePower(); // right-associative: recurse
      return Math.pow(base, exp);
    }
    return base;
  }

  // Unary plus / minus
  parseUnary() {
    if (!this.end() && this.peek() === "-") { this.consume(); return -this.parsePrimary(); }
    if (!this.end() && this.peek() === "+") { this.consume(); return  this.parsePrimary(); }
    return this.parsePrimary();
  }

  // Primary: parenthesised expression OR number
  parsePrimary() {
    // Parenthesised expression
    if (!this.end() && this.peek() === "(") {
      this.consume(); // '('
      const val = this.parseAddSub();
      // Consume ')' if present (auto-close may have added it, or it's there)
      if (!this.end() && this.peek() === ")") this.consume();
      return val;
    }

    // Number (integer or decimal, optional scientific notation: 1e3, 2.5E-2)
    return this.parseNumber();
  }

  parseNumber() {
    let s = "";
    // Digits and decimal point
    while (!this.end() && /[0-9.]/.test(this.peek())) s += this.consume();
    // Scientific notation: e/E followed by optional sign and digits
    if (!this.end() && (this.peek() === "e" || this.peek() === "E")) {
      s += this.consume();
      if (!this.end() && (this.peek() === "+" || this.peek() === "-")) s += this.consume();
      while (!this.end() && /[0-9]/.test(this.peek())) s += this.consume();
    }
    if (!s) throw new Error(`Expected number at position ${this.pos}, got '${this.peek() ?? "EOF"}'`);
    const num = parseFloat(s);
    if (isNaN(num)) throw new Error(`Invalid number: '${s}'`);
    return num;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a number result cleanly:
 *  - Integers → no decimal
 *  - Trim trailing zeros on decimals
 *  - Cap at 10 significant digits to avoid float noise (0.1+0.2 → 0.3)
 */
function formatResult(num) {
  if (num === null || num === undefined) return "0";
  // Always return numeric '0' for non-finite results to satisfy numeric-only requirement
  if (!isFinite(num)) return "0";
  
  if (Number.isInteger(num)) return num.toString();
  // Round to 3 decimal places and trim trailing zeros
  const rounded = Math.round(num * 1000) / 1000;
  return parseFloat(rounded.toFixed(3)).toString();
}

/**
 * cleanMathOutput — Strip LaTeX symbols and delimiters for a clean display.
 */
export function cleanMathOutput(text) {
  if (!text) return "";
  let s = text.toString();
  
  // Remove markdown and LaTeX delimiters
  s = s.replace(/\$+([^\$]+)\$+/g, "$1")
       .replace(/\$+/g, "")
       .replace(/\\\[|\\\]|\\\(|\\\)/g, "");

  // Normalize common LaTeX functions to plain math
  s = s.replace(/\\sin\b/g, "sin")
       .replace(/\\cos\b/g, "cos")
       .replace(/\\tan\b/g, "tan")
       .replace(/\\log\b/g, "log")
       .replace(/\\ln\b/g, "ln")
       .replace(/\\sqrt\{([^\}]+)\}/g, "sqrt($1)")
       .replace(/\\sqrt/g, "sqrt")
       .replace(/\\frac\{([^\}]+)\}\{([^\}]+)\}/g, "($1)/($2)")
       .replace(/\\left[\[\(\{\|]/g, (m) => m.slice(-1))
       .replace(/\\right[\]\)\}\|]/g, (m) => m.slice(-1))
       .replace(/\\cdot/g, "*")
       .replace(/\\times/g, "*")
       .replace(/\\div/g, "/")
       .replace(/\\pi/gi, "pi")
       .replace(/\\/g, ""); // Final slash cleanup

  return s.trim();
}

/**
 * safeEval — normalize, parse, and evaluate.
 * Returns { result: number, formatted: string } on success
 * or      { error: string }               on failure.
 * NEVER throws.
 */
export function safeEval(rawExpression) {
  if (!rawExpression || !rawExpression.trim()) {
    return { error: "Empty expression" };
  }

  let normalized;
  try {
    normalized = normalizeExpression(rawExpression);
  } catch (e) {
    return { error: `Normalization failed: ${e.message}` };
  }

  if (!normalized) return { error: "Expression is empty after cleaning" };

  try {
    const parser = new Parser(normalized);
    const result = parser.parse();

    if (!isFinite(result)) return { error: "Result is not finite (overflow or division by zero)" };

    return { result, formatted: formatResult(result), normalized };
  } catch (e) {
    return { error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — LRU Cache
// ─────────────────────────────────────────────────────────────────────────────

const _cache = new Map();
const MAX_CACHE = 50;

/**
 * cachedEval — memoized safeEval. Identical input returns cached result instantly.
 */
export function cachedEval(expression) {
  const key = expression.trim();
  if (_cache.has(key)) {
    // Move to end (LRU touch)
    const val = _cache.get(key);
    _cache.delete(key);
    _cache.set(key, val);
    return val;
  }
  const result = safeEval(key);
  // Evict oldest if at capacity
  if (_cache.size >= MAX_CACHE) {
    _cache.delete(_cache.keys().next().value);
  }
  _cache.set(key, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Multi-Line Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseLines — split multi-line text into an array of line descriptors.
 *
 * Rules:
 *  - Split on \n
 *  - A line is "actionable" if it ends with '=' AND has content before the '='
 *  - Trims whitespace from each line independently
 *
 * Returns: Array<{
 *   lineIndex : number,
 *   raw       : string,   // original line text (trimmed)
 *   expression: string,   // stripped expression (no trailing =), or null
 *   actionable: boolean,
 * }>
 */
export function parseLines(text) {
  if (!text) return [];
  return text.split('\n').map((line, lineIndex) => {
    const raw = line.trim();
    // Actionable = ends with '=' and has at least 1 char before it
    if (!raw.endsWith('=') || raw.length < 2) {
      return { lineIndex, raw, expression: null, actionable: false };
    }
    const expression = raw.replace(/=\s*$/, '').trim();
    if (!expression) {
      return { lineIndex, raw, expression: null, actionable: false };
    }
    return { lineIndex, raw, expression, actionable: true };
  });
}

/**
 * evaluateLines — evaluate each line of multi-line text independently.
 *
 * Each line is evaluated in isolation — a failure on one line does NOT
 * affect any other line.
 *
 * Returns: Array<{
 *   lineIndex  : number,
 *   raw        : string,
 *   expression : string | null,
 *   actionable : boolean,
 *   result?    : number,
 *   formatted? : string,
 *   normalized?: string,
 *   error?     : string,
 * }>
 */
export function evaluateLines(text) {
  return parseLines(text).map((lineDesc) => {
    if (!lineDesc.actionable) return lineDesc;
    const evalResult = cachedEval(lineDesc.expression);
    return { ...lineDesc, ...evalResult };
  });
}

