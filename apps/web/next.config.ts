import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@furrow/cam-core", "@furrow/document", "@furrow/post"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Project saves send the whole document (ADR-0003); imported geometry outgrows the 1 MB
      // default. Vercel rejects request bodies over 4.5 MB, so going higher wouldn't help.
      bodySizeLimit: "4mb",
    },
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
