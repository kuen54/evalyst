import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth gate for /api/* routes.
 *
 * Rationale (PR fix/auth-gate-rce, v0.11):
 *   evalyst's data-mutating routes (POST/PUT/DELETE on /api/datasets,
 *   /api/schemas, /api/llm-config, /api/experiments, …) had no auth
 *   whatsoever. Combined with the now-removed `js` transform op and
 *   the now-masked api_key endpoint, anyone able to reach :3000 could
 *   exfiltrate keys, run arbitrary server-side JS, or trigger writes.
 *
 *   This middleware is a minimal CSRF / cross-origin defense, NOT a
 *   token auth system. It uses the browser-attested `Sec-Fetch-Site`
 *   header — set by the browser itself, not by the page — to allow
 *   first-party requests (same-origin / same-site / "none" = direct
 *   navigation, e.g. typing the URL or running curl/agents) and reject
 *   third-party `cross-site` requests unless explicitly allowlisted via
 *   EVALYST_ALLOW_ORIGIN (comma-separated origin list).
 *
 *   /api/skills/[name] is intentionally public — Claude Code agents on
 *   the user's machine fetch SKILL.md cross-origin from the platform
 *   itself, and that's the documented "agent-driven" entry point.
 */

const SKILLS_PREFIX = '/api/skills/'

export function middleware(req: NextRequest): NextResponse | undefined {
  // Public agent-discovery endpoint — always allowed.
  if (req.nextUrl.pathname.startsWith(SKILLS_PREFIX)) return

  const fetchSite = req.headers.get('sec-fetch-site')

  // Browser-attested first-party request OR non-browser caller (curl,
  // Playwright request, agent script). Anything other than 'cross-site'
  // is allowed because the browser would have set 'cross-site' explicitly
  // if the request came from a different origin.
  if (!fetchSite || fetchSite !== 'cross-site') return

  // Cross-site: check the explicit allowlist.
  const origin = req.headers.get('origin') ?? ''
  const allow = (process.env.EVALYST_ALLOW_ORIGIN ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (allow.includes(origin)) return

  return new NextResponse('forbidden', { status: 403 })
}

export const config = {
  // Run the gate on every API route. Static assets, RSC payloads, and
  // user-facing pages are not in this matcher and are unaffected.
  matcher: ['/api/:path*'],
}
