import { useState } from "react";
import { fetchCertificate, certificateFilename } from "../lib/api.js";
import "./CertificateButton.css";

const ERRORS = {
  401: "Your session has expired. Sign in again to download the certificate.",
  403: "Certificates aren't included in your plan.",
  404: "We couldn't find that record in your account.",
  409: "This notarization is still being confirmed. Try again in a minute.",
};

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads the owner's PDF certificate for `hash` using the session token. */
export function CertificateButton({ hash, token, className = "", label = "Download certificate" }) {
  const [state, setState] = useState("idle"); // idle | loading | error
  const [error, setError] = useState(null);

  const download = async () => {
    setState("loading");
    setError(null);
    try {
      const blob = await fetchCertificate(hash, token);
      saveBlob(blob, certificateFilename(hash));
      setState("idle");
    } catch (err) {
      setError(ERRORS[err.status] ?? "Couldn't create the certificate right now. Please try again.");
      setState("error");
    }
  };

  return (
    <span className="certificate-button">
      <button type="button" className={className} onClick={download} disabled={!token || state === "loading"}>
        {state === "loading" ? "Preparing…" : label}
      </button>
      {error && (
        <span className="certificate-button__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
