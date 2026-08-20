import { Seal } from "./Seal.jsx";
import "./Hero.css";

export function Hero({ totalNotarized }) {
  return (
    <section className="hero">
      <div className="hero__text">
        <p className="hero__eyebrow mono">PROOF OF EXISTENCE, ON-CHAIN</p>
        <h1 className="hero__headline">
          Prove a file existed,
          <br />
          unaltered, at this moment.
        </h1>
        <p className="hero__sub">
          Upload any document and we hash it, seal the hash on Sepolia, and give you a
          permanent, publicly verifiable record — without ever putting the file itself on-chain.
        </p>
        {typeof totalNotarized === "number" && (
          <p className="hero__stat mono">{totalNotarized} documents notarized so far</p>
        )}
      </div>
      <div className="hero__seal">
        <Seal state="idle" size={220} />
      </div>
    </section>
  );
}
