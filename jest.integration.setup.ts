const testPath = expect.getState().testPath ?? '';

if (testPath.endsWith('.integration.test.ts')) {
   jest.unmock('@prisma/client');

   afterAll(async () => {
      const { prisma } = await import('./src/utils/prisma.utils');
      if (typeof prisma.$disconnect === 'function') {
         await prisma.$disconnect();
      }
   });
}
