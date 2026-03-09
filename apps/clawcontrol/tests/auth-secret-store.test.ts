import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

// Stub 'server-only' so import doesn't throw in test environment
vi.mock("server-only", () => ({}));

describe("auth secret store", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.CLAWCONTROL_OPERATOR_AUTH_SECRET;
    delete process.env.OPENCLAW_OPERATOR_AUTH_SECRET;
    delete process.env.CLAWCONTROL_USER_DATA_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function importModule() {
    const mod = await import("@/lib/auth/secret-store");
    mod._resetCacheForTesting();
    return mod;
  }

  it("uses CLAWCONTROL_OPERATOR_AUTH_SECRET env var when set", async () => {
    const secret = "a".repeat(32);
    process.env.CLAWCONTROL_OPERATOR_AUTH_SECRET = secret;

    const { loadOrGenerateAuthSecret } = await importModule();
    expect(loadOrGenerateAuthSecret()).toBe(secret);
  });

  it("uses OPENCLAW_OPERATOR_AUTH_SECRET as second priority", async () => {
    const secret = "b".repeat(32);
    process.env.OPENCLAW_OPERATOR_AUTH_SECRET = secret;

    const { loadOrGenerateAuthSecret } = await importModule();
    expect(loadOrGenerateAuthSecret()).toBe(secret);
  });

  it("prefers CLAWCONTROL over OPENCLAW env var", async () => {
    const clawSecret = "c".repeat(32);
    const openSecret = "d".repeat(32);
    process.env.CLAWCONTROL_OPERATOR_AUTH_SECRET = clawSecret;
    process.env.OPENCLAW_OPERATOR_AUTH_SECRET = openSecret;

    const { loadOrGenerateAuthSecret } = await importModule();
    expect(loadOrGenerateAuthSecret()).toBe(clawSecret);
  });

  it("generates a secret file when no env var and no file exists", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/cc-auth-test-");
    process.env.CLAWCONTROL_USER_DATA_DIR = tmpDir;

    const { loadOrGenerateAuthSecret } = await importModule();
    const secret = loadOrGenerateAuthSecret();

    expect(secret.length).toBeGreaterThanOrEqual(32);

    const filePath = `${tmpDir}/auth-secret`;
    expect(fs.existsSync(filePath)).toBe(true);

    const stat = fs.statSync(filePath);
    expect(stat.mode & 0o777).toBe(0o600);

    const fileContent = fs.readFileSync(filePath, "utf8").trim();
    expect(fileContent).toBe(secret);

    // Cleanup
    fs.unlinkSync(filePath);
    fs.rmdirSync(tmpDir);
  });

  it("reads secret from existing file on subsequent calls", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/cc-auth-test-");
    const existingSecret = "e".repeat(44);
    fs.writeFileSync(`${tmpDir}/auth-secret`, existingSecret, { mode: 0o600 });
    process.env.CLAWCONTROL_USER_DATA_DIR = tmpDir;

    const { loadOrGenerateAuthSecret } = await importModule();
    expect(loadOrGenerateAuthSecret()).toBe(existingSecret);

    // Cleanup
    fs.unlinkSync(`${tmpDir}/auth-secret`);
    fs.rmdirSync(tmpDir);
  });

  it("caches the secret across calls within the same module load", async () => {
    const secret = "f".repeat(32);
    process.env.CLAWCONTROL_OPERATOR_AUTH_SECRET = secret;

    const { loadOrGenerateAuthSecret } = await importModule();
    const first = loadOrGenerateAuthSecret();
    const second = loadOrGenerateAuthSecret();
    expect(first).toBe(second);
  });

  it("throws when the data directory is not writable", async () => {
    // Point to a path that cannot exist (nested under a file, not a dir)
    process.env.CLAWCONTROL_USER_DATA_DIR = "/dev/null/impossible-path";

    const { loadOrGenerateAuthSecret } = await importModule();
    expect(() => loadOrGenerateAuthSecret()).toThrow(
      /Failed to write auth secret/,
    );
  });
});
