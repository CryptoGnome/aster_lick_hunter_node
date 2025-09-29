import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set the workspace root to fix lockfile warning
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
