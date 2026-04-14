import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Integration tests need a real database; concurrency tests likewise. Both are
  // explicitly opt-in via dedicated commands rather than the default `pnpm test`.
  testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$', 'concurrency\\.spec\\.ts$'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@omnichannel/types(.*)$': '<rootDir>/../../../packages/types/src$1',
    '^@omnichannel/utils(.*)$': '<rootDir>/../../../packages/utils/src$1',
  },
}

export default config
