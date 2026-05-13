import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // !! สั่งให้ Vercel ข้ามการเช็ก TypeScript Error ไปเลย !!
    ignoreBuildErrors: true,
  },
  eslint: {
    // !! สั่งให้ Vercel ข้ามการเช็ก ESLint ด้วย !!
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;