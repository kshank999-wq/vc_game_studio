const PREVIEW_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The online preview is the studio's own build, copied into public/preview
  // by scripts/build-preview.mjs (built with its base at /preview/); /preview
  // is its page.
  async rewrites() {
    return [{ source: '/preview', destination: '/preview/index.html' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        // The studio bundle: its own scripts and styles, the Google fonts its
        // index.html loads, and nothing to talk to (the preview saves nothing).
        source: '/preview/:path*',
        headers: [{ key: 'Content-Security-Policy', value: PREVIEW_POLICY }],
      },
      { source: '/preview', headers: [{ key: 'Content-Security-Policy', value: PREVIEW_POLICY }, { key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
