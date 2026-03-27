import React, { useEffect } from "react";
import "./styles.css";

// SVGs for clean status indicators
const SpinnerIcon = () => (
  <svg className="ai-spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CrossIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

export default function AiStatusIndicator({ status, message, onClose }) {
  if (status === "idle" || !status) return null;

  // Auto-hide success or error after a delay
  useEffect(() => {
    if (status === "success" || status === "error") {
      const timer = setTimeout(() => {
        if (onClose) onClose();
      }, status === "success" ? 2000 : 3500);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  let icon, colorClass;
  if (status === "loading") {
    icon = <SpinnerIcon />;
    colorClass = "ai-status-loading";
  } else if (status === "success") {
    icon = <CheckIcon />;
    colorClass = "ai-status-success";
  } else if (status === "error") {
    icon = <CrossIcon />;
    colorClass = "ai-status-error";
  }

  return (
    <div className={`global-ai-status glass-panel ${colorClass}`}>
      <span className="ai-icon">{icon}</span>
      <span className="ai-message">{message}</span>
    </div>
  );
}
