import "dotenv/config";
import { randomUUID } from "node:crypto";
import { loadConfig, secretValues, ConfigError } from "./config.js";
import { createApp } from "./app.js";
import { createChainClient } from "./lib/contract.js";
import { createStorage } from "./lib/r2.js";
import { createSupabaseClient, createStore } from "./lib/supabase.js";
import { createAuthVerifier } from "./lib/auth.js";
import { createEntitlements } from "./lib/entitlements.js";
import { createLogger, createRedactor } from "./lib/errors.js";
import { createNotarizationService, createRelayerCoordinator } from "./services/notarization.js";
import { createBilling } from "./services/billing.js";
import { createKelviqClient } from "./lib/kelviq.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  // ConfigError messages contain variable names only, never values.
  console.error(err instanceof ConfigError ? err.message : "Failed to load configuration.");
  process.exit(1);
}

const log = createLogger(createRedactor(secretValues(config)));
for (const warning of config.warnings) log.warn(`[config] ${warning}`);

const supabase = createSupabaseClient(config);
const store = createStore(supabase);
const chain = createChainClient(config);
const storage = createStorage(config);
const auth = createAuthVerifier(supabase);
const entitlements = createEntitlements({ store, config });
const relayer = createRelayerCoordinator({
  store,
  holderId: `${process.env.RENDER_INSTANCE_ID || "instance"}:${randomUUID()}`,
  ttlSeconds: config.relayer.leaseTtlSeconds,
  waitMs: config.relayer.leaseWaitMs,
});
const notarization = createNotarizationService({ store, chain, storage, config, log, relayer });

const kelviq = config.billing.kelviqApiKey
  ? createKelviqClient({ apiKey: config.billing.kelviqApiKey, baseUrl: config.billing.kelviqBaseUrl })
  : null;
if (!kelviq) log.warn("[config] KELVIQ_API_KEY is not set: paid checkout is disabled.");
const billing = createBilling({ config, store, kelviq, log });

const app = createApp({ config, store, chain, storage, auth, entitlements, notarization, log, billing });

app.listen(config.port, () => {
  log.info(`doc-notary backend listening on port ${config.port}`);
});

// Reconciler: finishes pending transactions, indexes confirmed-but-missing records, and
// abandons attempts that died before broadcasting. Safe to run on every instance.
if (config.reconcile.intervalMs > 0) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await notarization.reconcileOnce();
    } catch (err) {
      log.warn("[reconcile] pass failed", err);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000).unref();
  setInterval(tick, config.reconcile.intervalMs).unref();
}
