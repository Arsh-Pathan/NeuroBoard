import React, { useState } from "react";
import { cleanMathOutput } from "./mathUtils";

export default function SuggestionPanel({ suggestions, onSearch, loading }) {
  const [topic, setTopic] = useState("");

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (topic.trim() && !loading) {
      onSearch(topic.trim());
    }
  };

  return (
    <div className="suggestion-panel">
      <div className="section">
        <div className="section-title">Topic Suggestions</div>
        <form onSubmit={handleSearchSubmit} className="topic-form">
          <input
            type="text"
            value={topic}
            placeholder="Search topic (e.g. DNA)"
            className="topic-input"
            onChange={(e) => setTopic(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="btn btn-primary suggest-btn" disabled={loading || !topic.trim()}>
            {loading ? "Discovering..." : "Show Suggestions"}
          </button>
        </form>
      </div>

      <div className="results-list">
        {!loading && suggestions.length === 0 && (
          <div className="empty-state">
            <span className="icon">🔭</span>
            <p>Enter a topic to get 3 diagram suggestions</p>
          </div>
        )}

        {loading && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Gathering knowledge...</p>
          </div>
        )}

        {suggestions.map((suggestion, idx) => (
          <div key={idx} className="suggestion-card">
            <div className="card-number">{idx + 1}</div>
            <div className="card-content">
              <div className="card-title">{cleanMathOutput(suggestion.title)}</div>
              <div className="card-desc text-xs text-slate-500 mt-1">{cleanMathOutput(suggestion.description)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
