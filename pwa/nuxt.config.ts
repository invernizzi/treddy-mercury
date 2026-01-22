// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',
  devtools: { enabled: true },
  modules: ['@vite-pwa/nuxt', '@pinia/nuxt'],
  
  runtimeConfig: {
    // Keys within public are also exposed to the client-side
    public: {
      fitbitClientId: '', // Overwrite with Env if needed
    },
    // The private keys which are only available server-side
    fitbitClientSecret: '', 
  },

  nitro: {
    preset: 'cloudflare-pages'
  },

  pwa: {
    manifest: {
      name: 'Treddy Mercury',
      short_name: 'Treddy',
      theme_color: '#000000',
      description: 'NordicTrack s20i Dashboard & Sync',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    },
    workbox: {
      navigateFallback: '/',
    },
    devOptions: {
      enabled: true,
      type: 'module',
    }
  }
})
