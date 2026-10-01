import { useState } from "react";
import { Dropzone } from "./Dropzone.jsx";
import { Seal } from "./Seal.jsx";
import { HashChip } from "./HashChip.jsx";
import { verifyHash } from "../lib/api.js";
import { sha256Hex, normalizeHash, truncateHash, truncateAddress, formatTimestamp } from "../lib/hash.js";
import "./Panel.css";

const METADATA_NOTES = {
  unavailable: "The on-chain proof above is complete. Extra details (transaction link) are temporarily unavailable.",
  not_indexed: "The on-chain proof above is complete. This record isn't in our index (it may predate it or still be syncing).",
};

export function VerifyPanel() {
  const [mode, setMode] = useState("file"); // "file" | "hash"
  const [file, setFile] = useState(null);
  const [hashInput, setHashInput] = useState("");
  const [status, setStatus] = useState("idle"); // idle | hashing | checking | verified | notfound | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runVerify = async () => {
    setError(null);
    setResult(null);
    try {
      let hash;
      if (mode === "file") {
        // Hash locally — only the 32-byte fingerprint is sent, never the file.
        setStatus("hashing");
        hash = await sha256Hex(file);
      } else {
        hash = normalizeHash(hashInput);
      }
      setStatus("checking");
      const data = await verifyHash(hash);
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

  const busy = status === "checking" || status === "hashing";
  const sealState = busy ? "pressing" : status === "verified" ? "verified" : status === "notfound" ? "notfound" : "idle";
  const canSubmit = mode === "file" ? Boolean(file) : Boolean(normalizeHash(hashInput));

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
            Check a file
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
            disabled={busy}
            hint="Hashed in your browser — the file itself is never uploaded"
          />
        ) : (
          <input
            className="panel__hash-input mono"
            placeholder="0x…"
            aria-label="Document hash"
            value={hashInput}
            onChange={(e) => {
              setHashInput(e.target.value);
              setResult(null);
              setStatus("idle");
            }}
            disabled={busy}
          />
        )}

        {error && <p className="panel__error">{error}</p>}

        <button className="panel__submit" onClick={runVerify} disabled={!canSubmit || busy}>
          {status === "hashing" ? "Hashing locally…" : status === "checking" ? "Checking the ledger…" : "Verify"}
        </button>

        {(status === "verified" || status === "notfound") && (
          <div className="panel__result">
            <p className={`panel__verdict panel__verdict--${status}`}>
              {status === "verified" ? "Record found — this document is notarized." : "No record found for this document."}
            </p>
            <div className="panel__result-row">
              <span className="panel__result-label">Document hash</span>
              <HashChip value={result.documentHash} truncated={truncateHash(result.documentHash, 8)} />
            </div>
            {status === "verified" && (
              <>
                <div className="panel__result-row">
                  <span className="panel__result-label">Notarized at</span>
                  <span>{formatTimestamp(result.onChain.timestamp)}</span>
                </div>
                {result.onChain.label && (
                  <div className="panel__result-row">
                    <span className="panel__result-label">Public label</span>
                    <span>{result.onChain.label}</span>
                  </div>
                )}
                <div className="panel__result-row">
                  <span className="panel__result-label">Submitted by</span>
                  <span className="mono" title="The service's relayer wallet, which pays gas for every notarization">
                    {truncateAddress(result.onChain.submitter)} (relayer)
                  </span>
                </div>
                {result.metadata?.txHash && (
                  <div className="panel__result-row">
                    <span className="panel__result-label">Transaction</span>
                    <a href={`https://sepolia.etherscan.io/tx/${result.metadata.txHash}`} target="_blank" rel="noreferrer">
                      View on Etherscan ↗
                    </a>
                  </div>
                )}
                {METADATA_NOTES[result.metadataStatus] && (
                  <p className="panel__muted">{METADATA_NOTES[result.metadataStatus]}</p>
                )}
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
