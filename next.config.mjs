/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb", // for policy PDF uploads later
    },
  },
};

export default nextConfig;
