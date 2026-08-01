import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import agents from 'agents/vite'

export default defineConfig({
  plugins: [agents(), react()],
  build: { outDir: 'dist', sourcemap: false },
  server: { port: 5173, strictPort: true }
})
