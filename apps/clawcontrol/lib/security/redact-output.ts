/**
 * Redacts secrets from text output before storage or streaming.
 *
 * Patterns sourced from clawpack-scan.ts SECRET_PATTERNS and
 * live-graph/redaction.ts looksLikeSensitive().
 */

const REDACTION_RULES: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "PRIVATE_KEY",
    pattern:
      /-----BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY-----/g,
  },
  {
    label: "CLERK_KEY",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
  {
    label: "AWS_KEY",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    label: "SLACK_TOKEN",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    label: "GITHUB_PAT",
    pattern: /\bgh[ps]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    label: "OPENAI_KEY",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    label: "BEARER_TOKEN",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
  },
];

export function redactSecrets(text: string): string {
  if (!text) return text;

  let result = text;
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, `[REDACTED:${rule.label}]`);
  }
  return result;
}
