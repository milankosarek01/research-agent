/** @type {import('next').NextConfig} */
const nextConfig = {
  // Zajistí, že se soubor SKILL.md přibalí k serverové funkci na Vercelu,
  // aby ho route (app/api/research) mohla načíst i po nasazení.
  outputFileTracingIncludes: {
    "/api/research": ["./SKILL.md"],
  },
};

export default nextConfig;
