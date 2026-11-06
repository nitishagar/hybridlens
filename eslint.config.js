import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // I8: free-tier only — the Agent Platform (billing-gated) backend must
      // never be imported. Symbol verified against installed firebase/ai:
      // exports AgentPlatformBackend (no VertexAIBackend exists).
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'firebase/ai', importNames: ['AgentPlatformBackend'] }] },
      ],
    },
  },
);
