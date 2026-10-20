import { Router } from 'express';
import { httpGetTipContent } from './tips.controllers';

const tipsRouter = Router();

tipsRouter.get('/:tip_id/content', httpGetTipContent);

export default tipsRouter;
