import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build` makes a normal static site in dist/; `npm run build:single`
// inlines everything into one self-contained HTML file in dist-single/.
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
}))
