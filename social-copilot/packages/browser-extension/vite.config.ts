import { mkdir, copyFile, stat, readdir } from 'fs/promises';
import { defineConfig } from 'vite';
import { dirname, join, resolve } from 'path';

const isRelease = process.env.SC_RELEASE === '1';

async function copyRecursive(source: string, destination: string) {
  const info = await stat(source);

  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source);
    for (const entry of entries) {
      await copyRecursive(join(source, entry), join(destination, entry));
    }
    return;
  }

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    async closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      const assets = [
        { source: resolve(__dirname, 'manifest.json'), destination: resolve(outDir, 'manifest.json') },
        { source: resolve(__dirname, 'src/popup/index.html'), destination: resolve(outDir, 'popup/index.html') },
        { source: resolve(__dirname, 'src/popup/privacy.html'), destination: resolve(outDir, 'popup/privacy.html') },
        { source: resolve(__dirname, 'styles'), destination: resolve(outDir, 'styles') },
        { source: resolve(__dirname, 'icons'), destination: resolve(outDir, 'icons') },
      ];

      for (const asset of assets) {
        await copyRecursive(asset.source, asset.destination);
      }
    },
  };
}

export default defineConfig({
  define: {
    __SC_RELEASE__: JSON.stringify(isRelease),
  },
  plugins: [copyStaticAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        'content-scripts/telegram': resolve(__dirname, 'src/content-scripts/telegram.ts'),
        'content-scripts/whatsapp': resolve(__dirname, 'src/content-scripts/whatsapp.ts'),
        'content-scripts/slack': resolve(__dirname, 'src/content-scripts/slack.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: isRelease ? 'esbuild' : false,
    sourcemap: isRelease ? false : true,
  },
  resolve: {
    alias: {
      '@social-copilot/core': resolve(__dirname, '../core/src'),
    },
  },
});
