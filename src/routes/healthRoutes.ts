import { Router } from 'express';
import { getLatestHealthSnapshot, uploadHealthSnapshot } from '../controllers/healthController';
import { requireAuth } from '../middlewares/authMiddleware';

const healthRouter = Router();

healthRouter.post('/snapshots', requireAuth, uploadHealthSnapshot);
healthRouter.get('/snapshots/latest', requireAuth, getLatestHealthSnapshot);

export { healthRouter };
