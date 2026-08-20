import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { documentsRouter } from "./routes/documents.js";
import { getTotalNotarized } from "./lib/contract.js";

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = origin === "https://doc-notary.vercel.app" || origin.endsWith(".vercel.app");
    callback(null, allowed);
  },
}));


app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", service: "doc-notary-backend" });
});

app.get("/api/stats", async (_req, res) => {
  try {
    const totalNotarized = await getTotalNotarized();
    res.json({ totalNotarized });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats.", details: err.message });
  }
});

app.use("/api/documents", documentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large." });
  }
  res.status(500).json({ error: "Internal server error." });
});

app.listen(config.port, () => {
  console.log(`doc-notary backend listening on port ${config.port}`);
});
