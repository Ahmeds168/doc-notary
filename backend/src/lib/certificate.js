import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// Print-friendly take on the app palette: ink text, brass accent, rust for warnings.
const INK = "#10151f";
const MUTED = "#5f6470";
const BRASS = "#8f6526";
const RULE = "#d9d4c7";
const WARN_BG = "#fbf1e0";
const WARN_TEXT = "#7a3a1e";

const PAGE = { size: "A4", margins: { top: 48, bottom: 24, left: 50, right: 50 } };

/** pdfkit's standard fonts only cover WinAnsi (cp1252); replace anything else instead of emitting garbage. */
export function pdfSafe(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u20ac]/gu, "?");
}

/** "2026-10-07T00:58:23Z" — seconds precision, always UTC. */
export function isoUtc(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "Wednesday, 7 October 2026 at 00:58:23 UTC" */
export function humanUtc(unixSeconds) {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(Number(unixSeconds) * 1000));
  return `${s} UTC`;
}

/** Largest monospace size (<= max) at which `text` fits on one line of `width`. Courier glyphs are 0.6em wide. */
function fitMonoSize(text, width, max = 11, min = 6) {
  return Math.max(min, Math.min(max, Math.floor((width / (text.length * 0.6)) * 10) / 10));
}

/**
 * Render a one-page Proof of Existence certificate.
 *
 * Everything network-specific (name, explorer, test-network flag) comes from `network`;
 * nothing here assumes a particular chain.
 *
 * @param {object} c
 * @param {string} c.certificateId     operation id
 * @param {string} c.documentHash      0x-prefixed SHA-256
 * @param {string} c.txHash
 * @param {number|null} c.blockNumber
 * @param {number} c.blockTimestamp    unix seconds
 * @param {string} [c.label]           public on-chain label
 * @param {string} [c.originalFilename] private — owner's certificate only
 * @param {{name: string, isTestnet: boolean}} c.network
 * @param {string} c.contractAddress
 * @param {string} c.verifyUrl         public verify page for this hash
 * @param {string} [c.txUrl]           explorer link for the transaction
 * @param {Date}   [c.issuedAt]
 * @returns {Promise<Buffer>}
 */
