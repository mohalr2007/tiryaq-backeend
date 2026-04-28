import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(nodeScrypt);
const PASSWORD_PREFIX = "scrypt";

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? "tiryaq-admin-portal-secret-change-me";
}

export async function hashAdminPassword(password: string) {
  const normalized = password.trim();
  if (normalized.length < 8) {
    throw new Error("Le mot de passe admin doit contenir au moins 8 caractères.");
  }

  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(normalized, salt, 64)) as Buffer;
  return `${PASSWORD_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyAdminPassword(password: string, storedHash: string) {
  const [prefix, salt, hash] = storedHash.split("$");
  if (prefix !== PASSWORD_PREFIX || !salt || !hash) {
    return false;
  }

  const derivedKey = (await scrypt(password.trim(), salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(hash, "hex");

  if (storedBuffer.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, derivedKey);
}

export function signAdminSessionPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}
