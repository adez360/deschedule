import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://localhost:8000";
    // afterFiles: Next.js route handlers (incl. /api/auth/[...nextauth]) are
    // checked first. Only unmatched requests fall through to these rewrites.
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backend}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
