import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

/**
 * Upload a file buffer to R2 under a key derived from the document hash,
 * so storage is content-addressed (same file -> same key -> no duplicates).
 */
export async function uploadToR2({ key, body, contentType }) {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return config.r2.publicBaseUrl
    ? `${config.r2.publicBaseUrl.replace(/\/$/, "")}/${key}`
    : null;
}

/** Check whether an object already exists in R2 (used to dedupe content-addressed uploads). */
export async function objectExists(key) {
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: config.r2.bucket, Key: key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Generate a short-lived signed URL for downloading a private object. */
export async function getSignedDownloadUrl(key, expiresInSeconds = 900) {
  const command = new GetObjectCommand({ Bucket: config.r2.bucket, Key: key });
  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}

/** Build the storage key for a document from its hex hash (content-addressed). */
export function keyForHash(hashHex, originalFilename) {
  const ext = originalFilename?.includes(".") ? originalFilename.split(".").pop() : "";
  return ext ? `documents/${hashHex}.${ext}` : `documents/${hashHex}`;
}
