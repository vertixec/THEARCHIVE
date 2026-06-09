import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  canAccessFeature,
  isActivePlatformUser,
  resolveAccessTier,
  type BusinessProfile,
  type Feature,
} from '@/lib/business'

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/pricing',
  '/terms',
  '/privacy',
  '/ai-policy',
  '/inactive-membership',
  '/upgrade',
];

// NOTE: /community and /workflows are intentionally NOT hard-gated here.
// They render an in-page LOCKED TEASER for non-members (blurred previews +
// CTA to join the Skool community) instead of a jarring redirect — the teaser
// drives conversion. Access to the real content is still enforced server-side
// inside those pages via canAccessFeature(). /systems keeps the hard redirect.
const PREMIUM_ROUTE_FEATURES: Array<{ prefix: string; feature: Feature }> = [
  { prefix: '/systems', feature: 'view_systems' },
];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/auth')) return true;
  if (pathname.startsWith('/u/')) return true;
  return false;
}

function getRequiredFeature(pathname: string) {
  return PREMIUM_ROUTE_FEATURES.find((route) => pathname.startsWith(route.prefix))?.feature ?? null;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Keep this immediately after client creation so refreshed auth cookies are
  // available to both this request and the browser response.
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub

  const pathname = request.nextUrl.pathname
  const isAuthPage = pathname.startsWith('/login')
  const isInactivePage = pathname === '/inactive-membership' || pathname === '/upgrade'
  const isPublicAsset = request.nextUrl.pathname.startsWith('/_next') ||
                        request.nextUrl.pathname.includes('.') ||
                        request.nextUrl.pathname === '/favicon.ico'

  if (!userId && !isPublicPath(pathname) && !isPublicAsset) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const redirectResponse = NextResponse.redirect(url)
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  if (userId && !isAuthPage && !isInactivePage && !isPublicAsset) {
    let profile: BusinessProfile | null = null

    const expandedProfile = await supabase
      .from('profiles')
      .select('id, status, role, access_tier, plan_id')
      .eq('id', userId)
      .maybeSingle<BusinessProfile>()

    if (expandedProfile.error) {
      const fallbackProfile = await supabase
        .from('profiles')
        .select('id, status, role')
        .eq('id', userId)
        .maybeSingle<BusinessProfile>()

      if (fallbackProfile.error) return response
      profile = fallbackProfile.data
    } else {
      profile = expandedProfile.data
    }

    if (!isActivePlatformUser(profile)) {
      const url = request.nextUrl.clone()
      url.pathname = '/inactive-membership'
      const redirectResponse = NextResponse.redirect(url)
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }

    const requiredFeature = getRequiredFeature(pathname)
    if (requiredFeature && !canAccessFeature(profile, requiredFeature)) {
      const url = request.nextUrl.clone()
      url.pathname = '/upgrade'
      url.searchParams.set('from', pathname)
      url.searchParams.set('tier', resolveAccessTier(profile))
      const redirectResponse = NextResponse.redirect(url)
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }
  }

  // Auto-escape ONLY applies to the inactive-membership page: a member who
  // reactivates shouldn't stay stuck there. It must NOT fire on /upgrade —
  // a gated (but active) user redirected to /upgrade needs to actually SEE it,
  // not get bounced to the homepage.
  if (userId && pathname === '/inactive-membership') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, status, role')
      .eq('id', userId)
      .maybeSingle<BusinessProfile>()

    if (profile?.status === 'active' && ['member', 'admin'].includes(profile?.role ?? '')) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      const redirectResponse = NextResponse.redirect(url)
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }
  }

  return response
}
