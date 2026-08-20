import { useState } from "react";
import { Dropzone } from "./Dropzone.jsx";
import { Seal } from "./Seal.jsx";
import { HashChip } from "./HashChip.jsx";
import { notarizeFile } from "../lib/api.js";
import { sha256Hex, truncateHash, formatTimestamp } from "../lib/hash.js";
import "./Panel.css";

const EXPLORER_TX_BASE = "https://sepolia.etherscan.io/tx/";

export function NotarizePanel({ onNotarized }) {
  const [file, setFile] = useState(null);
  const [previewHash, setPreviewHash] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | hashing | submitting | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = async (selected) => {
    setFile(selected);
    setResult(null);
    setError(null);
    setStatus("hashing");
    try {
      const hash = await sha256Hex(selected);
      setPreviewHash(hash);
      setStatus("idle");
    } catch {
      setError("Couldn't read that file in the browser. Try a different one.");
      setStatus("error");
    }
  };

  const handleNotarize = async () => {
    if (!file) return;
    setStatus("submitting");
    setError(null);
    try {
      const data = await notarizeFile(file);
      setResult(data);
      setStatus("done");
      onNotarized?.(data);
    } catch (err) {
      setError(
        err.status === 409
          ? "This exact file is already notarized — its proof already exists."
          : err.message || "Notarization failed. Check the backend is reachable and try again."
      );
      setStatus(err.status === 409 ? "conflict" : "error");
      if (err.status === 409) setResult({ record: err.data?.record, documentHash: err.data?.documentHash });
    }
  };

  const reset = () => {
    setFile(null);
    setPreviewHash(null);
    setResult(null);
    setError(null);
    setStatus("idle");
  };

  const sealState = status === "submitting" ? "pressing" : status === "done" ? "verified" : "idle";

  return (
    <div className="panel">
      <div className="panel__form">
        <Dropzone
          onFileSelected={handleFile}
          selectedFile={file}
          disabled={status === "submitting"}
          hint="Any file type — contracts, invoices, source archives, media"
        />

        {previewHash && status !== "done" && (
          <div className="panel__hash-preview">
            <span className="panel__hash-label">SHA-256</span>
            <HashChip value={previewHash} truncated={truncateHash(previewHash, 8)} />
          </div>
        )}

        {error && <p className="panel__error">{error}</p>}

        {status !== "done" && (
          <button
            className="panel__submit"
            onClick={handleNotarize}
            disabled={!file || status === "submitting" || status === "hashing"}
          >
            {status === "submitting" ? "Stamping onto Sepolia…" : "Notarize this document"}
          </button>
        )}

        {(status === "done" || status === "conflict") && (
          <div className="panel__result">
            <div className="panel__result-row">
              <span className="panel__result-label">Document hash</span>
              <HashChip
                value={result?.documentHash}
                truncated={truncateHash(result?.documentHash, 8)}
              />
            </div>
            {result?.txHash && (
              <div className="panel__result-row">
                <span className="panel__result-label">Transaction</span>
                <a href={`${EXPLORER_TX_BASE}${result.txHash}`} target="_blank" rel="noreferrer">
                  View on Etherscan ↗
                </a>
              </div>
            )}
            {result?.timestamp && (
              <div className="panel__result-row">
                <span className="panel__result-label">Notarized at</span>
                <span>{formatTimestamp(result.timestamp)}</span>
              </div>
            )}
            <button className="panel__reset" onClick={reset}>
              Notarize another file
            </button>
          </div>
        )}
      </div>

      <div className="panel__seal">
        <Seal state={sealState} size={160} />
        {status === "done" && <p className="panel__seal-caption">Sealed on Sepolia</p>}
      </div>
    </div>
  );
}
