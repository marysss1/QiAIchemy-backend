import { Router } from 'express';
import { login, me, register, usernameAvailable } from '../controllers/authController';
import { requireAuth } from '../middlewares/authMiddleware';

const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.get('/username-available', usernameAvailable);
authRouter.get('/me', requireAuth, me);

export { authRouter };
