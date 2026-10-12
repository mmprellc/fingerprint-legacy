import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "@resvg/resvg-js"],
  poweredByHeader: false,
};

export default nextConfig;
