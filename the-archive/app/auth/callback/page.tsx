'use client';

import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AuthCallback() {
  const router = useRouter()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const handleCallback = async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(
        window.location.search
      )
      if (!error) {
        router.push('/')
      } else {
        router.push('/login?error=auth_callback_failed')
      }
    }

    handleCallback()
  }, [router, supabase])

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center">
      <div className="font-anton text-4xl text-white animate-pulse uppercase tracking-tighter">
        Verifying Session...
      </div>
      <div className="w-48 h-1 bg-gray-800 mt-4 overflow-hidden">
        <div className="h-full bg-acid animate-loading-bar"></div>
      </div>
    </div>
  )
}
