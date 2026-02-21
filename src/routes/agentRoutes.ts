import { Router } from 'express';
import { ragChat, ragHealthChat } from '../controllers/agentController';
import { requireAuth } from '../middlewares/authMiddleware';

const agentRouter = Router();

agentRouter.post('/chat', requireAuth, ragChat);
agentRouter.post('/chat/health', requireAuth, ragHealthChat);

export { agentRouter };
