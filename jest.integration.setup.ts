const testPath = expect.getState().testPath ?? '';
const normalizedTestPath = testPath.replace(/\\/g, '/');
const isIntegrationTest =
   normalizedTestPath.includes('/integration/') ||
   normalizedTestPath.endsWith('.integration.test.ts');

if (isIntegrationTest) {
   jest.unmock('@prisma/client');

   afterAll(async () => {
      const { prisma } = await import('./src/utils/prisma.utils');
      if (!prisma) {
         return;
      }

      if (typeof prisma.$disconnect === 'function') {
         await prisma.$disconnect();
      }
   });
}
