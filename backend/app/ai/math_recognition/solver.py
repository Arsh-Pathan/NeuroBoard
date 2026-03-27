import sympy
import re


class MathSolver:
    def solve(self, equation_text: str) -> str:
        """
        Parses OCR text and returns a solved string using SymPy.
        Handles:
        - Equations with '=' (e.g., '2+x=5' -> 'x = 3')
        - Arithmetic expressions (e.g., '2+3*4' -> '14')
        - Algebraic simplification (e.g., 'x^2 + 2x + 1' -> factors)
        """
        text = equation_text.strip()
        text = text.replace("×", "*").replace("÷", "/").replace("^", "**")

        # Normalize whitespace
        text = re.sub(r"\s+", " ", text)

        if not text:
            return ""

        try:
            # Case 1: Equation with '=' sign (e.g., "2+x=5")
            if "=" in text:
                return self._solve_equation(text)

            # Case 2: Expression with variables — simplify/solve
            if self._has_variables(text):
                return self._solve_expression_with_vars(text)

            # Case 3: Pure arithmetic
            return self._evaluate_arithmetic(text)

        except Exception as e:
            return f"Error: {str(e)}"

    def _solve_equation(self, text: str) -> str:
        """Solve an equation like '2+x=5' or 'x**2 - 4 = 0'."""
        parts = text.split("=", 1)
        if len(parts) != 2:
            return "Error: invalid equation format"

        lhs_str, rhs_str = parts[0].strip(), parts[1].strip()

        # Insert implicit multiplication: '2x' -> '2*x'
        lhs_str = self._add_implicit_mult(lhs_str)
        rhs_str = self._add_implicit_mult(rhs_str)

        try:
            lhs = sympy.sympify(lhs_str)
            rhs = sympy.sympify(rhs_str)
        except (sympy.SympifyError, SyntaxError):
            return "Error: could not parse equation"

        # Move everything to LHS: lhs - rhs = 0
        expr = lhs - rhs
        symbols = list(expr.free_symbols)

        if not symbols:
            # No variables — check if equation is true
            val = float(expr.evalf())
            return "True" if abs(val) < 1e-10 else "False"

        # Solve for the first variable found
        solutions = sympy.solve(expr, symbols[0])
        if not solutions:
            return "No solution"

        var_name = str(symbols[0])
        formatted = ", ".join(self._format_value(s) for s in solutions)
        return f"{var_name} = {formatted}"

    def _solve_expression_with_vars(self, text: str) -> str:
        """Simplify or factor an expression with variables."""
        text = self._add_implicit_mult(text)
        try:
            expr = sympy.sympify(text)
            simplified = sympy.simplify(expr)
            return str(simplified)
        except (sympy.SympifyError, SyntaxError):
            return "Error: could not parse expression"

    def _evaluate_arithmetic(self, text: str) -> str:
        """Evaluate a pure arithmetic expression like '2+3*4'."""
        try:
            expr = sympy.sympify(text)
            result = float(expr.evalf())
            if result == int(result):
                return str(int(result))
            return str(round(result, 6))
        except (sympy.SympifyError, SyntaxError):
            return "Error: could not evaluate"

    def _has_variables(self, text: str) -> bool:
        """Check if text contains algebraic variables."""
        return bool(re.search(r"[a-zA-Z]", text))

    def _add_implicit_mult(self, text: str) -> str:
        """Convert '2x' to '2*x', '3(x+1)' to '3*(x+1)'."""
        # digit followed by letter
        text = re.sub(r"(\d)([a-zA-Z])", r"\1*\2", text)
        # digit followed by open paren
        text = re.sub(r"(\d)\(", r"\1*(", text)
        # letter followed by open paren
        text = re.sub(r"([a-zA-Z])\(", r"\1*(", text)
        return text

    def _format_value(self, val) -> str:
        """Format a SymPy value cleanly."""
        if val.is_integer:
            return str(int(val))
        if val.is_real:
            f = float(val.evalf())
            if f == int(f):
                return str(int(f))
            return str(round(f, 4))
        return str(val)
