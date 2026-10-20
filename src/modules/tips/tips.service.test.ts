import { prisma } from '../../utils/prisma.utils';
import {
   getTipContent,
   TIP_CONTENT_MAX_LENGTH,
   TIP_IPFS_TIMEOUT_MS,
} from './tips.service';

const mockTipContent = prisma.tipContent as jest.Mocked<
   typeof prisma.tipContent
>;
const mockEvents = prisma.event as jest.Mocked<typeof prisma.event>;

function makeTipSentEvent(dataJson: string) {
   return {
      id: 'event-1',
      network: 'testnet',
      contractId: 'contract-1',
      ledger: 1,
      txHash: 'tx-1',
      eventIndex: 0,
      topic: 'TipSent',
      dataJson,
      leafHash: 'leaf-hash',
      leafIndex: 0,
      partitionId: 'partition-1',
      createdAt: new Date(),
   };
}

describe('getTipContent', () => {
   beforeEach(() => {
      jest.clearAllMocks();
      jest.useRealTimers();
      jest.spyOn(global, 'fetch');
   });

   afterEach(() => {
      jest.restoreAllMocks();
   });

   it('returns cached content without looking up events or fetching IPFS', async () => {
      mockTipContent.findUnique.mockResolvedValue({
         id: 'cache-1',
         tipId: 'tip-1',
         contentHash: 'bafy-content',
         content: 'cached message',
         createdAt: new Date(),
      });

      const result = await getTipContent('tip-1');

      expect(result).toEqual({
         tip_id: 'tip-1',
         content: 'cached message',
         content_unavailable: false,
      });
      expect(mockEvents.findMany).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
   });

   it('fetches TipSent content, truncates it, and stores the permanent cache', async () => {
      const content = 'x'.repeat(TIP_CONTENT_MAX_LENGTH + 25);
      mockTipContent.findUnique.mockResolvedValue(null);
      mockTipContent.findUnique
         .mockResolvedValueOnce(null)
         .mockResolvedValueOnce({
            id: 'cache-1',
            tipId: 'tip-1',
            contentHash: 'ipfs://bafy-content',
            content: content.slice(0, TIP_CONTENT_MAX_LENGTH),
            createdAt: new Date(),
         });
      mockEvents.findMany.mockResolvedValue([
         makeTipSentEvent(
            JSON.stringify({
               tip_id: 'tip-1',
               message_cid: 'ipfs://bafy-content',
            })
         ),
      ]);
      jest.spyOn(global, 'fetch').mockResolvedValue({
         ok: true,
         text: async () => content,
      } as Response);
      mockTipContent.upsert.mockResolvedValue({
         id: 'cache-1',
         tipId: 'tip-1',
         contentHash: 'ipfs://bafy-content',
         content: content.slice(0, TIP_CONTENT_MAX_LENGTH),
         createdAt: new Date(),
      });

      const result = await getTipContent('tip-1');
      const cachedResult = await getTipContent('tip-1');

      expect(result.content).toBe('x'.repeat(TIP_CONTENT_MAX_LENGTH));
      expect(result.content_unavailable).toBe(false);
      expect(cachedResult).toEqual(result);
      expect(mockEvents.findMany).toHaveBeenCalledWith(
         expect.objectContaining({
            where: expect.objectContaining({
               topic: { in: ['TipSent', 'TIP_SENT', 'tip_sent'] },
            }),
         })
      );
      expect(global.fetch).toHaveBeenCalledWith(
         expect.stringContaining('/bafy-content'),
         expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(mockTipContent.upsert).toHaveBeenCalledWith({
         where: { tipId: 'tip-1' },
         update: {},
         create: {
            tipId: 'tip-1',
            contentHash: 'ipfs://bafy-content',
            content: 'x'.repeat(TIP_CONTENT_MAX_LENGTH),
         },
      });
   });

   it('returns content_unavailable after the 5-second timeout and does not cache it', async () => {
      jest.useFakeTimers();
      mockTipContent.findUnique.mockResolvedValue(null);
      mockEvents.findMany.mockResolvedValue([
         makeTipSentEvent(
            JSON.stringify({
               tip_id: 'tip-1',
               content_hash: 'bafy-content',
            })
         ),
      ]);
      jest
         .spyOn(global, 'fetch')
         .mockImplementation(() => new Promise<Response>(() => {}));

      const resultPromise = getTipContent('tip-1');
      await jest.advanceTimersByTimeAsync(TIP_IPFS_TIMEOUT_MS);
      const result = await resultPromise;

      expect(result).toEqual({
         tip_id: 'tip-1',
         content: null,
         content_unavailable: true,
      });
      expect(mockTipContent.upsert).not.toHaveBeenCalled();
      jest.useRealTimers();
   });
});
