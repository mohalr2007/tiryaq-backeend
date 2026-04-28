import { NextResponse } from "next/server";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimTrailingSlash(trimmed);
}

function isAllowedDevelopmentOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
}

function getConfiguredOrigins() {
  return new Set(
    [process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_BASE_URL]
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin)),
  );
}

function resolveAllowedOrigin(request: Request) {
  const requestOrigin = normalizeOrigin(request.headers.get("origin"));
  if (!requestOrigin) {
    return null;
  }

  const configuredOrigins = getConfiguredOrigins();
  if (configuredOrigins.has(requestOrigin)) {
    return requestOrigin;
  }

  if (process.env.NODE_ENV !== "production" && isAllowedDevelopmentOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

export function buildCorsHeaders(request: Request, methods = "GET,POST,OPTIONS") {
  const allowedOrigin = resolveAllowedOrigin(request);
  const headers = new Headers();

  if (!allowedOrigin) {
    return headers;
  }

  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Methods", methods);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");

  return headers;
}

export function withCors(response: NextResponse, request: Request, methods = "GET,POST,OPTIONS") {
  const corsHeaders = buildCorsHeaders(request, methods);
  corsHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
}

export function handleCorsPreflight(request: Request, methods = "GET,POST,OPTIONS") {
  const corsHeaders = buildCorsHeaders(request, methods);
  if (!corsHeaders.has("Access-Control-Allow-Origin")) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
