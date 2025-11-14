/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Ícones/imagens servidas direto do GitHub (raw)
      // loja
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/MarcosMWB/StoreImage/main/**',
      },
      // sprites da PokeAPI
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/PokeAPI/sprites/master/sprites/pokemon/**',
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
