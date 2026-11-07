import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/perf.bench.ts'], environment: 'node', testTimeout: 600_000 } })
