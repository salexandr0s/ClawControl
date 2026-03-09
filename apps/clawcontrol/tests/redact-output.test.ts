import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/security/redact-output";

describe("redactSecrets", () => {
  it("redacts RSA private key blocks", () => {
    const input =
      "prefix\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\nsuffix";
    const result = redactSecrets(input);
    expect(result).toBe("prefix\n[REDACTED:PRIVATE_KEY]\nsuffix");
    expect(result).not.toContain("MIIEow");
  });

  it("redacts OPENSSH private key blocks", () => {
    const input =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn...\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactSecrets(input)).toBe("[REDACTED:PRIVATE_KEY]");
  });

  it("redacts EC private key blocks", () => {
    const input =
      "-----BEGIN EC PRIVATE KEY-----\nMHQCAQ...\n-----END EC PRIVATE KEY-----";
    expect(redactSecrets(input)).toBe("[REDACTED:PRIVATE_KEY]");
  });

  it("redacts PGP private key blocks", () => {
    const input =
      "-----BEGIN PGP PRIVATE KEY-----\nlQOYBG...\n-----END PGP PRIVATE KEY-----";
    expect(redactSecrets(input)).toBe("[REDACTED:PRIVATE_KEY]");
  });

  it("redacts Clerk secret keys", () => {
    const result = redactSecrets("key=sk_live_FAKEFAKEFAKEFAKEFAKE00");
    expect(result).toBe("key=[REDACTED:CLERK_KEY]");
  });

  it("redacts AWS access key IDs", () => {
    const result = redactSecrets("aws_key=AKIAIOSFODNN7EXAMPLE");
    expect(result).toBe("aws_key=[REDACTED:AWS_KEY]");
  });

  it("redacts Slack tokens", () => {
    const result = redactSecrets("token=xoxb-1234567890-abcdefghij");
    expect(result).toBe("token=[REDACTED:SLACK_TOKEN]");
  });

  it("redacts GitHub PATs (ghp_ and ghs_)", () => {
    const result = redactSecrets("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx");
    expect(result).toBe("GITHUB_TOKEN=[REDACTED:GITHUB_PAT]");

    const result2 = redactSecrets("token=ghs_abcdefghijklmnopqrstuvwx");
    expect(result2).toBe("token=[REDACTED:GITHUB_PAT]");
  });

  it("redacts OpenAI API keys", () => {
    const result = redactSecrets("OPENAI_API_KEY=sk-FAKEFAKEFAKEFAKEFAKE00");
    expect(result).toBe("OPENAI_API_KEY=[REDACTED:OPENAI_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const result = redactSecrets(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
    );
    expect(result).toBe("Authorization: [REDACTED:BEARER_TOKEN]");
  });

  it("redacts multiple secrets in one string", () => {
    const input = "key1=ghp_abcdefghijklmnopqrstuvwx key2=AKIAIOSFODNN7EXAMPLE";
    const result = redactSecrets(input);
    expect(result).toBe("key1=[REDACTED:GITHUB_PAT] key2=[REDACTED:AWS_KEY]");
  });

  it("returns normal text unchanged", () => {
    const input = "This is a normal log line with no secrets.";
    expect(redactSecrets(input)).toBe(input);
  });

  it("returns empty string unchanged", () => {
    expect(redactSecrets("")).toBe("");
  });
});
