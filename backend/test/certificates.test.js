import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHarness, fileBuffer } from "./helpers/harness.js";
import { pdfText } from "./helpers/pdfText.js";
import { hashBuffer } from "../src/lib/contract.js";
import { isoUtc } from "../src/lib/certificate.js";

const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

const notarize = (h, token, text, { name = "board-minutes-q3.pdf", label } = {}) => {
  let req = request(h.app).post("/api/documents/notarize").set("Authorization", `Bearer ${token}`);
  if (label) req = req.field("label", label);
  return req.attach("file", fileBuffer(text), name);
};

const certificate = (h, hash, token) => {
  const req = request(h.app).get(`/api/documents/${hash}/certificate`).buffer(true).parse(binary);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
};

test("owner gets a one-page PDF with the hash, tx hash, UTC time and network details", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  const n = await notarize(h, token, "certificate contents", { label: "Q3 minutes" });
  assert.equal(n.status, 201);

  const res = await certificate(h, n.body.documentHash, token);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/pdf");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(
    res.headers["content-disposition"],
    `attachment; filename="certificate-${n.body.documentHash.slice(2, 14)}.pdf"`
  );
  assert.equal(res.body.subarray(0, 4).toString(), "%PDF");

  const { pages, text, links } = await pdfText(res.body);
  assert.equal(pages, 1);
  assert.ok(text.includes("Proof of Existence Certificate"));
  assert.ok(text.includes(n.body.operationId), "certificate id");
  assert.ok(text.includes(n.body.documentHash), "full hash");
  assert.ok(text.includes(n.body.txHash), "tx hash");
  assert.ok(text.includes(isoUtc(n.body.timestamp)), "UTC ISO time");
  assert.match(isoUtc(n.body.timestamp), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.ok(text.includes(String(n.body.blockNumber)), "block number");
  assert.ok(text.includes(h.config.network.name));
  assert.ok(text.includes(h.config.chain.contractAddress));
  assert.ok(text.includes("Q3 minutes"), "public label");
  assert.ok(text.includes("Test network: for demonstration only"));
  assert.ok(text.includes("How to check this yourself"));
  assert.ok(text.includes("It does not prove authorship and is not a legal notarization."));
  assert.ok(links.includes(`https://doc-notary.vercel.app/verify/${n.body.documentHash}`), "verify link");
  assert.ok(links.includes(`${h.config.network.explorerUrl}/tx/${n.body.txHash}`), "explorer link");
});

test("network name, explorer and test-network line all come from config", async () => {
  const h = await createHarness({
    env: { CHAIN_ID: "8453", NETWORK_NAME: "Base", EXPLORER_URL: "https://basescan.org", PUBLIC_APP_URL: "https://notary.example.com" },
  });
  const { token } = await h.signUp();
  const n = await notarize(h, token, "mainnet style");
  const { text, links } = await pdfText((await certificate(h, n.body.documentHash, token)).body);
  assert.ok(text.includes("Base"));
  assert.ok(links.includes(`https://basescan.org/tx/${n.body.txHash}`));
  assert.ok(links.includes(`https://notary.example.com/verify/${n.body.documentHash}`));
  assert.ok(!text.includes("Test network"));
  assert.ok(!/sepolia/i.test(text + links.join(" ")));
});

test("non-owner, unknown hash and legacy rows get 404; no session gets 401", async () => {
  const h = await createHarness();
  const alice = await h.signUp();
  const bob = await h.signUp();
  const n = await notarize(h, alice.token, "alice only");

  assert.equal((await certificate(h, n.body.documentHash)).status, 401);
  assert.equal((await certificate(h, n.body.documentHash, bob.token)).status, 404);
  assert.equal((await certificate(h, `0x${"ef".repeat(32)}`, alice.token)).status, 404);
  assert.equal((await certificate(h, "not-a-hash", alice.token)).status, 400);

  const legacyHash = hashBuffer(fileBuffer("legacy cert"));
  await h.pg.db.query(
    `insert into documents (document_hash, label, submitter_address, tx_hash, block_timestamp, storage_key, is_legacy)
     values ($1, 'old.pdf', $2, '0xabc', 1, 'documents/legacy', true)`,
    [legacyHash, h.chain.relayerAddress]
  );
  const legacy = await certificate(h, legacyHash, alice.token);
  assert.equal(legacy.status, 404);
  // Same body as any other miss, so existence isn't leaked.
  const unknown = await certificate(h, `0x${"ef".repeat(32)}`, alice.token);
  assert.equal(legacy.body.toString(), unknown.body.toString());
});

