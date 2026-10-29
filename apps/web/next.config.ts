import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/plant-catalog/:path*', destination: '/plant-setup', permanent: false },
      { source: '/plant-profiles/:path*', destination: '/plant-setup', permanent: false },
      { source: '/plant-ai-recommendations/:path*', destination: '/plant-setup', permanent: false },
      { source: '/plant-proposals/:path*', destination: '/plant-setup', permanent: false },
      { source: '/plant-assignments/:path*', destination: '/plant-setup', permanent: false },
    ];
  },
};

export default nextConfig;
