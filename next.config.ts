import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Runtime config is served via /api/runtime-config, not NEXT_PUBLIC_ build-time vars.
  // No NEXT_PUBLIC_ vars should be added here.
};

export default nextConfig;
