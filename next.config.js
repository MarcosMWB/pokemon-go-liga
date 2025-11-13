/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Ícones/imagens servidas direto do GitHub (raw)
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
      },
      // QR code do chat/desafio
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
      },
      // (opcional) outro gerador que você usar no futuro
      // {
      //   protocol: 'https',
      //   hostname: 'quickchart.io',
      // },
    ],
  },
};

module.exports = nextConfig;
