import { createHash } from "crypto";

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ":" + canonicalJson(val);
  });

  return "{" + pairs.join(",") + "}";
}

export function hashPayload(payload: unknown): string {
  const canonical = canonicalJson(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
