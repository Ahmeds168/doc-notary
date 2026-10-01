import { useEffect, useState } from "react";
import { listMyDocuments, getDownloadUrl } from "../lib/api.js";
import { truncateHash, formatTimestamp } from "../lib/hash.js";
import { HashChip } from "./HashChip.jsx";
import "./Ledger.css";

/** The signed-in user's own notarizations (Standard plan's history dashboard). */
export function Ledger({ session, account, refreshKey }) {
  const token = session?.access_token;
  const hasDashboard = Boolean(account?.entitlements?.historyDashboard);
  const [state, setState] = useState({ key: null, status: "loading", documents: [], total: 0 });
  const [downloadError, setDownloadError] = useState(null);
  const requestKey = `${token}:${refreshKey}`;

  useEffect(() => {
    if (!token || !hasDashboard) return undefined;
    let active = true;
    listMyDocuments({ token, limit: 10 })
      .then((data) => active && setState({ key: requestKey, status: "ready", documents: data.documents || [], total: data.total }))
      .catch(() => active && setState({ key: requestKey, status: "error", documents: [], total: 0 }));
    return () => {
      active = false;
    };
  }, [token, hasDashboard, requestKey]);

  const download = async (hash) => {
    setDownloadError(null);
    try {
      const { url } = await getDownloadUrl(hash, token);
      window.location.assign(url);
    } catch {
      setDownloadError("Couldn't prepare that download. Please try again.");
    }
  };

  const status = state.key === requestKey ? state.status : "loading";

  return (
    <div className="ledger">
      <div className="ledger__header">
        <h3>Your notarizations</h3>
        <span className="ledger__count mono">
          {status === "ready" && state.total ? `${state.documents.length} of ${state.total} shown` : ""}
        </span>
      </div>

      {!session && <p className="ledger__empty">Sign in to see the documents you've notarized.</p>}
      {session && account && !hasDashboard && (
        <p className="ledger__empty">
          The history dashboard (with private downloads of your originals) is part of the Standard plan.
        </p>
      )}
      {session && hasDashboard && status === "loading" && <p className="ledger__empty">Reading your ledger…</p>}
      {session && hasDashboard && status === "error" && (
        <p className="ledger__empty">Couldn't load your history right now. Your on-chain proofs are unaffected.</p>
      )}
      {session && hasDashboard && status === "ready" && state.documents.length === 0 && (
        <p className="ledger__empty">Nothing notarized yet — your first entry will appear here.</p>
      )}
      {downloadError && <p className="ledger__empty">{downloadError}</p>}

      {session && hasDashboard && status === "ready" && state.documents.length > 0 && (
        <table className="ledger__table">
          <thead>
            <tr>
              <th>File (private)</th>
              <th>Hash</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.documents.map((doc) => (
              <tr key={doc.documentHash}>
                <td className="ledger__label" title={doc.label ? `Public label: ${doc.label}` : undefined}>
                  {doc.originalFilename || doc.label || "untitled"}
                </td>
                <td>
                  <HashChip value={doc.documentHash} truncated={truncateHash(doc.documentHash)} />
                </td>
                <td className="ledger__time">{formatTimestamp(doc.timestamp)}</td>
                <td>
                  <button type="button" className="ledger__download" onClick={() => download(doc.documentHash)}>
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
