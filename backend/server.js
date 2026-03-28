require("dotenv").config({ path: "./.env" });

const express = require("express");
const cors = require("cors");
const { solveMath, getTopicSuggestions, solveImageMath } = require("./openrouter");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "NeuroBoard API" });
});

// Math solver (Text based)
app.post("/api/solve-math", async (req, res) => {
  try {
    const { expression } = req.body;
    if (!expression || !expression.trim()) {
      return res.status(400).json({ error: "Expression is required" });
    }
    const answer = await solveMath(expression);
    res.json(answer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sketch solver (Vision based OCR + Math)
app.post("/api/solve-sketch", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "Image data is required" });
    const answer = await solveImageMath(image);
    res.json(answer);
  } catch (err) {
    console.error("Sketch solver error:", err.message);
    console.error(err.stack);
    res.status(500).json({ error: `API Error: ${err.message}` });
  }
});

// Topic suggestions
app.post("/api/topic-suggestions", async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic || !topic.trim()) {
      return res.status(400).json({ error: "Topic is required" });
    }
    const suggestions = await getTopicSuggestions(topic);
    res.json({ topic, suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nNeuroBoard backend running on http://localhost:${PORT}\n`);
});
