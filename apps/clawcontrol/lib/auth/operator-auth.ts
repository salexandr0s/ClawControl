import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadOrGenerateAuthSecret } from "./secret-store";
import type { NextRequest, NextResponse } from "next/server";

export const OPERATOR_SESSION_COOKIE = "cc_operator_session";
export const CSRF_COOKIE = "cc_csrf";
export const INTERNAL_TOKEN_HEADER = "x-clawcontrol-internal-token";
export const CSRF_HEADER = "x-clawcontrol-csrf";

const SESSION_VERSION = 1;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface OperatorPrincipal {
  actor: string;
  actorType: "user";
  actorId: string;
  sessionId: string;
}

export interface AuthFailure {
  ok: false;
  status: number;
  code: "AUTH_REQUIRED" | "CSRF_INVALID" | "INTERNAL_TOKEN_REQUIRED";
  error: string;
}

export interface AuthSuccess {
  ok: true;
  principal: OperatorPrincipal;
}

export type AuthResult = AuthSuccess | AuthFailure;

interface SessionPayload {
  v: number;
  sid: string;
  iat: number;
  exp: number;
}

function parseCookieHeader(
  cookieHeader: string | null,
): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function getAuthSecret(): string {
  return loadOrGenerateAuthSecret();
}

function getInternalToken(): string {
  const explicit =
    process.env.CLAWCONTROL_INTERNAL_TOKEN ??
    process.env.OPENCLAW_INTERNAL_TOKEN;
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  // Stable local fallback so internal callers can use one deterministic token
  return hmac("clawcontrol:internal", getAuthSecret());
}

function signSessionPayload(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(encoded, getAuthSecret());
  return `${encoded}.${signature}`;
}

function verifySignedSession(
  rawValue: string | undefined,
): SessionPayload | null {
  if (!rawValue) return null;
  const [encoded, signature] = rawValue.split(".");
  if (!encoded || !signature) return null;

  const expected = hmac(encoded, getAuthSecret());
  if (!timingSafeEqualText(signature, expected)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== SESSION_VERSION) return null;
    if (typeof parsed.sid !== "string" || parsed.sid.length < 8) return null;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number")
      return null;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function issueOperatorSession(response: NextResponse): {
  csrfToken: string;
  expiresAt: string;
} {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;

  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sid: randomBytes(16).toString("hex"),
    iat: now,
    exp,
  };

  const csrfToken = randomBytes(24).toString("hex");

  response.cookies.set(OPERATOR_SESSION_COOKIE, signSessionPayload(payload), {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  response.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return {
    csrfToken,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

function extractCookies(
  request: Request | NextRequest,
): Record<string, string> {
  return parseCookieHeader(request.headers.get("cookie"));
}

export function verifyOperatorRequest(
  request: Request | NextRequest,
  options?: { requireCsrf?: boolean },
): AuthResult {
  const cookies = extractCookies(request);
  const sessionPayload = verifySignedSession(cookies[OPERATOR_SESSION_COOKIE]);
  if (!sessionPayload) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      error: "Operator session is required",
    };
  }

  if (options?.requireCsrf) {
    const headerToken = request.headers.get(CSRF_HEADER)?.trim() ?? "";
    const cookieToken = cookies[CSRF_COOKIE] ?? "";

    if (
      !headerToken ||
      !cookieToken ||
      !timingSafeEqualText(headerToken, cookieToken)
    ) {
      return {
        ok: false,
        status: 403,
        code: "CSRF_INVALID",
        error: "Invalid CSRF token",
      };
    }
  }

  return {
    ok: true,
    principal: {
      actor: "user:operator",
      actorType: "user",
      actorId: "operator",
      sessionId: sessionPayload.sid,
    },
  };
}

export function verifyInternalToken(
  request: Request | NextRequest,
): AuthResult {
  const provided = request.headers.get(INTERNAL_TOKEN_HEADER)?.trim();
  if (!provided) {
    return {
      ok: false,
      status: 403,
      code: "INTERNAL_TOKEN_REQUIRED",
      error: "Internal token is required",
    };
  }

  const expected = getInternalToken();
  if (!timingSafeEqualText(provided, expected)) {
    return {
      ok: false,
      status: 403,
      code: "INTERNAL_TOKEN_REQUIRED",
      error: "Invalid internal token",
    };
  }

  return {
    ok: true,
    principal: {
      actor: "system:internal",
      actorType: "user",
      actorId: "internal",
      sessionId: "internal",
    },
  };
}

export function asAuthErrorResponse(result: AuthFailure): {
  error: string;
  code: string;
} {
  return {
    error: result.error,
    code: result.code,
  };
}
