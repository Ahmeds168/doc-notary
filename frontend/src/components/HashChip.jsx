import { useState } from "react";
import "./HashChip.css";

export function HashChip({ value, truncated }) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — silently ignore, chip still shows the value
    }
  };

  return (
    <button type="button" className="hash-chip mono" onClick={handleCopy} title={value}>
      <span>{truncated ?? value}</span>
      <span className="hash-chip__copy">{copied ? "copied" : "copy"}</span>
    </button>
  );
}
