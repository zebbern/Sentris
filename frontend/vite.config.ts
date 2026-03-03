import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

const instance = parseInt(process.env.SENTRIS_INSTANCE || '0', 10);
const frontendPort = 5173 + instance * 100;
const backendPort = 3211 + instance * 100;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    process.env.ANALYZE === 'true' &&
      visualizer({
        filename: 'dist/bundle-report.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force single React instance for all packages
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@radix-ui/react-accordion'],
    esbuildOptions: {
      // Ensure React is treated as external in dependencies
      resolveExtensions: ['.jsx', '.tsx', '.js', '.ts'],
    },
  },
  server: {
    host: '0.0.0.0',
    port: frontendPort,
    strictPort: true,
    open: false,
    allowedHosts: ['frontend'],
    proxy: {
      '/api/': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/analytics/': {
        target: 'http://localhost:5601',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    allowedHosts: ['frontend'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // React core
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router-dom/')
          )
            return 'vendor-react';

          // Radix UI
          if (id.includes('@radix-ui/')) return 'vendor-radix';

          // Analytics
          if (id.includes('posthog-js')) return 'vendor-analytics';

          // Auth
          if (id.includes('@clerk')) return 'vendor-clerk';

          // Heavy vendor chunks — split to enable parallel loading
          if (id.includes('monaco-editor')) return 'vendor-monaco';
          if (id.includes('@xyflow') || id.includes('@reactflow') || id.includes('reactflow'))
            return 'vendor-reactflow';
          if (id.includes('xterm')) return 'vendor-xterm';
          if (id.includes('@dnd-kit')) return 'vendor-dnd';
        },
      },
    },
  },
});
