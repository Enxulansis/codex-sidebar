import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/codex*.spec.ts'],testTimeout:30000,hookTimeout:30000}});
