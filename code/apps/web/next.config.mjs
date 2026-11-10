/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@fixtriage/core', '@fixtriage/db', '@fixtriage/platform', '@fixtriage/services'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
};
export default nextConfig;
