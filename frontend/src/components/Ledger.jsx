import { useEffect, useState, useCallback } from "react";
import { listDocuments } from "../lib/api.js";
import { truncateHash, truncateAddress, formatTimestamp } from "../lib/hash.js";
import { HashChip } from "./HashChip.jsx";
import "./Ledger.css";

export function Ledger({ refreshKey }) {
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await listDocuments({ limit: 10 });
      setDocuments(data.documents || []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="ledger">
      <div className="ledger__header">
        <h3>Recent entries</h3>
        <span className="ledger__count mono">{documents.length ? `${documents.length} shown` : ""}</span>
      </div>

      {status === "loading" && <p className="ledger__empty">Reading the ledger…</p>}
      {status === "error" && <p className="ledger__empty">Couldn't reach the backend to load recent entries.</p>}
      {status === "ready" && documents.length === 0 && (
        <p className="ledger__empty">No documents notarized yet — be the first entry.</p>
      )}

      {status === "ready" && documents.length > 0 && (
        <table className="ledger__table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Hash</th>
              <th>Submitted by</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.document_hash}>
                <td className="ledger__label">{doc.label || "untitled"}</td>
                <td>
                  <HashChip value={doc.document_hash} truncated={truncateHash(doc.document_hash)} />
                </td>
                <td className="mono">{truncateAddress(doc.submitter_address)}</td>
                <td className="ledger__time">{formatTimestamp(doc.block_timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
