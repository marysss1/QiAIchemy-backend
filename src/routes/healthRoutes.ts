import { Router } from 'express';
import { uploadHealthSnapshot } from '../controllers/healthController';
import { requireAuth } from '../middlewares/authMiddleware';

const healthRouter = Router();

healthRouter.post('/snapshots', requireAuth, uploadHealthSnapshot);

export { healthRouter };
