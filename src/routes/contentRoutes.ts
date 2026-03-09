import { Router } from 'express';
import { listYouthArticles } from '../controllers/contentController';

const contentRouter = Router();

contentRouter.get('/articles', listYouthArticles);

export { contentRouter };
