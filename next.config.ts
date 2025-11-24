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
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has TypeScript errors.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
