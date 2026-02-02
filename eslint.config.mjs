import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Bridge classic "extends" configs into ESLint v9 flat config.
const compat = new FlatCompat({
  baseDirectory: __dirname,
})

export default [
  // Ignore generated/build outputs
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/data/**',
      '**/.turbo/**',
    ],
  },

  // Next.js app (Mission Control)
  ...compat.extends('next/core-web-vitals'),

  // Packages: keep lint minimal for now (no TS type-aware rules yet)
  {
    files: ['packages/**/*.{js,ts,tsx}', 'packages/**/*.{mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {},
  },
]
