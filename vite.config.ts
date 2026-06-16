import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PDFWorld runs 100% client-side. No backend, no uploads — every PDF stays in the browser.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000, // pdf.js + pdf-lib are large by nature
  },
  worker: {
    format: 'es',
  },
});
