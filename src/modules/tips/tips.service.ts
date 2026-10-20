import { prisma } from '../../utils/prisma.utils';
import { logger } from '../../utils/logger.utils';
import { resolvePinataGatewayUrl } from '../../utils/pinata-gateway.utils';

export const TIP_CONTENT_MAX_LENGTH = 500;
export const TIP_IPFS_TIMEOUT_MS = 5_000;

const TIP_SENT_TOPICS = ['TipSent', 'TIP_SENT', 'tip_sent'];
const TIP_ID_FIELDS = ['tip_id', 'tipId', 'id'];
const CONTENT_HASH_FIELDS = [
   'content_hash',
   'contentHash',
   'message_hash',
   'messageHash',
   'content_cid',
   'contentCid',
   'message_cid',
   'messageCid',
];

export interface TipContentResponse {
   tip_id: string;
   content: string | null;
   content_unavailable: boolean;
}

interface TipSentEvent {
   id: string;
   dataJson: string;
}

export class TipNotFoundError extends Error {
   constructor(tipId: string) {
      super(`Tip not found: ${tipId}`);
      this.name = 'TipNotFoundError';
   }
}

class IpfsTimeoutError extends Error {
   constructor() {
      super(`IPFS content fetch timed out after ${TIP_IPFS_TIMEOUT_MS}ms`);
      this.name = 'IpfsTimeoutError';
   }
}

const inFlightFetches = new Map<string, Promise<TipContentResponse>>();

function parseEventPayload(dataJson: string): Record<string, unknown> | null {
   try {
      const parsed: unknown = JSON.parse(dataJson);
      if (typeof parsed === 'string') {
         const nested: unknown = JSON.parse(parsed);
         return nested && typeof nested === 'object'
            ? (nested as Record<string, unknown>)
            : null;
      }

      return parsed && typeof parsed === 'object'
         ? (parsed as Record<string, unknown>)
         : null;
   } catch {
      return null;
   }
}

function getTipIdentifier(payload: Record<string, unknown>): string | null {
   for (const field of TIP_ID_FIELDS) {
      const value = payload[field];
      if (typeof value === 'string' || typeof value === 'number') {
         return String(value);
      }
   }

   return null;
}

function getContentHash(payload: Record<string, unknown>): string | null {
   for (const field of CONTENT_HASH_FIELDS) {
      const value = payload[field];
      if (typeof value === 'string' && value.trim()) {
         return value.trim();
      }
   }

   const nested = payload.data;
   if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return getContentHash(nested as Record<string, unknown>);
   }

   return null;
}

async function findTipSentEvent(tipId: string): Promise<TipSentEvent> {
   const events = await prisma.event.findMany({
      where: {
         topic: { in: TIP_SENT_TOPICS },
         OR: [{ id: tipId }, { dataJson: { contains: tipId } }],
      },
      orderBy: { ledger: 'desc' },
   });

   const matchingEvent = events.find(event => {
      if (event.id === tipId) {
         return true;
      }

      const payload = parseEventPayload(event.dataJson);
      return payload !== null && getTipIdentifier(payload) === tipId;
   });

   if (!matchingEvent) {
      throw new TipNotFoundError(tipId);
   }

   return matchingEvent;
}

async function fetchIpfsContent(url: string): Promise<string> {
   const controller = new AbortController();
   let timeoutId: NodeJS.Timeout;

   const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
         controller.abort();
         reject(new IpfsTimeoutError());
      }, TIP_IPFS_TIMEOUT_MS);
   });

   const requestPromise = fetch(url, { signal: controller.signal }).then(
      async response => {
         if (!response.ok) {
            throw new Error(`IPFS gateway returned HTTP ${response.status}`);
         }
         return response.text();
      }
   );

   try {
      return await Promise.race([requestPromise, timeoutPromise]);
   } finally {
      clearTimeout(timeoutId!);
   }
}

function truncateContent(content: string): string {
   return Array.from(content).slice(0, TIP_CONTENT_MAX_LENGTH).join('');
}

async function fetchAndCacheTipContent(
   tipId: string
): Promise<TipContentResponse> {
   const event = await findTipSentEvent(tipId);
   const payload = parseEventPayload(event.dataJson);
   const contentHash = payload ? getContentHash(payload) : null;
   const url = resolvePinataGatewayUrl(contentHash);

   if (!contentHash || !url) {
      logger.warn({ tipId }, 'TipSent event has no usable IPFS content hash');
      return { tip_id: tipId, content: null, content_unavailable: true };
   }

   let content: string;
   try {
      content = await fetchIpfsContent(url);
   } catch (error) {
      logger.warn(
         { tipId, contentHash, error },
         'Failed to fetch tip content from IPFS'
      );
      return { tip_id: tipId, content: null, content_unavailable: true };
   }

   const truncatedContent = truncateContent(content);
   const cached = await prisma.tipContent.upsert({
      where: { tipId },
      update: {},
      create: { tipId, contentHash, content: truncatedContent },
   });

   return {
      tip_id: tipId,
      content: cached.content,
      content_unavailable: false,
   };
}

export async function getTipContent(
   tipId: string
): Promise<TipContentResponse> {
   const cached = await prisma.tipContent.findUnique({ where: { tipId } });
   if (cached) {
      return {
         tip_id: tipId,
         content: cached.content,
         content_unavailable: false,
      };
   }

   const existingFetch = inFlightFetches.get(tipId);
   if (existingFetch) {
      return existingFetch;
   }

   const fetchPromise = fetchAndCacheTipContent(tipId);
   inFlightFetches.set(tipId, fetchPromise);

   try {
      return await fetchPromise;
   } finally {
      if (inFlightFetches.get(tipId) === fetchPromise) {
         inFlightFetches.delete(tipId);
      }
   }
}
