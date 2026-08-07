import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 프로젝트 사이트: /<repo>/
// 로컬·미리보기: /
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
})
