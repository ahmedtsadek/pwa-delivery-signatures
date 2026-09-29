/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://api:8787/api/:path*' },
      { source: '/health/api', destination: 'http://api:8787/health' }
    ];
  }
};
export default nextConfig;
