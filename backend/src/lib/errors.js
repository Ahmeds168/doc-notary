/** An error whose message and code are safe to send to clients. */
export class HttpError extends Error {
  constructor(status, code, message, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Returns a function that scrubs known secret values out of any string. ethers and
 * AWS errors can embed request URLs (with RPC API keys) or credentials in messages.
 */
export function createRedactor(secrets = []) {
  const list = secrets.filter(Boolean);
  return (text) => {
    let out = String(text ?? "");
    for (const s of list) out = out.split(s).join("[redacted]");
    return out;
  };
}

/** Logger that only ever prints redacted error summaries (no stacks with request bodies). */
export function createLogger(redact = (s) => s, sink = console) {
  const fmt = (err) =>
    err instanceof Error ? `${err.name}${err.code ? `(${err.code})` : ""}: ${redact(err.message)}` : redact(err);
  return {
    info: (msg) => sink.log(redact(msg)),
    warn: (msg, err) => sink.warn(redact(msg), err ? fmt(err) : ""),
    error: (msg, err) => sink.error(redact(msg), err ? fmt(err) : ""),
  };
}
