import { Router } from 'express';
import { ragChat, ragHealthChat, simpleAsk } from '../controllers/agentController';
import { requireAuth } from '../middlewares/authMiddleware';
import { listChatSessions, upsertChatSession } from '../controllers/sessionController';

const agentRouter = Router();

agentRouter.post('/ask', simpleAsk);
agentRouter.post('/chat', requireAuth, ragChat);
agentRouter.post('/chat/health', requireAuth, ragHealthChat);
agentRouter.get('/sessions', requireAuth, listChatSessions);
agentRouter.put('/sessions/:sessionId', requireAuth, upsertChatSession);

export { agentRouter };
