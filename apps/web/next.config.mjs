/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@mqtt-chat/ui",
    "@mqtt-chat/shared-types",
    "@mqtt-chat/mqtt-contracts",
    "@mqtt-chat/realtime-core",
  ],
  // MQTT.js must NOT be bundled into server layers: its browser ESM build
  // breaks React SSR (duplicate react context during prerender). Keep it
  // external on the server — the native CJS build is Node-safe there.
  serverExternalPackages: ["mqtt"],
};

export default nextConfig;
