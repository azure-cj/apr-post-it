/**
 * Runs before every test file (vite.config.ts, test.setupFiles).
 *
 * No web app link is built in during the tests, whatever src/config.ts holds:
 * the suite must not depend on the real link. A test that wants one mocks
 * '@/config' itself (see src/ui/BuiltInLink.test.tsx); its mock wins.
 */
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  BUILT_IN_SCRIPT_URL: '',
}));