export async function renderCertificate(c) {
  const qrPng = await QRCode.toBuffer(c.verifyUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360,
    color: { dark: INK, light: "#ffffff" },
  });
  const issuedAt = c.issuedAt ?? new Date();

  const doc = new PDFDocument({
    ...PAGE,
    info: {
      Title: "Proof of Existence Certificate",
      Subject: `SHA-256 ${c.documentHash}`,
      Author: "Document Notary",
      CreationDate: issuedAt,
    },
  });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // ---- Header -------------------------------------------------------------
  doc.fillColor(BRASS).font("Helvetica-Bold").fontSize(9).text("DOCUMENT NOTARY", left, 48, { characterSpacing: 2 });
  doc.moveDown(0.3);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(24).text("Proof of Existence Certificate");
  doc.moveDown(0.25);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Certificate ID  ", { continued: true });
  doc.font("Courier").fillColor(INK).text(pdfSafe(c.certificateId));
  doc.moveDown(0.6);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.5).strokeColor(BRASS).stroke();
  doc.moveDown(0.8);

  if (c.network.isTestnet) {
    const y = doc.y;
    doc.roundedRect(left, y, width, 34, 4).fill(WARN_BG);
    doc.fillColor(WARN_TEXT).font("Helvetica-Bold").fontSize(10).text("Test network: for demonstration only.", left + 12, y + 7, {
      width: width - 24,
    });
    doc.font("Helvetica").fontSize(8).text("Records on a test network carry no economic security and may not persist.", {
      width: width - 24,
    });
    doc.y = y + 34 + 12;
  }

  // ---- Record fields ------------------------------------------------------
  const field = (label, value, { mono = false, note } = {}) => {
    doc.x = left;
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), { characterSpacing: 0.8 });
    doc.moveDown(0.15);
    const text = pdfSafe(value);
    if (mono) {
      doc.fillColor(INK).font("Courier").fontSize(fitMonoSize(text, width)).text(text, { width, lineBreak: false });
    } else {
      doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(text, { width });
    }
    if (note) doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(7.5).text(note, { width });
    doc.moveDown(0.55);
  };

  field("Document fingerprint (SHA-256)", c.documentHash, { mono: true });
  field("Recorded at (UTC)", isoUtc(c.blockTimestamp), {
    note: `${humanUtc(c.blockTimestamp)}. The block timestamp of the transaction below.`,
  });
  if (c.originalFilename) {
    field("Original filename", c.originalFilename, { note: "Private: shown only on your own certificate, never on-chain." });
  }
  if (c.label) field("Public on-chain label", c.label);
  field("Network", c.network.name);
  field("Contract address", c.contractAddress, { mono: true });
  field("Transaction hash", c.txHash, { mono: true });
  field("Block number", c.blockNumber == null ? "Unavailable" : String(c.blockNumber));

  // ---- Verify online (QR + links) ----------------------------------------
  doc.moveDown(0.2);
  const qrSize = 92;
  const vy = doc.y;
  doc.image(qrPng, left, vy, { width: qrSize, height: qrSize });
  const tx = left + qrSize + 16;
  const tw = width - qrSize - 16;
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text("VERIFY ONLINE", tx, vy + 2, { characterSpacing: 0.8 });
  doc.moveDown(0.3);
  doc.fillColor(INK).font("Helvetica").fontSize(9).text("Scan the code or open the public verify page (no account needed):", tx, doc.y, { width: tw });
  doc.fillColor(BRASS).font("Helvetica").fontSize(8.5).text(pdfSafe(c.verifyUrl), tx, doc.y, { width: tw, link: c.verifyUrl, underline: true });
  if (c.txUrl) {
    doc.moveDown(0.4);
    doc.fillColor(INK).font("Helvetica").fontSize(9).text("Transaction on the block explorer:", tx, doc.y, { width: tw });
    doc.fillColor(BRASS).font("Helvetica").fontSize(8.5).text(pdfSafe(c.txUrl), tx, doc.y, { width: tw, link: c.txUrl, underline: true });
  }
  doc.y = Math.max(doc.y, vy + qrSize) + 16;

  // ---- How to check this yourself ----------------------------------------
  const steps = [
    "Hash your copy of the file with SHA-256 (e.g. shasum -a 256 <file> on macOS/Linux, or certutil -hashfile <file> SHA256 on Windows).",
    "Compare the result with the document fingerprint above. Any change to the file, even one byte, gives a different hash.",
    "Look up the transaction hash on the block explorer, or open the verify page, and check that the record matches this hash and time.",
  ];
  const by = doc.y;
  const boxPad = 12;
  doc.font("Helvetica").fontSize(9);
  const stepHeights = steps.map((s) => doc.heightOfString(s, { width: width - boxPad * 2 - 16 }));
  const boxH = boxPad * 2 + 16 + stepHeights.reduce((a, b) => a + b + 4, 0);
  doc.roundedRect(left, by, width, boxH, 4).lineWidth(1).strokeColor(RULE).stroke();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("How to check this yourself", left + boxPad, by + boxPad);
  let sy = by + boxPad + 16;
  steps.forEach((s, i) => {
    doc.fillColor(BRASS).font("Helvetica-Bold").fontSize(9).text(`${i + 1}.`, left + boxPad, sy);
    doc.fillColor(INK).font("Helvetica").fontSize(9).text(s, left + boxPad + 16, sy, { width: width - boxPad * 2 - 16 });
    sy += stepHeights[i] + 4;
  });

  // ---- Footer (fixed position, stays on page one) ------------------------
  const fy = doc.page.height - 78;
  doc.moveTo(left, fy).lineTo(left + width, fy).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text(
    "This proves the file existed no later than the recorded time. It does not prove authorship and is not a legal notarization.",
    left,
    fy + 8,
    { width }
  );
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(
    `Issued ${isoUtc(Math.floor(issuedAt.getTime() / 1000))} by Document Notary. The on-chain record, not this PDF, is the source of truth.`,
    left,
    doc.y + 3,
    { width }
  );

  doc.end();
  return done;
}
