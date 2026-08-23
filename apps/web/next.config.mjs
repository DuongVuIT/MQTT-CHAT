/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@mqtt-chat/ui", "@mqtt-chat/shared-types", "@mqtt-chat/mqtt-contracts"],
};

export default nextConfig;
