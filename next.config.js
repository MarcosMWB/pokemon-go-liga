/** @type {import('next').NextConfig} */
const nextConfig = {
  // Evita que o servidor `next dev` mantenha arquivos abertos durante `next build` no Windows.
  // A Vercel e os builds locais continuam usando o diretório padrão `.next`.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: {
    remotePatterns: [
      // GitHub raw (loja)
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/MarcosMWB/StoreImage/main/**',
      },
      // PokeAPI sprites
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/PokeAPI/sprites/master/sprites/pokemon/**',
      },
      // QR code do chat/desafio
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
        pathname: '/**',
      },
      // Firebase Storage (insígnias, etc.)
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/**',
      },
    ],
    // se algum ícone for SVG remoto e você usar <Image /> para SVG:
    // dangerouslyAllowSVG: true,
  },
};

module.exports = nextConfig;
