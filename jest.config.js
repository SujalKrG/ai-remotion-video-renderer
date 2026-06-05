export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  roots: ['<rootDir>/src/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
  moduleNameMapper: {
    // Resolve .js imports to .ts source files (ESM import convention in NodeNext)
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Map package subpath imports to local mocks (package uses JSX/ESM that jest can't transform)
    '^@evatrilvideo/ai-video-package/src/frameRegistry\\.js$': '<rootDir>/src/tests/__mocks__/frameRegistry.ts',
    '^@evatrilvideo/ai-video-package/src/fonts/registerFonts\\.js$': '<rootDir>/src/tests/__mocks__/registerFonts.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**',
    '!src/remotion/**',
    '!src/compositions/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
