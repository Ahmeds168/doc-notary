import { BETA_NOTICE } from "../../lib/site.js";

export function BetaNotice() {
  return (
    <div className="beta-notice" role="note">
      <strong>Beta: test network</strong>
      {BETA_NOTICE}
    </div>
  );
}
