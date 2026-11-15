import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@furrow/cam-core",
    "@furrow/document",
    "@furrow/post",
    "@furrow/ui",
    "@furrow/workspace",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Project saves send the whole document (ADR-0003); imported geometry outgrows the 1 MB
      // default. Vercel rejects request bodies over 4.5 MB, so going higher wouldn't help.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No site may frame the app (clickjacking on signed-in actions).
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Clipboard stays allowed: the bug report copies to it.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
