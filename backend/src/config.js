import { ethers } from "ethers";

export class ConfigError extends Error {
  constructor(problems) {
    // Only variable NAMES are ever included — never values.
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const REQUIRED = [
  "CORS_ORIGIN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SEPOLIA_RPC_URL",
  "PRIVATE_KEY",
  "CONTRACT_ADDRESS",
];

/** Parse a comma-separated list of exact origins (scheme://host[:port], no path, no wildcards). */
export function parseOrigins(raw, problems) {
  const origins = [];
  for (const entry of String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      problems.push(`CORS_ORIGIN contains an entry that is not a valid URL`);
      continue;
    }
    if (entry.includes("*") || !["http:", "https:"].includes(url.protocol) || url.origin !== entry.replace(/\/$/, "")) {
      problems.push(`CORS_ORIGIN entries must be exact origins like https://doc-notary.vercel.app (no wildcards or paths)`);
      continue;
    }
    origins.push(url.origin);
  }
  return origins;
}

function intVar(env, name, fallback, problems, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

function ethVar(env, name, fallback, problems) {
  const raw = env[name] === undefined || env[name] === "" ? fallback : env[name];
  try {
    const wei = ethers.parseEther(String(raw));
    if (wei <= 0n) throw new Error("non-positive");
    return wei;
  } catch {
    problems.push(`${name} must be a positive ETH amount, e.g. "0.05"`);
    return 0n;
  }
}

function boolVar(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes"].includes(String(raw).toLowerCase());
}

/**
 * Build and validate configuration. Throws ConfigError (listing variable names only)
 * so the server refuses to start half-configured.
 */
export function loadConfig(env = process.env) {
  const problems = [];
  for (const name of REQUIRED) {
    if (!env[name] || !String(env[name]).trim()) problems.push(`${name} is required`);
  }

  const nodeEnv = env.NODE_ENV || "development";
  const corsOrigins = parseOrigins(env.CORS_ORIGIN, problems);

  if (env.PRIVATE_KEY && !/^(0x)?[0-9a-fA-F]{64}$/.test(env.PRIVATE_KEY.trim())) {
    problems.push("PRIVATE_KEY must be a 32-byte hex private key");
  }
  if (env.CONTRACT_ADDRESS && !ethers.isAddress(env.CONTRACT_ADDRESS.trim())) {
    problems.push("CONTRACT_ADDRESS must be a valid Ethereum address");
  }
  for (const name of ["SUPABASE_URL", "SEPOLIA_RPC_URL"]) {
    if (env[name]) {
      try {
        new URL(env[name]);
      } catch {
        problems.push(`${name} must be a valid URL`);
      }
    }
  }

  const config = {
    nodeEnv,
    port: intVar(env, "PORT", 4000, problems, { min: 1, max: 65535 }),
    // Render (and most PaaS) put one proxy hop in front of the app; needed for per-IP limits.
    trustProxy: intVar(env, "TRUST_PROXY", nodeEnv === "production" ? 1 : 0, problems, { max: 10 }),

    cors: {
      origins: corsOrigins,
      // localhost / 127.0.0.1 on any port, for local frontend development.
      allowLocalhost: boolVar(env, "CORS_ALLOW_LOCALHOST", nodeEnv !== "production"),
    },

    r2: {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET_NAME,
      endpoint: env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined,
    },

    supabase: {
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      metadataTimeoutMs: intVar(env, "METADATA_TIMEOUT_MS", 3000, problems, { min: 100, max: 60000 }),
    },

    chain: {
      rpcUrl: env.SEPOLIA_RPC_URL,
      privateKey: env.PRIVATE_KEY?.trim(),
      contractAddress: env.CONTRACT_ADDRESS?.trim(),
      chainId: intVar(env, "CHAIN_ID", 11155111, problems, { min: 1 }), // Sepolia
      // Block the contract was deployed in; bounds event-log scans during reconciliation.
      deployBlock: intVar(env, "CONTRACT_DEPLOY_BLOCK", 0, problems),
      receiptTimeoutMs: intVar(env, "TX_RECEIPT_TIMEOUT_MS", 90_000, problems, { min: 1000 }),
    },

    upload: {
      // Absolute ceiling regardless of plan.
      maxFileSizeBytes: intVar(env, "MAX_FILE_SIZE_BYTES", 25 * 1024 * 1024, problems, { min: 1 }),
    },

    relayer: {
      dailyBudgetWei: ethVar(env, "RELAYER_DAILY_BUDGET_ETH", "0.05", problems),
      maxTxCostWei: ethVar(env, "RELAYER_MAX_TX_COST_ETH", "0.002", problems),
      maxInFlightPerUser: intVar(env, "MAX_IN_FLIGHT_PER_USER", 2, problems, { min: 1, max: 100 }),
      leaseTtlSeconds: intVar(env, "RELAYER_LEASE_TTL_SECONDS", 60, problems, { min: 5, max: 600 }),
      leaseWaitMs: intVar(env, "RELAYER_LEASE_WAIT_MS", 15_000, problems, { min: 0 }),
    },

    rateLimit: {
      notarizePerMinute: intVar(env, "RATE_LIMIT_NOTARIZE_PER_MINUTE", 5, problems, { min: 1 }),
      verifyPerMinute: intVar(env, "RATE_LIMIT_VERIFY_PER_MINUTE", 60, problems, { min: 1 }),
    },

    downloads: {
      signedUrlTtlSeconds: intVar(env, "DOWNLOAD_URL_TTL_SECONDS", 300, problems, { min: 30, max: 3600 }),
    },

    reconcile: {
      intervalMs: intVar(env, "RECONCILE_INTERVAL_MS", 60_000, problems, { min: 0 }),
      staleAfterMs: intVar(env, "RECONCILE_STALE_AFTER_MS", 10 * 60_000, problems, { min: 1000 }),
    },

    entitlements: {
      // "local" reads profiles.plan. "kelviq" is the future billing integration seam.
      provider: env.ENTITLEMENTS_PROVIDER || "local",
    },
  };

  if (!["local", "kelviq"].includes(config.entitlements.provider)) {
    problems.push(`ENTITLEMENTS_PROVIDER must be "local" or "kelviq"`);
  }
  if (config.relayer.maxTxCostWei > config.relayer.dailyBudgetWei) {
    problems.push("RELAYER_MAX_TX_COST_ETH must not exceed RELAYER_DAILY_BUDGET_ETH");
  }

  if (problems.length) throw new ConfigError(problems);

  config.warnings = [];
  if (env.R2_PUBLIC_BASE_URL) {
    config.warnings.push(
      "R2_PUBLIC_BASE_URL is set but ignored: originals are private and only served through authenticated, short-lived signed URLs. Make sure the bucket has no public access."
    );
  }
  return config;
}

/** Values that must never appear in logs or responses. */
export function secretValues(config) {
  return [
    config.r2.accessKeyId,
    config.r2.secretAccessKey,
    config.supabase.serviceRoleKey,
    config.chain.privateKey,
    config.chain.rpcUrl, // RPC URLs usually embed an API key
  ].filter((v) => typeof v === "string" && v.length >= 8);
}
