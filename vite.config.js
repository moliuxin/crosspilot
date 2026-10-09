import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 客户独立站预览（site-preview.html）作为第二个构建入口，保持与基线一致
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        'site-preview': 'site-preview.html',
      },
    },
  },
})
