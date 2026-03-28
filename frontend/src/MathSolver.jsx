import React, { useState, useRef, useCallback, useMemo } from "react";
import { evaluateLines, normalizeExpression } from "./mathUtils";

/**
 * MathSolver — Bottom-bar smart math input panel.
 *
 *  ✅ Multi-line input: each line evaluated independently
 *  ✅ Real-time local preview with 150ms debounce
 *  ✅ Shows auto-corrected expression in preview
 *  ✅ BODMAS + implicit multiply + bracket normalization
 *  ✅ Cache — no recomputation of identical lines
 *  ✅ Graceful — never crashes on invalid input
 *  ✅ API fallback only for sketch-solve
 */
export default function MathSolver({ onSolve, onSolveSketch, apiUrl, setError }) {
  const [mathInput, setMathInput] = useState("");
  // preview: Array<{ lineIndex, expression, formatted, displayExpr }> | null
  const [previews, setPreviews]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(false); // textarea expand toggle

  const debounceRef = useRef(null);

  // ── Real-time preview ───────────────────────────────────────────────────────
  const handleInputChange = useCallback((e) => {
    const raw = e.target.value;
    setMathInput(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => computePreviews(raw), 150);
  }, []);

  function computePreviews(raw) {
    if (!raw.trim()) { setPreviews([]); return; }

    const results = evaluateLines(raw);
    const valid = results
      .filter(({ actionable, formatted }) => actionable && formatted !== undefined)
      .map(({ lineIndex, expression, formatted, normalized }) => {
        const displayExpr = (normalized && normalized !== expression)
          ? normalized
          : normalizeExpression(expression);
        return { lineIndex, expression, formatted, displayExpr };
      });
    setPreviews(valid);
  }

  // ── Submit all valid lines to canvas ───────────────────────────────────────
  const handleMathSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const trimmed = mathInput.trim();
      if (!trimmed || loading) return;

      const results = evaluateLines(trimmed);
      const solved = results.filter(({ actionable, formatted }) => actionable && formatted !== undefined);

      if (solved.length > 0) {
        // Add each solved line as a separate canvas text label
        solved.forEach(({ expression, formatted, normalized }) => {
          const displayExpr = (normalized && normalized !== expression)
            ? normalized
            : normalizeExpression(expression);
          onSolve(`${displayExpr} = ${formatted}`);
        });
        setMathInput("");
        setPreviews([]);
        return;
      }

      // Nothing solved locally → try AI (for fallback complex expressions)
      setLoading(true);
      try {
        const lines = trimmed.split('\n').filter(l => l.trim());
        const expr = lines[0]?.replace(/=\s*$/, '').trim();
        if (!expr) throw new Error("Empty expression");
        const res = await fetch(`${apiUrl}/solve-math`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expression: expr }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Handle the new structured 'results' or legacy 'solution'
        if (data.results && data.results.length > 0) {
          data.results.forEach(({ expression: lineExpr, solution: lineSol }) => {
            const solText = Array.isArray(lineSol) ? lineSol[0] : lineSol;
            onSolve(`${lineExpr} = ${solText || "0"}`);
          });
        } else {
          const displayAnswer = data.solution
            ? (Array.isArray(data.solution) ? data.solution.join(", ") : data.solution)
            : (data.answer || "0");
          onSolve(`${data.expression || expr} = ${displayAnswer}`);
        }

        setMathInput("");
        setPreviews([]);
      } catch (err) {
        setError("Could not solve. Check your inputs or API key.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [mathInput, loading, onSolve, apiUrl, setError]
  );

  const handleSolveSketch = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onSolveSketch();
    } catch (err) {
      setError("Failed to solve drawing. Check backend/OpenRouter key.");
    } finally {
      setLoading(false);
    }
  }, [loading, onSolveSketch, setError]);

  const hasPreviews = previews.length > 0;
  const lineCount   = mathInput.split('\n').length;
  const isMultiLine = lineCount > 1 || expanded;

  return (
    <div className="math-solver">
      <div className="solver-label">Math Tools</div>
      <div className="math-form">
        <button
          onClick={handleSolveSketch}
          className="btn btn-secondary solve-btn"
          disabled={loading}
          style={{ width: "auto", minWidth: "200px", flexShrink: 0 }}
        >
          {loading ? "Scanning Drawing..." : "Solve from Drawing 🎨"}
        </button>

        <div style={{ width: "1px", height: "30px", background: "var(--border)", margin: "0 10px", flexShrink: 0 }} />

        <form
          onSubmit={handleMathSubmit}
          style={{ display: "flex", flex: 1, gap: "10px", alignItems: "flex-end" }}
        >
          <div style={{ flex: 1, position: "relative" }}>
            {/* Multi-line textarea OR single-line input */}
            {isMultiLine ? (
              <textarea
                value={mathInput}
                onChange={handleInputChange}
                placeholder={"4 - 3 =\n1 + 2 =\n2(3+4) ="}
                className="math-input math-textarea"
                disabled={loading}
                rows={Math.min(lineCount + 1, 4)}
                style={{ width: "100%", resize: "none", lineHeight: "1.5" }}
                autoComplete="off"
                spellCheck={false}
              />
            ) : (
              <input
                type="text"
                value={mathInput}
                onChange={handleInputChange}
                placeholder="e.g.  2(3+4) =   ×   4^2 + 1 ="
                className="math-input"
                disabled={loading}
                style={{ width: "100%" }}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  // Shift+Enter expands to multi-line
                  if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    setExpanded(true);
                    setMathInput((v) => v + "\n");
                  }
                }}
              />
            )}

            {/* Live preview area */}
            {hasPreviews && (
              <div className="math-preview-area">
                {previews.map(({ lineIndex, displayExpr, formatted }) => (
                  <span key={lineIndex} className="math-preview-badge">
                    {displayExpr} = <strong>{formatted}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignSelf: "flex-end" }}>
            <button
              type="submit"
              className={`btn ${hasPreviews ? "btn-primary" : "btn-secondary"}`}
              disabled={loading || !mathInput.trim()}
              title={hasPreviews ? "Add to canvas instantly" : "Send to AI solver"}
              style={{ whiteSpace: "nowrap" }}
            >
              {loading ? "..." : hasPreviews
                ? `Add ${previews.length > 1 ? `(${previews.length})` : ""} ✓`
                : "Solve & Add"}
            </button>
            {isMultiLine && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: "11px", padding: "6px 10px" }}
                onClick={() => { setExpanded(false); }}
                title="Collapse to single line"
              >
                ↑ Single line
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
