import { importPKCS8, SignJWT } from "jose";
import crypto from "crypto";
import { config } from "@/lib/config";
import { log } from "@/lib/logger";
import {
  type CoinbaseRequestOptions,
  type CoinbaseError,
  CoinbaseApiError,
  CoinbaseRateLimitError,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.coinbase.com";
const JWT_ISSUER = "coinbase-cloud";
const JWT_AUDIENCE = "retail_rest_api_proxy";
const JWT_LIFETIME_SECONDS = 120;

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ---------------------------------------------------------------------------
// JWT generation
// ---------------------------------------------------------------------------

/**
 * Builds a signed JWT for Coinbase Advanced Trade API authentication.
 *
 * Coinbase CDP API keys use ES256 JWTs. The private key arrives as an EC PEM
 * (`BEGIN EC PRIVATE KEY`) but `jose.importPKCS8` requires PKCS#8
 * (`BEGIN PRIVATE KEY`). We convert via Node's crypto module before signing.
 *
 * Each request signs a fresh JWT (they expire after 120 seconds).
 */
async function buildJwt(method: string, requestPath: string): Promise<string> {
  const apiKeyName = config.COINBASE_API_KEY;
  const apiSecret = config.COINBASE_API_SECRET;

  // Some env-loaded secrets have escaped newlines; normalize.
  const pemKey = apiSecret.replace(/\\n/g, "\n");

  const keyObject = crypto.createPrivateKey(pemKey);
  const pkcs8Pem = keyObject.export({ type: "pkcs8", format: "pem" }) as string;
  const privateKey = await importPKCS8(pkcs8Pem, "ES256");

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");

  // The URI claim is "METHOD host+path" without query string.
  const uri = `${method} api.coinbase.com${requestPath}`;

  return new SignJWT({
    sub: apiKeyName,
    iss: JWT_ISSUER,
    aud: [JWT_AUDIENCE],
    nbf: now,
    exp: now + JWT_LIFETIME_SECONDS,
    uri,
  })
    .setProtectedHeader({
      alg: "ES256",
      kid: apiKeyName,
      typ: "JWT",
      nonce,
    })
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// HTTP request wrapper
// ---------------------------------------------------------------------------

/**
 * Core request method for Coinbase Advanced Trade.
 *
 * - Builds a fresh JWT per request (and per retry — they expire fast)
 * - Exponential backoff on 429 (with Retry-After if provided)
 * - Exponential backoff on 5xx; no retry on 4xx other than 429
 * - Typed error throws (CoinbaseApiError, CoinbaseRateLimitError)
 */
export async function coinbaseRequest<T>(options: CoinbaseRequestOptions): Promise<T> {
  const { method, path, body, params } = options;

  let queryString = "";
  if (params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const x of v) sp.append(k, String(x));
      } else {
        sp.append(k, String(v));
      }
    }
    const qs = sp.toString();
    if (qs) queryString = `?${qs}`;
  }

  const url = `${BASE_URL}${path}${queryString}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const jwt = await buildJwt(method, path);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const init: RequestInit = { method, headers };
      if (body && (method === "POST" || method === "PUT")) {
        init.body = JSON.stringify(body);
      }

      const response = await fetch(url, init);

      // Rate limit
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const backoff = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_BACKOFF_MS * Math.pow(2, attempt);

        log.warn(`Coinbase rate-limited`, {
          method,
          path,
          attempt: attempt + 1,
          backoffMs: backoff,
        });

        if (attempt < MAX_RETRIES) {
          await sleep(backoff);
          continue;
        }
        throw new CoinbaseRateLimitError(
          `Rate limited after ${MAX_RETRIES + 1} attempts on ${method} ${path}`,
          backoff,
        );
      }

      const responseText = await response.text();
      let parsed: T;
      try {
        parsed = JSON.parse(responseText) as T;
      } catch {
        throw new CoinbaseApiError(
          `Failed to parse response from ${method} ${path}: ${responseText.slice(0, 500)}`,
          response.status,
        );
      }

      if (!response.ok) {
        const errBody = parsed as unknown as CoinbaseError;
        const errMessage = errBody?.message || errBody?.error || `HTTP ${response.status}`;

        // Retry on server errors
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          log.warn(`Coinbase 5xx, retrying`, {
            method,
            path,
            status: response.status,
            backoffMs: backoff,
          });
          await sleep(backoff);
          continue;
        }

        throw new CoinbaseApiError(
          `Coinbase ${method} ${path}: ${errMessage}`,
          response.status,
          errBody,
        );
      }

      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // 4xx (other than 429) — no retry
      if (err instanceof CoinbaseApiError && err.statusCode >= 400 && err.statusCode < 500) {
        throw err;
      }

      // Network errors — retry with backoff
      if (attempt < MAX_RETRIES && !(err instanceof CoinbaseApiError)) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        log.warn(`Coinbase network error, retrying`, {
          method,
          path,
          message: lastError.message,
          backoffMs: backoff,
        });
        await sleep(backoff);
        continue;
      }
    }
  }

  throw lastError ?? new Error(`Coinbase request failed after ${MAX_RETRIES + 1} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
