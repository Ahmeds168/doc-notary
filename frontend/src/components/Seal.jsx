import "./Seal.css";

/**
 * The app's signature element: a wax-seal-style stamp.
 * states:
 *  - idle: resting, brass, gentle rotation loop (used in hero)
 *  - pressing: mid-stamp animation (during an in-flight request)
 *  - verified: pressed down, forest green ink, "VERIFIED"
 *  - notfound: pressed down, rust ink, "NO RECORD"
 */
export function Seal({ state = "idle", label, size = 120 }) {
  const ringText = label ?? defaultRingText(state);

  return (
    <div className={`seal seal--${state}`} style={{ "--seal-size": `${size}px` }}>
      <svg viewBox="0 0 200 200" className="seal__svg" aria-hidden="true">
        <circle cx="100" cy="100" r="94" className="seal__outer" />
        <circle cx="100" cy="100" r="78" className="seal__ring" />
        <circle cx="100" cy="100" r="34" className="seal__core" />
        <path
          id="sealTextPath"
          d="M 100,100 m -60,0 a 60,60 0 1,1 120,0 a 60,60 0 1,1 -120,0"
          fill="none"
        />
        <text className="seal__ring-text">
          <textPath href="#sealTextPath" startOffset="0%">
            {ringText}
          </textPath>
        </text>
        <g className="seal__mark">
          <path d="M85 100 L96 111 L118 87" className="seal__check" />
        </g>
      </svg>
    </div>
  );
}

function defaultRingText(state) {
  if (state === "verified") return "• VERIFIED • VERIFIED • VERIFIED •";
  if (state === "notfound") return "• NO RECORD • NO RECORD • NO RECORD •";
  if (state === "pressing") return "• NOTARIZING • NOTARIZING • NOTARIZING •";
  return "• PROOF OF EXISTENCE • ON-CHAIN •";
}
