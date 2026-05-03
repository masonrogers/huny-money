import { importPKCS8, SignJWT } from 'jose';
import crypto from 'crypto';
import { config } from '@/lib/config';
import {
  type CoinbaseRequestOptions,
  type CoinbaseError,
  CoinbaseApiError,
  CoinbaseRateLimitError,
} from './types';

// ─── Constants ─────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.coinbase.com';
const JWT_ISSUER = 'coinbase-cloud';
const JWT_AUDIENCE = 'retail_rest_api_proxy';
const JWT_LIFETIME_SECONDS = 120;

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ─── JWT Generation ────────────────────────────────────────────────────────

/**
 * Builds a signed JWT for Coinbase Advanced Trade API authentication.
 *
 * Coinbase CDP API keys use ES256 JWTs:
 * - Header: { kid: apiKeyName, typ: "JWT", alg: "ES256", nonce: randomHex }
 * - Payload: { sub: apiKeyName, iss: "coinbase-cloud", nbf: now, exp: now+120,
 *              aud: ["retail_rest_api_proxy"] }
 */
async function buildJwt(method: string, requestPath: string): Promise<string> {
  const apiKeyName = config.COINBASE_API_KEY;
  const apiSecret = config.COINBASE_API_SECRET;

  // The secret comes as an EC private key in PEM format.
  // Some secrets from Coinbase have escaped newlines; normalize them.
  const pemKey = apiSecret.replace(/\\n/g, '\n');

  // Coinbase CDP keys are EC PEM (`BEGIN EC PRIVATE KEY`), but jose's
  // importPKCS8 requires PKCS#8 (`BEGIN PRIVATE KEY`). Convert first.
  const keyObject = crypto.createPrivateKey(pemKey);
  const pkcs8Pem = keyObject.export({ type: 'pkcs8', format: 'pem' }) as string;
  const privateKey = await importPKCS8(pkcs8Pem, 'ES256');

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  // The URI claim is "METHOD host+path" (e.g., "GET api.coinbase.com/api/v3/brokerage/accounts")
  const uri = `${method} api.coinbase.com${requestPath}`;

  const jwt = await new SignJWT({
    sub: apiKeyName,
    iss: JWT_ISSUER,
    aud: [JWT_AUDIENCE],
    nbf: now,
    exp: now + JWT_LIFETIME_SECONDS,
    uri,
  })
    .setProtectedHeader({
      alg: 'ES256',
      kid: apiKeyName,
      typ: 'JWT',
      nonce,
    })
    .sign(privateKey);

  return jwt;
}

// ─── HTTP Client ───────────────────────────────────────────────────────────

/**
 * Core request method for the Coinbase Advanced Trade API.
 *
 * Features:
 * - Automatic JWT auth per request
 * - Rate-limit retry with exponential backoff on 429
 * - Typed error handling
 * - Debug logging
 */
export async function coinbaseRequest<T>(options: CoinbaseRequestOptions): Promise<T> {
  const { method, path, body, params } = options;

  // Build query string from params
  let queryString = '';
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          searchParams.append(key, String(v));
        }
      } else {
        searchParams.append(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) {
      queryString = `?${qs}`;
    }
  }

  const url = `${BASE_URL}${path}${queryString}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Build a fresh JWT for each attempt (they expire quickly)
      const jwt = await buildJwt(method, path);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body);
      }

      console.log(`[Coinbase] ${method} ${path} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);

      const response = await fetch(url, fetchOptions);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const backoffMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_BACKOFF_MS * Math.pow(2, attempt);

        console.warn(
          `[Coinbase] Rate limited on ${method} ${path}. ` +
            `Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`
        );

        if (attempt < MAX_RETRIES) {
          await sleep(backoffMs);
          continue;
        }

        throw new CoinbaseRateLimitError(
          `Rate limited after ${MAX_RETRIES + 1} attempts on ${method} ${path}`,
          backoffMs,
        );
      }

      // Parse response body
      const responseText = await response.text();
      let responseBody: T;

      try {
        responseBody = JSON.parse(responseText) as T;
      } catch {
        throw new CoinbaseApiError(
          `Failed to parse response from ${method} ${path}: ${responseText.slice(0, 500)}`,
          response.status,
        );
      }

      // Handle error responses
      if (!response.ok) {
        const errorBody = responseBody as unknown as CoinbaseError;
        const errorMessage =
          errorBody?.message || errorBody?.error || `HTTP ${response.status}`;

        console.error(
          `[Coinbase] Error on ${method} ${path}: ${response.status} ${errorMessage}`
        );

        // Retry on server errors (5xx)
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(`[Coinbase] Server error, retrying in ${backoffMs}ms`);
          await sleep(backoffMs);
          continue;
        }

        throw new CoinbaseApiError(
          `Coinbase API error on ${method} ${path}: ${errorMessage}`,
          response.status,
          errorBody,
        );
      }

      console.log(`[Coinbase] ${method} ${path} succeeded`);
      return responseBody;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on client errors (4xx) other than 429
      if (error instanceof CoinbaseApiError && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }

      // Retry on network errors
      if (attempt < MAX_RETRIES && !(error instanceof CoinbaseApiError)) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[Coinbase] Network error on ${method} ${path}: ${lastError.message}. ` +
            `Retrying in ${backoffMs}ms`
        );
        await sleep(backoffMs);
        continue;
      }
    }
  }

  throw lastError ?? new Error(`Coinbase request failed after ${MAX_RETRIES + 1} attempts`);
}

// ─── Utility ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
