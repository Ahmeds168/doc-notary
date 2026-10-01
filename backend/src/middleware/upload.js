import multer from "multer";
import { HttpError } from "../lib/errors.js";
import { fileTooLarge } from "../services/notarization.js";

/**
 * Per-request multer instance sized to the caller's plan (req.entitlements must already be
 * set). Memory storage: the buffer is hashed before deciding where (if) to persist it.
 */
export function planSizedUpload(fieldName = "file") {
  return (req, res, next) => {
    const ent = req.entitlements;
    const handler = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: ent.maxFileSizeBytes, files: 1, fields: 5, fieldSize: 1024 },
    }).single(fieldName);

    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return next(fileTooLarge(ent));
      if (err instanceof multer.MulterError) return next(new HttpError(400, "INVALID_UPLOAD", "Invalid upload."));
      next(err);
    });
  };
}
