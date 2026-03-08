import { Router } from 'express';
import { getHealthProfile, getLatestHealthSnapshot, uploadHealthSnapshot } from '../controllers/healthController';
import { requireAuth } from '../middlewares/authMiddleware';

const healthRouter = Router();

healthRouter.post('/snapshots', requireAuth, uploadHealthSnapshot);
healthRouter.get('/snapshots/latest', requireAuth, getLatestHealthSnapshot);
healthRouter.get('/profile', requireAuth, getHealthProfile);

export { healthRouter };
