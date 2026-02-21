import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middlewares/errorHandler';
import { authRouter } from './routes/authRoutes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

app.use('/api/auth', authRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  errorHandler(err, req, res, next);
});

export { app };
