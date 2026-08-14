/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@trackify/shared", "@trackify/db"],
};
export default nextConfig;
