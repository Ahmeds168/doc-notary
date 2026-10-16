import { useEffect, useRef, useState } from "react";
import { Dropzone } from "./Dropzone.jsx";
import { Seal } from "./Seal.jsx";
import { HashChip } from "./HashChip.jsx";
import { verifyHash } from "../lib/api.js";
import { sha256Hex, normalizeHash, truncateHash, truncateAddress, formatTimestamp } from "../lib/hash.js";
import { useNetwork, explorerTxUrl, explorerAddressUrl } from "../lib/useNetwork.js";
import "./Panel.css";

const METADATA_NOTES = {
  unavailable: "The on-chain proof above is complete. Extra details (transaction link) are temporarily unavailable.",
  not_indexed: "The on-chain proof above is complete. This record isn't in our index (it may predate it or still be syncing).",
};

function isoUtc(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * `initialHash` comes from a public /verify/:hash link: the panel opens in "Paste hash" mode,
 * pre-filled, and runs the check once. `invalidLink` is set when that link held no valid hash.
 */
export function VerifyPanel({ initialHash = null, invalidLink = null }) {
  const [mode, setMode] = useState(initialHash || invalidLink ? "hash" : "file"); // "file" | "hash"
  const [file, setFile] = useState(null);
  const [hashInput, setHashInput] = useState(initialHash ?? invalidLink ?? "");
  const [status, setStatus] = useState("idle"); // idle | hashing | checking | verified | notfound | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(invalidLink ? "That link doesn't contain a valid document hash." : null);
  const network = useNetwork();
  const autoRan = useRef(false);

  const runVerify = async (overrideHash) => {
    setError(null);
    setResult(null);
    try {
      let hash;
      if (typeof overrideHash === "string") {
        hash = overrideHash;
      } else if (mode === "file") {
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

  // Public verify link: run once on mount (the ref keeps StrictMode from double-checking).
  useEffect(() => {
    if (!initialHash || autoRan.current) return;
    autoRan.current = true;
    runVerify(initialHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHash]);

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

        <button className="panel__submit" onClick={() => runVerify()} disabled={!canSubmit || busy}>
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
                  <span title={isoUtc(result.onChain.timestamp)}>{formatTimestamp(result.onChain.timestamp)}</span>
                </div>
                <div className="panel__result-row">
                  <span className="panel__result-label">Recorded (UTC)</span>
                  <span className="mono">{isoUtc(result.onChain.timestamp)}</span>
                </div>
                {network?.name && (
                  <div className="panel__result-row">
                    <span className="panel__result-label">Network</span>
                    <span>{network.name}</span>
                  </div>
                )}
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
                {explorerTxUrl(network, result.metadata?.txHash) ? (
                  <div className="panel__result-row">
                    <span className="panel__result-label">Transaction</span>
                    <a href={explorerTxUrl(network, result.metadata.txHash)} target="_blank" rel="noreferrer">
                      View on block explorer ↗
                    </a>
                  </div>
                ) : (
                  explorerAddressUrl(network, network?.contractAddress) && (
                    <div className="panel__result-row">
                      <span className="panel__result-label">Contract</span>
                      <a href={explorerAddressUrl(network, network.contractAddress)} target="_blank" rel="noreferrer">
                        View contract on block explorer ↗
                      </a>
                    </div>
                  )
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
