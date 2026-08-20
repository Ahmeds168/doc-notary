import "dotenv/config";

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    console.warn(`[config] Warning: env var ${name} is not set.`);
  }
  return value;
}

export const config = {
  port: process.env.PORT || 4000,

  // Cloudflare R2 (S3-compatible)
  r2: {
    accountId: required("R2_ACCOUNT_ID"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET_NAME"),
    endpoint: process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL, // optional custom domain / r2.dev URL
  },

  // Supabase
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },

  // Blockchain (Sepolia)
  chain: {
    rpcUrl: required("SEPOLIA_RPC_URL"),
    privateKey: required("PRIVATE_KEY"), // backend's relayer wallet, pays gas on behalf of users
    contractAddress: required("CONTRACT_ADDRESS"),
  },

  // Uploads
  upload: {
    maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES || 25 * 1024 * 1024), // 25MB default
  },

  corsOrigin: process.env.CORS_ORIGIN || "*",
};
