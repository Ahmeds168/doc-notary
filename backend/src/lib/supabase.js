import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

// Service-role client — backend-only, never expose this key to the frontend.
export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

const TABLE = "documents";

/** Insert a new notarization record after a successful on-chain tx. */
export async function insertDocumentRecord({
  documentHash,
  label,
  submitterAddress,
  txHash,
  blockTimestamp,
  storageKey,
  fileSizeBytes,
  contentType,
}) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      document_hash: documentHash,
      label,
      submitter_address: submitterAddress,
      tx_hash: txHash,
      block_timestamp: blockTimestamp,
      storage_key: storageKey,
      file_size_bytes: fileSizeBytes,
      content_type: contentType,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Look up a document record by its hash. */
export async function getDocumentByHash(documentHash) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("document_hash", documentHash)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** List documents, optionally filtered by submitter, newest first. */
export async function listDocuments({ submitterAddress, limit = 50, offset = 0 } = {}) {
  let query = supabase
    .from(TABLE)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (submitterAddress) {
    query = query.eq("submitter_address", submitterAddress.toLowerCase());
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count };
}
