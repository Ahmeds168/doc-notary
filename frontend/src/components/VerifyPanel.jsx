import { useState } from "react";
import { Dropzone } from "./Dropzone.jsx";
import { Seal } from "./Seal.jsx";
import { HashChip } from "./HashChip.jsx";
import { verifyFile, verifyHash } from "../lib/api.js";
import { truncateHash, truncateAddress, formatTimestamp } from "../lib/hash.js";
import "./Panel.css";

export function VerifyPanel() {
  const [mode, setMode] = useState("file"); // "file" | "hash"
  const [file, setFile] = useState(null);
  const [hashInput, setHashInput] = useState("");
  const [status, setStatus] = useState("idle"); // idle | checking | verified | notfound | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runVerify = async () => {
    setStatus("checking");
    setError(null);
    setResult(null);
    try {
      const data = mode === "file" ? await verifyFile(file) : await verifyHash(hashInput.trim());
      setResult(data);
      setStatus(data.verified ? "verified" : "notfound");
    } catch (err) {
      setError(err.message || "Verification failed. Check the backend is reachable and try again.");
      setStatus("error");
    }
  };

  const reset = () => {
    setFile(null);
    setHashInput("");
    setResult(null);
    setError(null);
    setStatus("idle");
  };

  const sealState = status === "checking" ? "pressing" : status === "verified" ? "verified" : status === "notfound" ? "notfound" : "idle";
  const canSubmit = mode === "file" ? Boolean(file) : /^0x[0-9a-fA-F]{64}$/.test(hashInput.trim());

  return (
    <div className="panel">
      <div className="panel__form">
        <div className="panel__mode-toggle">
          <button
            className={mode === "file" ? "is-active" : ""}
            onClick={() => {
              setMode("file");
              reset();
            }}
          >
            Upload file
          </button>
          <button
            className={mode === "hash" ? "is-active" : ""}
            onClick={() => {
              setMode("hash");
              reset();
            }}
          >
            Paste hash
          </button>
        </div>

        {mode === "file" ? (
          <Dropzone
            onFileSelected={(f) => {
              setFile(f);
              setResult(null);
              setStatus("idle");
            }}
            selectedFile={file}
            disabled={status === "checking"}
            hint="We'll re-hash it in your browser and check the registry"
          />
        ) : (
          <input
            className="panel__hash-input mono"
            placeholder="0x…"
            value={hashInput}
            onChange={(e) => {
              setHashInput(e.target.value);
              setResult(null);
              setStatus("idle");
            }}
            disabled={status === "checking"}
          />
        )}

        {error && <p className="panel__error">{error}</p>}

        <button className="panel__submit" onClick={runVerify} disabled={!canSubmit || status === "checking"}>
          {status === "checking" ? "Checking the ledger…" : "Verify"}
        </button>

        {(status === "verified" || status === "notfound") && (
          <div className="panel__result">
            <p className={`panel__verdict panel__verdict--${status}`}>
              {status === "verified" ? "Record found — this document is notarized." : "No record found for this document."}
            </p>
            {status === "verified" && (
              <>
                <div className="panel__result-row">
                  <span className="panel__result-label">Document hash</span>
                  <HashChip
                    value={result.documentHash}
                    truncated={truncateHash(result.documentHash, 8)}
                  />
                </div>
                <div className="panel__result-row">
                  <span className="panel__result-label">Notarized at</span>
                  <span>{formatTimestamp(result.onChain.timestamp)}</span>
                </div>
                {result.metadata?.label && (
                  <div className="panel__result-row">
                    <span className="panel__result-label">Label</span>
                    <span>{result.metadata.label}</span>
                  </div>
                )}
                <div className="panel__result-row">
                  <span className="panel__result-label">Submitted by</span>
                  <span className="mono">{truncateAddress(result.onChain.submitter)}</span>
                </div>
              </>
            )}
            <button className="panel__reset" onClick={reset}>
              Check another
            </button>
          </div>
        )}
      </div>

      <div className="panel__seal">
        <Seal state={sealState} size={160} />
      </div>
    </div>
  );
}
