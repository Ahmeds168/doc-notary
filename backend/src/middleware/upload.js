import multer from "multer";
import { config } from "../config.js";

// Memory storage: we need the raw buffer to hash it before deciding where (if) to persist it.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSizeBytes },
});
