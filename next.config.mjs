/** @type {import('next').NextConfig} */
const nextConfig = {
  // Admin-uploaded images physically live outside /public (on the same
  // persisted volume as the database — see app/api/uploads/[filename]/route.js)
  // so they survive redeploys on hosts with only one mountable volume per
  // service. The URL shape stays /uploads/<file>, matching what's already
  // stored in form_options.image_url, so nothing needs to be migrated.
  async rewrites() {
    return [{ source: "/uploads/:filename", destination: "/api/uploads/:filename" }];
  },
};

export default nextConfig;
