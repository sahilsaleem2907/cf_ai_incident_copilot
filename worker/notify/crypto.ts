/**
 * Webhook URLs at rest (FR-53, TDD §11): AES-GCM-256 with the `WEBHOOK_KEY` secret (base64, 32 bytes), a 12-byte
 * random IV and the workspace ID as additional data, so a row copied to another workspace won't decrypt.
 */
export type Sealed = { ciphertext: Uint8Array; iv: Uint8Array };

/**
 * The key, or null when the secret isn't set: webhooks are then switched off. The secret isn't declared in
 * wrangler.jsonc, so a deploy without it still works (set with `wrangler secret put WEBHOOK_KEY`).
 */
export async function webhookKey(env: object): Promise<CryptoKey | null> {
  const raw = (env as { WEBHOOK_KEY?: unknown }).WEBHOOK_KEY;
  if (typeof raw !== "string" || !raw) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw.trim()), (c) => c.charCodeAt(0));
  } catch {
    console.error("WEBHOOK_KEY isn't valid base64; webhooks are off");
    return null;
  }
  if (bytes.length !== 32) {
    console.error("WEBHOOK_KEY must be 32 bytes; webhooks are off");
    return null;
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const enc = new TextEncoder();

export async function encryptUrl(key: CryptoKey, url: string, workspaceId: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(workspaceId) }, key, enc.encode(url));
  return { ciphertext: new Uint8Array(ciphertext), iv };
}

/** Throws if the key, IV, workspace or ciphertext don't match. */
export async function decryptUrl(key: CryptoKey, sealed: Sealed, workspaceId: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv, additionalData: enc.encode(workspaceId) }, key, sealed.ciphertext);
  return new TextDecoder().decode(plain);
}
