import { defineConfig } from 'vite'
export default defineConfig({
  optimizeDeps: {
    include: ['firebase/app', 'firebase/firestore']
  },
  build: {
    outDir: 'dist',
    commonjsOptions: { include: [/firebase/, /node_modules/] }
  }
})
