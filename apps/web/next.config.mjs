/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://api:8787/api/:path*' },
      { source: '/health', destination: 'http://api:8787/health' },
      { source: '/health/api', destination: 'http://api:8787/health' }
    ];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' }
      ]
    }];
  }
};
export default nextConfig;
