import "server-only";
import { NextResponse } from "next/server";
import type { RateLimitResult } from "./rate-limit";

/** Shared response helpers so every route reports errors the same way. */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, fields?: Record<string, string>) {
  return NextResponse.json({ error: message, fields }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function tooMany(result: RateLimitResult) {
  return NextResponse.json(
    {
      error: "You are doing that too often. Try again shortly.",
      retryAfter: result.retryAfter,
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}

/**
 * Convert a thrown error into a 500 without leaking internals to the client.
 * The full message still goes to the server log.
 */
export function serverError(error: unknown, context: string) {
  console.error(`[${context}]`, error);
  return NextResponse.json(
    { error: "Something went wrong on our end." },
    { status: 500 },
  );
}

/** Parse a JSON body, tolerating an empty or malformed one. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
