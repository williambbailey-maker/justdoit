import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Surfaced in Settings so the running build is identifiable at a glance.
  env: {
    NEXT_PUBLIC_BUILD:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.NEXT_PUBLIC_BUILD ??
      "local",
  },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
  ],
};

export default nextConfig;
