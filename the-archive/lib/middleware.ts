import { createServerClient, type CookieOptions } from '@supabase/ssr'
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

const PREMIUM_ROUTE_FEATURES: Array<{ prefix: string; feature: Feature }> = [
  { prefix: '/systems', feature: 'view_systems' },
  { prefix: '/workflows', feature: 'view_workflows' },
  { prefix: '/community', feature: 'view_community' },
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
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAuthPage = pathname.startsWith('/login')
  const isInactivePage = pathname === '/inactive-membership' || pathname === '/upgrade'
  const isPublicAsset = request.nextUrl.pathname.startsWith('/_next') ||
                        request.nextUrl.pathname.includes('.') ||
                        request.nextUrl.pathname === '/favicon.ico'

  if (!user && !isPublicPath(pathname) && !isPublicAsset) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && !isAuthPage && !isInactivePage && !isPublicAsset) {
    let profile: BusinessProfile | null = null

    const expandedProfile = await supabase
      .from('profiles')
      .select('id, status, role, access_tier, plan_id')
      .eq('id', user.id)
      .maybeSingle<BusinessProfile>()

    if (expandedProfile.error) {
      const fallbackProfile = await supabase
        .from('profiles')
        .select('id, status, role')
        .eq('id', user.id)
        .maybeSingle<BusinessProfile>()

      if (fallbackProfile.error) return response
      profile = fallbackProfile.data
    } else {
      profile = expandedProfile.data
    }

    if (!isActivePlatformUser(profile)) {
      const url = request.nextUrl.clone()
      url.pathname = '/inactive-membership'
      return NextResponse.redirect(url)
    }

    const requiredFeature = getRequiredFeature(pathname)
    if (requiredFeature && !canAccessFeature(profile, requiredFeature)) {
      const url = request.nextUrl.clone()
      url.pathname = '/upgrade'
      url.searchParams.set('from', pathname)
      url.searchParams.set('tier', resolveAccessTier(profile))
      return NextResponse.redirect(url)
    }
  }

  if (user && isInactivePage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, status, role')
      .eq('id', user.id)
      .maybeSingle<BusinessProfile>()

    if (profile?.status === 'active' && ['member', 'admin'].includes(profile?.role ?? '')) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return response
}
