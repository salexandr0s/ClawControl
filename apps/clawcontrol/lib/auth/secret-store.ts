import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const MIN_SECRET_LENGTH = 32;
const SECRET_FILE_NAME = "auth-secret";

let cached: string | null = null;

function getDataDir(): string {
  return (
    process.env.CLAWCONTROL_USER_DATA_DIR ||
    join(homedir(), ".openclaw", "clawcontrol")
  );
}

/**
 * Loads or generates a per-install auth secret.
 *
 * Priority chain:
 * 1. Module-cached value (already loaded this process)
 * 2. CLAWCONTROL_OPERATOR_AUTH_SECRET env var
 * 3. OPENCLAW_OPERATOR_AUTH_SECRET env var
 * 4. Read from <DATA_DIR>/auth-secret file
 * 5. Generate random secret, write to file with mode 0o600
 * 6. Throw if write fails — never fall back to a hardcoded default
 */
export function loadOrGenerateAuthSecret(): string {
  if (cached) return cached;

  const fromEnv =
    process.env.CLAWCONTROL_OPERATOR_AUTH_SECRET?.trim() ||
    process.env.OPENCLAW_OPERATOR_AUTH_SECRET?.trim() ||
    null;

  if (fromEnv && fromEnv.length >= MIN_SECRET_LENGTH) {
    cached = fromEnv;
    return cached;
  }

  const dataDir = getDataDir();
  const secretPath = join(dataDir, SECRET_FILE_NAME);

  // Try reading existing file
  try {
    const content = readFileSync(secretPath, "utf8").trim();
    if (content.length >= MIN_SECRET_LENGTH) {
      cached = content;
      return cached;
    }
  } catch {
    // File doesn't exist or unreadable — will generate below
  }

  // Generate a new secret
  const newSecret = randomBytes(32).toString("base64url");

  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(secretPath, newSecret, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    throw new Error(
      `Failed to write auth secret to ${secretPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  cached = newSecret;
  return cached;
}

/**
 * Reset the module cache. Only used in tests.
 */
export function _resetCacheForTesting(): void {
  cached = null;
}
