import { Router } from 'express';
import { ragChat } from '../controllers/agentController';
import { requireAuth } from '../middlewares/authMiddleware';

const agentRouter = Router();

agentRouter.post('/chat', requireAuth, ragChat);

export { agentRouter };
