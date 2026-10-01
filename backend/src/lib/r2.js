import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Content-addressed storage key. No filename-derived parts, so keys leak nothing but the hash. */
export function keyForHash(hashHex) {
  return `documents/${hashHex}`;
}

/** RFC 6266 attachment header that is safe for any filename. */
export function contentDisposition(filename) {
  const fallback = (filename || "document").replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename || "document")}`;
}

/**
 * Private R2 storage. The bucket must NOT be public: originals are only reachable through
 * short-lived signed URLs issued after an ownership check.
 */
export function createStorage(config) {
  const client = new S3Client({
    region: "auto",
    endpoint: config.r2.endpoint,
    credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
  });
  const Bucket = config.r2.bucket;

  return {
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404) return false;
        throw err;
      }
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType || "application/octet-stream" })
      );
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    async signedDownloadUrl(key, { expiresIn, filename }) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(filename),
      });
      return getSignedUrl(client, command, { expiresIn });
    },
  };
}
