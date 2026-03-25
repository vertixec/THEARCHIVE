import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  // Protect routes: Redirect to /login if not authenticated
  const isAuthPage = request.nextUrl.pathname.startsWith('/login')
  const isAuthCallback = request.nextUrl.pathname.startsWith('/auth')
  const isInactivePage = request.nextUrl.pathname === '/inactive-membership'
  const isPublicAsset = request.nextUrl.pathname.startsWith('/_next') ||
                        request.nextUrl.pathname.includes('.') ||
                        request.nextUrl.pathname === '/favicon.ico'

  if (!user && !isAuthPage && !isAuthCallback && !isPublicAsset) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect to / if authenticated and trying to access /login
  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Check membership status and role for authenticated users on protected routes
  if (user && !isAuthPage && !isAuthCallback && !isInactivePage && !isPublicAsset) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role')
      .eq('id', user.id)
      .single()

    const isActiveMember = profile?.status === 'active' && ['member', 'admin'].includes(profile?.role)
    if (!isActiveMember) {
      const url = request.nextUrl.clone()
      url.pathname = '/inactive-membership'
      return NextResponse.redirect(url)
    }
  }

  // Redirect active members away from the inactive page
  if (user && isInactivePage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role')
      .eq('id', user.id)
      .single()

    const isActiveMember = profile?.status === 'active' && ['member', 'admin'].includes(profile?.role)
    if (isActiveMember) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return response
}
