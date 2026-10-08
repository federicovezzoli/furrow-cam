import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@furrow/cam-core", "@furrow/document", "@furrow/post"],
  cacheComponents: true,
  partialPrefetching: true,
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
