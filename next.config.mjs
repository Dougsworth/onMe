/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.perfectcorp.com" },
      { protocol: "https", hostname: "cf.perfectcorp.com" },
      { protocol: "https", hostname: "img.chrono24.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "media.tiffany.com" },
      { protocol: "https", hostname: "www.cartier.com" },
      { protocol: "https", hostname: "cdn.mejuri.com" },
      { protocol: "https", hostname: "www.jamesallen.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default nextConfig;