test("an unconfirmed operation gets 409; once mined the certificate is available", async () => {
  const h = await createHarness({ chainOptions: { autoMine: false } });
  const { token } = await h.signUp();
  const n = await notarize(h, token, "still pending");
  assert.equal(n.status, 202);

  const pending = await certificate(h, n.body.documentHash, token);
  assert.equal(pending.status, 409);
  assert.equal(JSON.parse(pending.body.toString()).code, "NOT_CONFIRMED");

  h.chain.mine();
  await h.notarization.reconcileOnce({ minAgeMs: -1000 });
  assert.equal((await certificate(h, n.body.documentHash, token)).status, 200);
});

test("confirmed but not yet indexed (metadata write failed) still yields a certificate", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  h.pg.faults.set("upsertDocument", 1);
  const n = await notarize(h, token, "index later");
  assert.equal(n.body.metadataStatus, "pending");
  h.pg.faults.set("upsertDocument", Infinity); // keep it unindexed for the request below
  const res = await certificate(h, n.body.documentHash, token);
  assert.equal(res.status, 200);
  assert.ok((await pdfText(res.body)).text.includes(n.body.txHash));
});

test("the original filename is on the owner's PDF and in no public response", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  const name = "salary-review-confidential.pdf";
  const n = await notarize(h, token, "private name", { name });

  const { text } = await pdfText((await certificate(h, n.body.documentHash, token)).body);
  assert.ok(text.includes(name));

  for (const path of [`/api/documents/verify/${n.body.documentHash}`, "/api/network", "/api/stats", "/health"]) {
    const res = await request(h.app).get(path);
    assert.equal(res.status, 200, path);
    assert.ok(!JSON.stringify(res.body).includes(name), `${path} leaked the filename`);
  }
  // Not on chain either.
  assert.equal((await h.chain.verify(n.body.documentHash)).label, "");
});

test("certificates entitlement switched off gives 403 PLAN_REQUIRED", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  const n = await notarize(h, token, "gated");
  const real = h.entitlements.getEntitlements;
  h.entitlements.getEntitlements = async (id) => ({ ...(await real(id)), certificates: false });

  const res = await certificate(h, n.body.documentHash, token);
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body.toString()).code, "PLAN_REQUIRED");
});

test("both plans include certificates today", async () => {
  const { PLAN_CATALOG } = await import("../src/lib/entitlements.js");
  assert.equal(PLAN_CATALOG.free.certificates, true);
  assert.equal(PLAN_CATALOG.standard.certificates, true);
});

test("GET /api/network exposes only public network details", async () => {
  const h = await createHarness();
  const res = await request(h.app).get("/api/network");
  assert.deepEqual(res.body, {
    name: "Ethereum Sepolia (test network)",
    isTestnet: true,
    chainId: 11155111,
    explorerUrl: "https://sepolia.etherscan.io",
    contractAddress: h.config.chain.contractAddress,
  });
});

test("filenames outside the standard fonts' character set still render (replaced, not broken)", async () => {
  const { pdfSafe } = await import("../src/lib/certificate.js");
  assert.equal(pdfSafe("Café – résumé.pdf"), "Café – résumé.pdf");
  assert.equal(pdfSafe("合同📄.pdf"), "???.pdf");

  const h = await createHarness();
  const { token } = await h.signUp();
  const n = await notarize(h, token, "unicode name", { name: "合同📄.pdf" });
  const res = await certificate(h, n.body.documentHash, token);
  assert.equal(res.status, 200);
  assert.equal((await pdfText(res.body)).pages, 1);
});
