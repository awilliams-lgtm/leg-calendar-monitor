import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
};

export default nextConfig;
