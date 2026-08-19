import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import macros from 'unplugin-parcel-macros';

// SPIKE FINDING: React Spectrum S2 compiles its styles through the Parcel
// `style()` macro. Under a non-Parcel bundler the macro plugin is REQUIRED or
// component layout silently breaks (text overlaps, grid areas unapplied) with
// no build error.
export default defineConfig({
  plugins: [macros.vite(), react()],
  build: { outDir: 'dist' }
});
