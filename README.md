# Document Notary

A decentralized proof-of-existence tool. Upload any file, and it gets hashed (SHA-256),
sealed on the Ethereum Sepolia testnet, and permanently verifiable — without ever putting
the file itself on-chain. Anyone can later prove a document existed, unaltered, at a given
moment, just by re-hashing it and checking the ledger.

This is a "Web2 + Web3" full-stack project: a smart contract for the trust layer, a
conventional backend/database for fast search and file storage, and a polished frontend
tying it together.

**Live demo:** _add your deployed Vercel URL here_
**Contract on Sepolia:** _add your Etherscan link here_

---

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌────────────────┐
│  Frontend   │─────▶│   Backend    │─────▶│  Sepolia chain  │
│  (Vercel)   │      │  (Render)    │      │ DocumentNotary  │
│  React/Vite │◀─────│ Node/Express │◀─────│    contract     │
└─────────────┘      └──────┬───────┘      └─────────────────┘
                             │
                ┌────────────┼────────────┐
                ▼                         ▼
        ┌───────────────┐       ┌──────────────────┐
        │ Cloudflare R2  │       │     Supabase      │
        │ (file storage) │       │ (index/metadata)  │
        └───────────────┘       └──────────────────┘
```

- **Smart contract** (`contracts/DocumentNotary.sol`) is the source of truth: it stores a
  document's SHA-256 hash, the submitting address, and a timestamp. This is the only part
  of the system a user needs to trust — everything else is convenience.
- **Backend** hashes uploads, stores the original file in Cloudflare R2 (content-addressed,
  so re-uploading the same file is a no-op), writes the hash on-chain, and indexes the
  result in Supabase so the frontend can search/list without querying the chain for every
  request.
- **Frontend** lets users notarize a new file or verify an existing one (by re-uploading it
  or pasting a known hash), and browse a public ledger of recent notarizations.

### Why a relayer pattern?

The backend holds a funded wallet and pays gas on the user's behalf when calling
`notarize()`. This keeps the UX simple — no MetaMask required — at the cost of the
on-chain `submitter` address being the relayer's, not the end user's. Supabase records who
uploaded what off-chain. A future iteration could let users sign the transaction
client-side (e.g. via MetaMask/WalletConnect) for a fully non-custodial version.

---

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity 0.8.24, Hardhat, deployed to Sepolia |
| Backend | Node.js, Express, ethers.js v6 |
| File storage | Cloudflare R2 (S3-compatible) |
| Database | Supabase (Postgres) |
| Frontend | React 19, Vite |
| Hosting | Vercel (frontend), Render (backend) |

---

## Repo structure

```
doc-notary/
├── contracts/DocumentNotary.sol   # the notary smart contract
├── test/DocumentNotary.test.js    # Hardhat test suite
├── scripts/deploy.js              # Sepolia deployment script
├── hardhat.config.js
├── backend/                       # Express API
│   ├── src/
│   │   ├── server.js
│   │   ├── config.js
│   │   ├── lib/                   # r2.js, supabase.js, contract.js
│   │   ├── routes/documents.js
│   │   └── middleware/upload.js
│   └── supabase/schema.sql        # DB schema + RLS policies
├── frontend/                      # React app
│   └── src/
│       ├── components/            # Seal, Dropzone, NotarizePanel, VerifyPanel, Ledger...
│       ├── lib/                   # api.js, hash.js
│       └── App.jsx
├── render.yaml                    # Render deployment blueprint
└── .github/workflows/contracts-ci.yml
```

---

## Running it locally

### 1. Smart contract

```bash
npm install
cp .env.example .env   # fill in SEPOLIA_RPC_URL, PRIVATE_KEY
npx hardhat test
npx hardhat run scripts/deploy.js --network sepolia
```

Copy the deployed contract address into both `backend/.env` and `frontend/.env`.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in R2, Supabase, and chain credentials
npm run dev
```

Run the SQL in `backend/supabase/schema.sql` against your Supabase project before starting
the server.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # point VITE_API_BASE_URL at your backend
npm run dev
```

---

## Deploying

- **Contract:** `npx hardhat run scripts/deploy.js --network sepolia` (needs a funded
  Sepolia wallet — get testnet ETH from a faucet).
- **Backend → Render:** connect this repo, Render will pick up `render.yaml`. Fill in the
  env vars in the Render dashboard (they're marked `sync: false` so they're not committed).
- **Frontend → Vercel:** connect this repo with root directory `frontend/`; `vercel.json`
  handles the build config. Set `VITE_API_BASE_URL` to your live Render URL.
- **Storage:** create an R2 bucket in the Cloudflare dashboard and generate S3-compatible
  API credentials.
- **Database:** create a Supabase project and run `backend/supabase/schema.sql` in the SQL
  editor.

---

## Design notes

The visual identity leans into what a notary actually is — a stamp and a ledger — rather
than a generic dashboard look: an ink-navy palette with a brass wax-seal accent, paired
with Fraunces (display) and IBM Plex Sans/Mono (body/data). The signature interaction is
an animated seal that presses down when a document is notarized or verified — brass while
in flight, forest green once verified, rust if no record is found.

## License

All rights reserved. See [LICENSE](LICENSE) for details.
