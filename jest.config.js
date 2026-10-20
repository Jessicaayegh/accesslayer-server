const { createDefaultPreset } = require('ts-jest');

const tsJestTransformCfg = createDefaultPreset({
   diagnostics: { warnOnly: true },
   tsconfig: '<rootDir>/tsconfig.jest.json',
}).transform;

/** @type {import("jest").Config} **/
module.exports = {
   testEnvironment: 'node',
   transform: {
      ...tsJestTransformCfg,
   },
   maxWorkers: 2,
   workerIdleMemoryLimit: '512MB',
   moduleNameMapper: {
      '^chalk$': '<rootDir>/src/__mocks__/chalk.ts',
   },
   roots: ['<rootDir>/src'],
   setupFiles: ['./jest.setup.ts'],
   setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.ts'],
};
