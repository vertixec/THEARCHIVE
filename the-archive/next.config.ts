import type { NextConfig } from "next";

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
        ],
      },
    ];
  },
};

export default nextConfig;
