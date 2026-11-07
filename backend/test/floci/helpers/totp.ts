import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function decodeBase32(secret: string): Buffer {
  let bits = "";
  for (const character of secret.replace(/=+$/, "")) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

/** RFC 6238 time-based one-time password, what an authenticator app computes from the shared secret. */
export function totpCode(base32Secret: string, now: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / STEP_SECONDS)));
  const digest = createHmac("sha1", decodeBase32(base32Secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Decodes the payload of a JWT without verifying it (the emulator signs tokens; this only reads claims). */
export function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}
