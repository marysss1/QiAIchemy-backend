import { Router } from 'express';
import { login, me, register } from '../controllers/authController';
import { requireAuth } from '../middlewares/authMiddleware';

const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.get('/me', requireAuth, me);

export { authRouter };
