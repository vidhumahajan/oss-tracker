// Encrypts GitHub tokens before they are saved in the database.
// If the database ever leaks, the tokens in it are useless without the key,
// and the key lives only in the server's environment variables.
import crypto from "node:crypto";
import { config } from "../config.js";

const key = Buffer.from(config.tokenEncryptionKey, "hex");

// AES-256-GCM. Output looks like "iv.tag.ciphertext", each part base64.
export function encrypt(text) {
  const iv = crypto.randomBytes(12); // a fresh random value for every encryption
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // lets decrypt detect tampering
  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
}

export function decrypt(stored) {
  const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
