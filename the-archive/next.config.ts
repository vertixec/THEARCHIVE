import type { NextConfig } from "next";

const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.fal.ai https://fal.ai https://*.fal.ai https://*.fal.run https://*.fal.media https://api-m.paypal.com https://api-m.sandbox.paypal.com",
  "frame-src https://www.paypal.com https://www.sandbox.paypal.com",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [35, 90],
    minimumCacheTTL: 86400,
    deviceSizes: [640, 750, 828, 1080, 1200, 1440, 1920],
    imageSizes: [96, 160, 240, 320, 480, 640],
    remotePatterns: [
      { protocol: 'https', hostname: 'tskmcvnbtexfqojoixuv.supabase.co' },
      { protocol: 'https', hostname: 'cdn.midjourney.com' },
      { protocol: 'https', hostname: 'images.higgs.ai' },
      { protocol: 'https', hostname: 'higgsfield.ai' },
      { protocol: 'https', hostname: 'assets.skool.com' },
      { protocol: 'https', hostname: 'pbs.twimg.com' },
      { protocol: 'https', hostname: 'media.newyorker.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'https', hostname: '**.fal.media' },
      // KIE AI media + uploaded references. Results are copied into Supabase,
      // so these only serve the fallback path when that copy fails and the
      // reference thumbnails the panel shows before a generation runs.
      { protocol: 'https', hostname: '**.redpandaai.co' },
      { protocol: 'https', hostname: '**.aiquickdraw.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicyReportOnly },
        ],
      },
    ];
  },
};

export default nextConfig;
