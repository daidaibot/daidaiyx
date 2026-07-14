import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const base =
    process.env.GITHUB_PAGES === 'true' ? '/daidaiyx/' : '/';

  return {
    plugins: [react()],
    base,
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            router: ['react-router-dom'],
            markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight'],
          }
        }
      },
      minify: mode === 'production',
      target: 'es2020',
      sourcemap: mode !== 'production'
    },
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:80',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 3000,
      host: true
    }
  }
})
