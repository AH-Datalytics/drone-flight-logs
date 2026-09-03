import type { NextConfig } from 'next';

/**
 * turbopack.root pins the project root. Without it Turbopack walks up looking
 * for a lockfile, finds an unrelated one in the home directory above this
 * repository, and warns on every build.
 */
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: __dirname },
};

export default config;
