import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    css: false,
    include: ['src/**/*.test.{js,jsx}', 'functions/lib/**/*.test.js'],
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**', 'src/agent/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
