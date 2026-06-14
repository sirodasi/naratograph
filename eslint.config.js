import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // 未使用は error のまま。ただし意図的な未使用（_ プレフィックス）と catch 引数は許容（標準的な運用）。
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // Fast Refresh のヒント。SessionView 等はヘルパーとコンポーネントを意図的に併存 export しているため無効化。
      'react-refresh/only-export-components': 'off',
      // React Compiler 向けの助言ルール群（本プロジェクトは Compiler 未使用）。
      // 既存コードの意図的パターン（演出の遷移検知・非リアクティブ ref 参照・装飾 Math.random 等）に
      // 対する false-concern のため off。static-components は render 内コンポーネント生成という
      // 実害（サブツリー再マウント）を捕捉でき有用なので warn のまま残す。
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'warn',
    },
  },
])
