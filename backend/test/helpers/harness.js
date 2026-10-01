import { loadConfig } from "../../src/config.js";
import { createApp } from "../../src/app.js";
import { createEntitlements } from "../../src/lib/entitlements.js";
import { createNotarizationService, createRelayerCoordinator } from "../../src/services/notarization.js";
import { createPgStore } from "./pgStore.js";
import { createFakeAuth, createFakeChain, createFakeStorage, silentLogger } from "./fakes.js";

// Syntactically valid but fake values — nothing here can reach a real service.
export const TEST_ENV = Object.freeze({
  NODE_ENV: "test",
  CORS_ORIGIN: "https://doc-notary.vercel.app",
  CORS_ALLOW_LOCALHOST: "true",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key-value",
  R2_BUCKET_NAME: "test-bucket",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-value",
  SEPOLIA_RPC_URL: "https://rpc.example.test/v2/test-rpc-api-key",
  PRIVATE_KEY: `0x${"11".repeat(32)}`,
  CONTRACT_ADDRESS: "0x2c6008c33958949E69019797E39C572BB84f6589",
  RELAYER_DAILY_BUDGET_ETH: "0.05",
  RELAYER_MAX_TX_COST_ETH: "0.002",
  RECONCILE_INTERVAL_MS: "0",
  RECONCILE_STALE_AFTER_MS: "600000",
  METADATA_TIMEOUT_MS: "200",
  RELAYER_LEASE_WAIT_MS: "2000",
});

export async function createHarness({ env = {}, chainOptions } = {}) {
  const config = loadConfig({ ...TEST_ENV, ...env });
  const pg = await createPgStore();
  const chain = createFakeChain(chainOptions);
  const storage = createFakeStorage();
  const auth = createFakeAuth();
  const log = silentLogger();
  const entitlements = createEntitlements({ store: pg.store, config });
  const relayer = createRelayerCoordinator({
    store: pg.store,
    holderId: "test-instance",
    ttlSeconds: config.relayer.leaseTtlSeconds,
    waitMs: config.relayer.leaseWaitMs,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
  });
  const notarization = createNotarizationService({ store: pg.store, chain, storage, config, log, relayer });
  const app = createApp({ config, store: pg.store, chain, storage, auth, entitlements, notarization, log });

  async function signUp(plan = "free") {
    const user = await pg.createUser(undefined, plan);
    return { user, token: auth.issue(user) };
  }

  return { app, config, pg, store: pg.store, chain, storage, auth, log, notarization, signUp };
}

export function fileBuffer(text) {
  return Buffer.from(text, "utf8");
}
