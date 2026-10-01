import { useEffect, useRef, useState } from "react";
import { Dropzone } from "./Dropzone.jsx";
import { Seal } from "./Seal.jsx";
import { HashChip } from "./HashChip.jsx";
import { notarizeFile, getOperation } from "../lib/api.js";
import { sha256Hex, truncateHash, formatTimestamp } from "../lib/hash.js";
import "./Panel.css";

const EXPLORER_TX_BASE = "https://sepolia.etherscan.io/tx/";
const MAX_LABEL_LENGTH = 64;
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 36; // ~3 minutes

function formatMb(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function NotarizePanel({ session, account, onNotarized }) {
  const [file, setFile] = useState(null);
  const [previewHash, setPreviewHash] = useState(null);
  // idle | hashing | submitting | pending | done | conflict | error
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [useLabel, setUseLabel] = useState(false);
  const [label, setLabel] = useState("");
  const pollRef = useRef(null);

  const token = session?.access_token;
  const ent = account?.entitlements;
  const usage = account?.usage;
  const quotaReached = usage && usage.used >= usage.limit;

  useEffect(() => () => clearTimeout(pollRef.current), []);

  const handleFile = async (selected) => {
    setFile(selected);
    setResult(null);
    setError(null);
    if (ent && selected.size > ent.maxFileSizeBytes) {
      setPreviewHash(null);
      setError(`This file is larger than your plan's ${formatMb(ent.maxFileSizeBytes)} limit.`);
      setStatus("error");
      return;
    }
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

  const settle = (data) => {
    setResult(data);
    if (data.outcome === "confirmed") {
      setStatus("done");
      onNotarized?.(data);
    } else if (data.outcome === "failed") {
      setError("The notarization transaction failed. Your monthly quota was not used — you can try again.");
      setStatus("error");
      onNotarized?.(data);
    } else {
      setStatus("pending");
    }
  };

  const poll = (operationId, attempt = 0) => {
    if (attempt >= MAX_POLLS) return;
    pollRef.current = setTimeout(async () => {
      try {
        const data = await getOperation(operationId, token);
        settle(data);
        if (data.outcome === "pending" || data.outcome === "uncertain") poll(operationId, attempt + 1);
      } catch {
        poll(operationId, attempt + 1);
      }
    }, POLL_INTERVAL_MS);
  };

  const handleNotarize = async () => {
    if (!file) return;
    setStatus("submitting");
    setError(null);
    try {
      const data = await notarizeFile(file, { token, label: useLabel ? label.trim() : "" });
      settle(data);
      if (data.outcome === "pending" || data.outcome === "uncertain") poll(data.operationId);
    } catch (err) {
      if (err.status === 409) {
        setError("This exact file is already notarized — its proof already exists. Use Verify to check it.");
        setResult({ documentHash: err.data?.documentHash });
        setStatus("conflict");
        return;
      }
      setError(
        err.status === 402
          ? `${err.message} Upgrade to Standard for 25 a month.`
          : err.message || "Notarization failed. Check the backend is reachable and try again."
      );
      setStatus("error");
    }
  };

  const reset = () => {
    clearTimeout(pollRef.current);
    setFile(null);
    setPreviewHash(null);
    setResult(null);
    setError(null);
    setStatus("idle");
    setUseLabel(false);
    setLabel("");
  };

  const busy = status === "submitting" || status === "hashing" || status === "pending";
  const sealState = status === "submitting" || status === "pending" ? "pressing" : status === "done" ? "verified" : "idle";
  const labelInvalid = useLabel && (label.trim().length === 0 || label.trim().length > MAX_LABEL_LENGTH);

  return (
    <div className="panel">
      <div className="panel__form">
        {usage && ent && (
          <p className="panel__usage mono">
            {usage.used} of {usage.limit} notarizations used this month · {ent.plan} plan · max {formatMb(ent.maxFileSizeBytes)}
          </p>
        )}

        <Dropzone
          onFileSelected={handleFile}
          selectedFile={file}
          disabled={busy}
          hint="Any file type — contracts, invoices, source archives, media"
        />

        <div className="panel__notice">
          <strong>What happens when you notarize:</strong> your file is <em>uploaded</em> and stored
          privately (only you can download it). Only its SHA-256 fingerprint is published on the
          public Sepolia blockchain — not the file, and not its name.
        </div>

        <label className="panel__checkbox">
          <input type="checkbox" checked={useLabel} disabled={busy} onChange={(e) => setUseLabel(e.target.checked)} />
          <span>Add a public on-chain label (optional)</span>
        </label>
        {useLabel && (
          <div className="panel__label-field">
            <input
              className="panel__hash-input"
              placeholder="e.g. Lease agreement v2"
              maxLength={MAX_LABEL_LENGTH}
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="panel__warning">
              Anything you type here is written to a public blockchain and can never be edited or
              deleted. Don't include names, personal details or confidential information.
            </p>
          </div>
        )}

        {previewHash && status !== "done" && (
          <div className="panel__hash-preview">
            <span className="panel__hash-label">SHA-256</span>
            <HashChip value={previewHash} truncated={truncateHash(previewHash, 8)} />
          </div>
        )}

        {error && <p className="panel__error">{error}</p>}

        {status !== "done" && status !== "pending" && (
          <button
            className="panel__submit"
            onClick={handleNotarize}
            disabled={!file || !previewHash || busy || labelInvalid || quotaReached}
          >
            {status === "submitting"
              ? "Stamping onto Sepolia…"
              : quotaReached
                ? "Monthly limit reached"
                : "Upload & notarize this document"}
          </button>
        )}

        {status === "pending" && (
          <div className="panel__result">
            <p className="panel__verdict">
              {result?.outcome === "uncertain"
                ? "Submitted — waiting for the network to confirm. This can take a few minutes."
                : "Transaction sent — waiting for a block…"}
            </p>
            {result?.txHash && (
              <a href={`${EXPLORER_TX_BASE}${result.txHash}`} target="_blank" rel="noreferrer">
                Track on Etherscan ↗
              </a>
            )}
            <p className="panel__muted">You can leave this page; retrying the same file will never create a second transaction.</p>
          </div>
        )}

        {(status === "done" || status === "conflict") && (
          <div className="panel__result">
            <div className="panel__result-row">
              <span className="panel__result-label">Document hash</span>
              <HashChip value={result?.documentHash} truncated={truncateHash(result?.documentHash, 8)} />
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
            {result?.metadataStatus === "pending" && (
              <p className="panel__muted">Sealed on-chain. Your history entry will appear shortly.</p>
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
