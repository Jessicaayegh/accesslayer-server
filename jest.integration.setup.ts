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

      if (
         process.env.JEST_TEST_DB_RESET === '1' &&
         typeof prisma.$executeRawUnsafe === 'function'
      ) {
         await prisma.$executeRawUnsafe(`
            DO $$
            DECLARE table_list text;
            BEGIN
               SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
               INTO table_list
               FROM pg_tables
               WHERE schemaname = 'public'
                 AND tablename <> '_prisma_migrations';

               IF table_list IS NOT NULL THEN
                  EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY CASCADE';
               END IF;
            END $$;
         `);
      }
      if (typeof prisma.$disconnect === 'function') {
         await prisma.$disconnect();
      }
   });
}
