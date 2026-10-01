# Document Notary

A proof-of-existence tool. Notarize a file and its SHA-256 fingerprint is sealed on the
Ethereum **Sepolia testnet**; anyone can later check that an identical file existed no later
than that block's timestamp — by hashing it in their own browser, without uploading it.

| | |
|---|---|
| **Live app** | https://doc-notary.vercel.app |
| **API** | https://doc-notary-backend-4g87.onrender.com (Render free tier — first request after idle can take ~1 min) |
| **Contract** | [`0x2c6008c33958949E69019797E39C572BB84f6589`](https://sepolia.etherscan.io/address/0x2c6008c33958949E69019797E39C572BB84f6589) on Sepolia |

---

## What a proof does — and doesn't — establish

A record in `DocumentNotary` proves that **some party controlling the relayer wallet submitted
this exact SHA-256 hash no later than the recorded block timestamp.** Concretely:

- ✅ **Integrity:** a file whose SHA-256 matches the recorded hash is byte-for-byte identical to what
  was notarized. Changing a single byte changes the hash.
- ✅ **Existence in time:** the hash (and so the file) existed no later than the block timestamp.
- ❌ **Not authorship or identity.** The on-chain `submitter` is always the service's **relayer
  wallet** (it pays gas for everyone), never the end user. The chain does not say *who* uploaded a file.
- ❌ **Not "first".** It proves existence *by* a time, not that nobody had the file earlier.
- ❌ **Not legal notarization.** No identity verification or legal witness is involved.

### Relayer trust model

The backend holds one funded wallet and calls `notarize()` on behalf of signed-in users, so
users need no wallet or ETH. The consequences:

- Users trust the operator to actually submit what they uploaded. They can check it themselves:
  hash the file locally (the Verify tab does this) and confirm the record and timestamp on-chain.
- Which account notarized a document is recorded **off-chain only**, in the operator's Supabase
  database (`documents.user_id`). That link is not publicly verifiable and is only as trustworthy
  as the operator. Records made before accounts existed (legacy rows) have **no** uploader
  identity at all; they only carry the shared relayer address.
- The operator controls spending: per-user quotas, a per-transaction fee cap and a daily relayer
  budget (see [Limits](#plans-quotas-and-limits)).

### What is public on-chain — forever

Everything passed to `notarize(bytes32 documentHash, string label)` is permanently public:

- the document hash,
- the `label` string,
- the relayer address and block timestamp.

**Original filenames are not sent on-chain by default.** The label is empty unless the user
ticks *"Add a public on-chain label"* and types one (max 64 characters). The UI warns that it
cannot be edited or deleted. Note: before this change the backend sent each file's original
name as the label, so **legacy records already have their filenames on-chain**. That cannot
be undone.

A hash alone does not reveal a file's contents, but anyone who already has a candidate file
can check whether it was notarized. Don't rely on secrecy of a hash for small or guessable documents.

### What is private

- The **original file** is stored in a private Cloudflare R2 bucket. Only the account that
  notarized it can get a short-lived (5 min default) signed download URL.
- The **original filename**, file size, content type, owner and storage key live only in
  Supabase. Public API responses never include them.

### Sepolia testnet limitations

Sepolia is a **test network**: its ETH has no value, it has no economic security guarantees
comparable to mainnet, and its future is decided by Ethereum client teams. It's fine for
demonstrating the mechanism, not for proofs with legal or commercial weight. A mainnet
deployment would need a real gas budget and a careful re-read of the trust model above.

---

## Architecture

```
┌─────────────┐  hash only   ┌──────────────┐ relayer tx   ┌─────────────────┐
│  Frontend   │─────────────▶│   Backend    │─────────────▶│  Sepolia chain  │
│  (Vercel)   │  (verify)    │  (Render)    │◀─────────────│ DocumentNotary  │
│  React/Vite │──────────────▶ Node/Express │  verify()    └─────────────────┘
└──────┬──────┘ file+JWT     └──────┬───────┘
       │ (notarize)                 │
       │ Supabase Auth  ┌───────────┴────────────┐
       └───────────────▶│                        ▼
                ┌───────▼──────────┐   ┌─────────────────┐
                │    Supabase      │   │  Cloudflare R2   │
                │ Auth + Postgres  │   │ (private files)  │
                └──────────────────┘   └─────────────────┘
```

- **Contract** (`contracts/DocumentNotary.sol`): the source of truth. `notarize()` stores hash →
  (submitter, timestamp, label) and rejects duplicates; `verify()` is a free read.
- **Backend** (`backend/`): verifies the Supabase session, enforces plan quotas and spend limits,
  stores the original in R2, signs and broadcasts the relayer transaction, tracks every attempt
  in `notarization_operations`, and indexes confirmed records in `documents`.
- **Frontend** (`frontend/`): Supabase Auth sign-in; Notarize (uploads the file); Verify (hashes
  locally and sends only the hash); "Your notarizations" history for Standard accounts.

### Notarize vs. verify: what leaves your device

| Action | Sent to the backend | Account needed |
|---|---|---|
| **Notarize** | the whole file (stored privately in R2), plus an optional public label | yes |
| **Verify** (file) | **only the SHA-256 hash**, computed in your browser | no |
| **Verify** (paste hash) | only the hash | no |

There is no "verify by upload" endpoint any more.

---

## Accounts, plans, quotas and limits

Authentication is **Supabase Auth** (email + password). The frontend gets a session from
Supabase and sends `Authorization: Bearer <access token>`; the backend verifies the token with
Supabase on every protected request. **User identity only comes from that verified token**.
User ids, wallet addresses or other client-supplied fields are never trusted.

### Confirmation emails

The **Confirm signup** template (Supabase → Authentication → Emails → Templates) should link to
this site instead of the Supabase project URL, which helps with spam filtering:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm my email address</a>
```

The frontend handles `/auth/confirm`: it verifies the token with `supabase.auth.verifyOtp`,
signs the user in and shows a banner. **Site URL** must be `https://doc-notary.vercel.app`.
Production email needs custom SMTP. Supabase's built-in sender only delivers to your own team members.

### Plans and quotas

| | Free | Standard |
|---|---|---|
| Notarizations / month (UTC calendar month) | 3 | 25 |
| Max file size | 5 MB | 25 MB |
| History dashboard + private downloads list | – | ✓ |
| Support | – | email |
| Verification | unlimited | unlimited |

Plans live in `profiles.plan` (`free` by default). Limits are defined once in
`backend/src/lib/entitlements.js` and used by both the abuse protection and the paid tiers.
Failed attempts do **not** consume quota.

### Where each limit is enforced (and how it behaves across instances)

Checked in this order on `POST /api/documents/notarize`, cheapest first:

1. **Per-IP and per-user burst rate limits** (`RATE_LIMIT_*`). In-memory, so **per instance**:
   with N instances a client could get up to N× the limit. They only exist to absorb bursts.
2. **Auth.** No valid session → `401` before anything else.
3. **Preflight, before the body is read:** monthly usage (`402 QUOTA_EXCEEDED`) and the declared
   `Content-Length` against the plan's size limit (`413`). Multer then enforces the size limit
   while streaming, as a backstop.
4. **Authoritative reservation in Postgres** (`reserve_notarization()`), before any R2 upload or
   chain call. It runs under a transaction-scoped advisory lock and atomically checks:
   - no other non-failed operation exists for this hash (partial unique index),
   - monthly quota,
   - in-flight cap per user (`MAX_IN_FLIGHT_PER_USER`, `429`),
   - **daily relayer budget** (`RELAYER_DAILY_BUDGET_ETH`, `503`): the sum of today's
     actual gas costs plus reservations for operations still in flight.

   Because this runs inside Postgres, these limits hold **across any number of backend instances**.
5. **Per-transaction fee cap** (`RELAYER_MAX_TX_COST_ETH`): after gas estimation and before
   signing; spikes above the cap are refused (`503 RELAYER_COST_LIMIT`).

### Relayer transaction coordination

Signing and broadcasting happen inside a short critical section guarded by an in-process queue
**and** a Postgres lease row (`relayer_leases`, `acquire_relayer_lease()`). Only one process at a
time picks the nonce, signs, persists the tx hash and broadcasts. That prevents nonce collisions
between instances. The lease has a TTL (`RELAYER_LEASE_TTL_SECONDS`), so a crashed holder can't
block others forever. Receipt waits happen outside the lock. Today Render runs a single instance,
but nothing above assumes that.

---

## Reliability: operations, retries and reconciliation

Each notarization attempt is a row in `notarization_operations` with an explicit state:

| Internal status | Client `outcome` | Meaning |
|---|---|---|
| `reserved`, `uploaded` | `pending` | quota reserved / file stored; **nothing signed yet** |
| `broadcasting` | `pending` | tx signed and its **hash persisted before** broadcast |
| `submitted` | `pending` | accepted by the RPC node, awaiting a receipt |
| `confirmed` | `confirmed` | mined successfully (`metadataStatus`: `available` once indexed, else `pending`) |
| `failed` | `failed` | definitely not on-chain from this attempt (or reverted). Quota released |
| `uncertain` | `uncertain` | broadcast outcome unknown. Keeps being checked |

Key properties:

- **The tx hash is known before broadcast.** The backend signs locally, saves the hash and nonce,
  then broadcasts. If that write fails, nothing is broadcast.
- **Idempotent retries.** Retrying the same file resumes its existing operation (same
  `operationId`). It never sends a second transaction or uses more quota. If the tx confirmed
  but the `documents` insert failed, the retry (or the reconciler) completes the insert.
  A user who is at their monthly quota can't re-upload (the preflight refuses the wasted
  upload), but polling `GET /api/documents/operations/:id` or simply waiting for the reconciler
  completes the record without one.
- **Duplicates and concurrency.** Concurrent submissions of the same file collapse onto one
  operation and one transaction. If a different account submits it at the same time, that
  account gets `409`.
- **Reconciler** (every `RECONCILE_INTERVAL_MS`, on every instance, idempotent):
  - looks up receipts for pending and uncertain operations;
  - finds the notarization event if the hash landed without a recorded receipt;
  - marks an attempt `failed` (`TX_DROPPED`) when its nonce was consumed by another transaction;
  - indexes confirmed-but-missing `documents` rows;
  - abandons `reserved`/`uploaded` attempts older than `RECONCILE_STALE_AFTER_MS` (safe, since
    nothing was signed).
- **Files are never deleted while an outcome could still be on-chain.** An uploaded object is
  removed only when the attempt failed **before anything was signed or accepted** and no other
  record references it. Uncertain, submitted, dropped and reverted attempts keep their file.
- **Verification survives a metadata outage.** `GET /api/documents/verify/:hash` reads the chain
  first. Supabase metadata is optional, with a short timeout, and the response carries
  `metadataStatus`: `available`, `not_indexed`, `unavailable` or `not_applicable`. A paused or
  unreachable Supabase project no longer breaks verification or `/api/stats`. Notarizing still
  needs Supabase, for auth, quotas and tracking.

---

## API

| Method & path | Auth | Notes |
|---|---|---|
| `GET /health` | – | liveness |
| `GET /api/stats` | – | `totalNotarized`, read from the chain |
| `GET /api/me` | ✓ | plan, entitlements, this month's usage |
| `POST /api/documents/notarize` | ✓ | multipart `file`, optional `label`. `201` confirmed / `202` pending or uncertain |
| `GET /api/documents/operations/:id` | ✓ owner | poll a pending operation |
| `GET /api/documents/verify/:hash` | – | hash: 64 hex chars, `0x` optional, any case |
| `GET /api/documents/mine?limit&offset` | ✓ Standard | own history (`limit` ≤ 50) |
| `GET /api/documents/:hash/download` | ✓ owner | `{ url, expiresInSeconds }` |

Errors are `{ "error": "<safe message>", "code": "<CODE>" }`. Internal error details are
logged (with secrets redacted), never returned. Removed: `POST /api/documents/verify` (file
upload) and the public `GET /api/documents` listing, which exposed hashes, filenames and storage keys.

---

## Legacy records (pre-auth)

The 5 existing `documents` rows (and any others created before this change) were notarized
by the shared relayer with no account attached. The migration:

- marks them `is_legacy = true` and leaves `user_id` **NULL**. They are **never auto-assigned** to
  any user, including the first sign-up;
- keeps them fully **verifiable** (the chain is unaffected; `/verify` may also return their tx);
- makes their originals **non-downloadable through the API** (no owner can be established). The
  objects stay in R2.

If someone needs a legacy record attached to their account, an operator must establish
ownership **out of band**, e.g. the person proves they hold the file and can show when they
uploaded it. Having a copy of the file alone isn't enough, because anyone with the file has the
hash. Then the operator assigns it explicitly:

```sql
-- Run manually, one row at a time, after out-of-band verification.
update public.documents
   set user_id = '<auth user uuid>'
 where document_hash = '<0x…lowercase hash>' and user_id is null and is_legacy;
```

There is deliberately no self-service "claim" endpoint.

---

## Configuration

### Backend (`backend/.env`, Render env vars)

Validated at startup. The server exits listing the **names** of missing or invalid variables;
values are never logged. See `backend/.env.example` for every option and its default.

| Variable | Required | Purpose |
|---|---|---|
| `CORS_ORIGIN` | ✓ | comma-separated **exact** origins, e.g. `https://doc-notary.vercel.app`. No wildcards. Vercel preview URLs must be listed explicitly |
| `CORS_ALLOW_LOCALHOST` | | allow `http://localhost:*` / `127.0.0.1:*` (default on unless `NODE_ENV=production`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | ✓ | private bucket (**disable public access**; `R2_PUBLIC_BASE_URL` is now ignored) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✓ | service role is backend-only |
| `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS` | ✓ | relayer wallet + contract |
| `RELAYER_DAILY_BUDGET_ETH` / `RELAYER_MAX_TX_COST_ETH` | | spend limits (defaults 0.05 / 0.002) |
| `RATE_LIMIT_NOTARIZE_PER_MINUTE` / `RATE_LIMIT_VERIFY_PER_MINUTE` | | burst limits (5 / 60) |
| `MAX_FILE_SIZE_BYTES` | | operator ceiling; plans can only be lower |
| `ENTITLEMENTS_PROVIDER` | | `local` (default) or `kelviq` (not implemented, see below) |

### Frontend (`frontend/.env`, Vercel env vars)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | backend URL |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase Auth (anon/publishable key only, **never** the service role key) |

---

## Database migrations

SQL lives in `backend/supabase/`. **Nothing is applied automatically.** Review and run it yourself:

1. `schema.sql`: the original `documents` table (already applied on the existing project).
2. `migrations/001_auth_ownership_operations.sql`: profiles/plans, `documents.user_id` +
   `is_legacy`, removal of the public read policy, `notarization_operations`,
   `reserve_notarization()`, relayer lease. Idempotent, wrapped in a transaction, with rollback
   notes at the bottom.

CI applies both files to an in-memory Postgres (PGlite) with a stub `auth` schema and runs the
quota, duplicate and budget tests against them. It never touches a real database.

### Rollout order for the existing deployment

Render auto-deploys `main`, so **do these before merging**:

1. Run `migrations/001_auth_ownership_operations.sql` in the Supabase SQL editor.
2. In Supabase → Authentication, enable email sign-ups and add `https://doc-notary.vercel.app`
   to the redirect URLs.
3. Render: set `CORS_ORIGIN=https://doc-notary.vercel.app` and `NODE_ENV=production`, and remove
   `R2_PUBLIC_BASE_URL`. Optionally set the relayer limits.
4. Vercel: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Cloudflare: confirm the R2 bucket has public access (r2.dev / custom domain) **disabled**.
6. Merge. To give someone Standard until billing is wired: `cd backend && node scripts/set-plan.js <user-uuid> standard`.

---

## Kelviq billing (integration point, not yet wired)

`profiles.plan` is the synced plan value. `backend/src/lib/entitlements.js` has a clearly marked
**KELVIQ INTEGRATION POINT** describing the three steps:

1. implement `createKelviqEntitlementProvider()` against Kelviq's entitlement API;
2. add a signature-verified webhook that calls `store.setUserPlan(userId, plan, "kelviq", customerId)`;
3. set `ENTITLEMENTS_PROVIDER=kelviq`.

Usage counting stays in Postgres either way. `backend/scripts/set-plan.js` uses the same
`setUserPlan()` path for manual changes until then.

---

## Running locally

Requires Node 20+ (CI uses 22).

```bash
# Contracts
npm ci
npx hardhat test

# Backend
cd backend
npm ci
cp .env.example .env      # fill in R2, Supabase, chain credentials
npm run dev               # http://localhost:4000

# Frontend
cd frontend
npm ci
cp .env.example .env      # VITE_API_BASE_URL + Supabase URL/anon key
npm run dev               # http://localhost:5173 (allowed by CORS in development)
```

Apply the SQL in `backend/supabase/` (see above) to the Supabase project you point at.

## Tests and CI

| Suite | Command | What it covers |
|---|---|---|
| Contracts | `npx hardhat test` | notarize / verify / duplicates on an in-process Hardhat network |
| Backend | `cd backend && npm test` | auth and cross-user access, legacy rows, quotas and rate limits before upload, relayer budget and fee cap, DB failure after a confirmed tx and recovery, concurrent duplicates, uncertain broadcasts, verification during a Supabase outage, CORS, config validation, secret redaction, and the migration SQL itself |
| Frontend | `cd frontend && npm test` | browser-side verification sends only the hash, label opt-in, API client |

`.github/workflows/ci.yml` runs contract tests, backend lint and tests, and frontend lint, tests
and production build, all with `npm ci`. All external services are faked: no RPC, R2, Supabase
or testnet funds are used in CI.

## Repo structure

```
contracts/DocumentNotary.sol        smart contract (unchanged, already deployed)
test/                               Hardhat tests
backend/src/app.js                  Express app factory (dependency-injected)
backend/src/server.js               production wiring + reconciler loop
backend/src/config.js               startup config validation
backend/src/services/notarization.js  operation state machine, relayer lock, reconciler
backend/src/lib/                    chain, R2, Supabase store, auth, entitlements, validation
backend/supabase/                   schema.sql + migrations/
backend/test/                       node:test suites (fakes + PGlite)
frontend/src/                       React app (components/, lib/, __tests__/)
```

## Design notes

The visual identity leans into what a notary actually is — a stamp and a ledger — rather
than a generic dashboard look: an ink-navy palette with a brass wax-seal accent, paired
with Fraunces (display) and IBM Plex Sans/Mono (body/data). The signature interaction is
an animated seal that presses down when a document is notarized or verified — brass while
in flight, forest green once verified, rust if no record is found.

## License

All rights reserved. See [LICENSE](LICENSE) for details.
