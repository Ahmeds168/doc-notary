import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { loadConfig, ConfigError, secretValues } from "../src/config.js";
import { createRedactor, createLogger } from "../src/lib/errors.js";
import { createHarness, TEST_ENV } from "./helpers/harness.js";

test("startup validation lists missing variables by name and never includes values", () => {
  const env = { ...TEST_ENV, SUPABASE_URL: "", PRIVATE_KEY: "not-a-key", CORS_ORIGIN: "https://*.vercel.app" };
  assert.throws(
    () => loadConfig(env),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /SUPABASE_URL is required/);
      assert.match(err.message, /PRIVATE_KEY must be/);
      assert.match(err.message, /CORS_ORIGIN/);
      for (const value of [TEST_ENV.R2_SECRET_ACCESS_KEY, TEST_ENV.SUPABASE_SERVICE_ROLE_KEY, "not-a-key"]) {
        assert.ok(!err.message.includes(value), "config error leaked a value");
      }
      return true;
    }
  );
});

test("CORS_ORIGIN accepts a comma-separated list of exact origins", () => {
  const config = loadConfig({ ...TEST_ENV, CORS_ORIGIN: "https://doc-notary.vercel.app, https://notary.example.com" });
  assert.deepEqual(config.cors.origins, ["https://doc-notary.vercel.app", "https://notary.example.com"]);
  assert.throws(() => loadConfig({ ...TEST_ENV, CORS_ORIGIN: "https://x.example.com/path" }), ConfigError);
});

test("localhost is allowed by default outside production and off by default in production", () => {
  const rest = { ...TEST_ENV };
  delete rest.NODE_ENV;
  delete rest.CORS_ALLOW_LOCALHOST;
  assert.equal(loadConfig({ ...rest, NODE_ENV: "development" }).cors.allowLocalhost, true);
  assert.equal(loadConfig({ ...rest, NODE_ENV: "production" }).cors.allowLocalhost, false);
});

test("logger redacts secrets (e.g. RPC API keys embedded in ethers error messages)", () => {
  const config = loadConfig(TEST_ENV);
  const lines = [];
  const sink = { log: (...a) => lines.push(a.join(" ")), warn: (...a) => lines.push(a.join(" ")), error: (...a) => lines.push(a.join(" ")) };
  const log = createLogger(createRedactor(secretValues(config)), sink);
  log.error("rpc failed", new Error(`request to ${TEST_ENV.SEPOLIA_RPC_URL} failed`));
  assert.ok(!lines.join("\n").includes("test-rpc-api-key"));
  assert.match(lines.join("\n"), /\[redacted\]/);
});

test("CORS: allowed origin gets ACAO header, disallowed origins (incl. other *.vercel.app) do not", async () => {
  const h = await createHarness();
  const ok = await request(h.app).get("/health").set("Origin", "https://doc-notary.vercel.app");
  assert.equal(ok.headers["access-control-allow-origin"], "https://doc-notary.vercel.app");

  for (const origin of ["https://evil-doc-notary.vercel.app", "https://attacker.example.com", "http://doc-notary.vercel.app"]) {
    const res = await request(h.app).get("/health").set("Origin", origin);
    assert.equal(res.headers["access-control-allow-origin"], undefined, origin);
  }

  const preflight = await request(h.app)
    .options("/api/documents/notarize")
    .set("Origin", "https://attacker.example.com")
    .set("Access-Control-Request-Method", "POST");
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);
});

test("CORS: localhost dev origins allowed only when enabled", async () => {
  const dev = await createHarness();
  const res = await request(dev.app).get("/health").set("Origin", "http://localhost:5173");
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5173");

  const prod = await createHarness({ env: { CORS_ALLOW_LOCALHOST: "false" } });
  const blocked = await request(prod.app).get("/health").set("Origin", "http://localhost:5173");
  assert.equal(blocked.headers["access-control-allow-origin"], undefined);
});
