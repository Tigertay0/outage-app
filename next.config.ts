import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * The app renders no raw HTML — there is no `dangerouslySetInnerHTML` anywhere,
 * and React escapes every string that comes from a feed or a reporter — so
 * these are defence in depth rather than a fix for a known hole. They cost
 * nothing and close the classes of attack that do not need a script injection:
 * framing the map inside another site, and MIME sniffing a response into
 * something executable.
 */
const securityHeaders = [
  // No one embeds this map in their own page. frame-ancestors in the CSP below
  // is the modern form; this is kept for older browsers that ignore it.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A referrer is useful to the tile host for attribution, but the path can
  // carry a deep-linked outage id, so only the origin travels cross-site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation is requested for "outages near me", from this origin only.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), geolocation=(self)",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js hydration and MapLibre's worker need these. 'unsafe-inline'
      // stays until inline scripts carry a per-request nonce; without it the
      // app does not boot, and a stricter policy nobody can ship is worth less
      // than a real one that holds the rest of the line.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "worker-src 'self' blob:",
      // Tailwind and the map's own styles are injected at runtime.
      "style-src 'self' 'unsafe-inline'",
      // Basemap tiles and sprites are raster/vector data from the tile host.
      "img-src 'self' data: blob: https://tiles.openfreemap.org",
      "font-src 'self' data:",
      // Supabase (REST, auth, realtime), the tile host, and nothing else.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://tiles.openfreemap.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
