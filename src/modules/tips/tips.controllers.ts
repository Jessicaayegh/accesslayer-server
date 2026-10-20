import { AsyncController } from '../../types/auth.types';
import { sendSuccess } from '../../utils/api-response.utils';
import { TipNotFoundError, getTipContent } from './tips.service';

export const httpGetTipContent: AsyncController = async (req, res, next) => {
   const tipId = req.params.tip_id;
   if (typeof tipId !== 'string' || !tipId.trim()) {
      res.status(400).json({
         success: false,
         error: {
            code: 'INVALID_TIP_ID',
            message: 'A valid tip_id is required',
         },
      });
      return;
   }

   try {
      const content = await getTipContent(tipId);
      sendSuccess(res, content);
   } catch (error) {
      if (error instanceof TipNotFoundError) {
         res.status(404).json({
            success: false,
            error: {
               code: 'TIP_NOT_FOUND',
               message: error.message,
            },
         });
         return;
      }

      next(error);
   }
};
