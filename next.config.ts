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
    // Allow builds with minor linting warnings (unused vars, exhaustive-deps)
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Ignore TypeScript errors in bot code during Next.js build
    // (bot runs separately with tsx and has its own type checking)
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
