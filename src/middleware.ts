import { NextResponse, type NextRequest } from 'next/server'

/**
 * CSRF gate (NOT auth) for /api/* routes.
 *
 * Threat model: evalyst runs as a localhost dev tool with no auth on
 * data-mutating routes (POST/PUT/DELETE on /api/datasets, /api/schemas,
 * /api/llm-config, /api/experiments, …). This middleware closes ONE
 * specific attack surface: a logged-in browser session being driven by
 * a malicious cross-origin page (classic CSRF).
 *
 * It uses the browser-attested `Sec-Fetch-Site` header — set by the
 * browser itself, not by the page — to allow first-party requests
 * (`same-origin` / `same-site` / `none` = direct browser navigation,
 * e.g. typing the URL into the address bar) and reject third-party
 * `cross-site` requests unless explicitly allowlisted via
 * EVALYST_ALLOW_ORIGIN (comma-separated origin list). Non-browser
 * callers (curl, Playwright `request` fixture, agent scripts) send
 * no `Sec-Fetch-Site` header at all — the gate also lets these through
 * because the threat model is browser-attested CSRF only.
 *
 * What this is NOT: a token auth system. A LAN attacker running
 * `curl http://victim:3000/api/llm-config` sends no `Sec-Fetch-Site`
 * header and IS allowed through. evalyst is intended for localhost /
 * loopback deployment only — see README §部署须知 for tunnel / VPN /
 * reverse-proxy patterns if remote access is required.
 *
 * /api/skills/[name] is intentionally public — Claude Code agents on
 * the user's machine fetch SKILL.md cross-origin from the platform
 * itself, and that's the documented "agent-driven" entry point.
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
