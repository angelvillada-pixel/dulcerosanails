import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      external: (id) => id.startsWith('https://')
    }
  }
})
