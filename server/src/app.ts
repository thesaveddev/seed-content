import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

// Routes
import authRoutes from './routes/auth';
import contentRoutes from './routes/content';
import workspaceRoutes from './routes/workspaces';
import brandVoiceRoutes from './routes/brandVoice';
import campaignRoutes from './routes/campaigns';
import ideasRoutes from './routes/ideas';
import billingRoutes from './routes/billing';
import integrationsRoutes from './routes/integrations';
import statsRoutes from './routes/stats';
import notificationRoutes from './routes/notifications';
import settingsRoutes from './routes/settings';
import schedulerRoutes from './routes/scheduler';
import teamRoutes from './routes/team';
import adminRoutes from './routes/admin';
import { sseHandler } from './routes/events';

/**
 * Build the fully-configured Express app.
 *
 * Side effects deliberately NOT included here (they belong to index.ts):
 * - database connection
 * - queue initialisation
 * - scheduled-post publisher
 * - app.listen
 *
 * This keeps the app testable: tests boot createApp() against their own
 * database state and drive it with supertest.
 */
export function createApp(): express.Express {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, mobile apps, same-origin)
      if (!origin) return callback(null, true);
      // Allow localhost and local network IPs
      if (
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|localhost)/.test(origin) ||
        origin === config.FRONTEND_URL
      ) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
  }));

  // Stripe webhooks need raw body for signature verification — register BEFORE express.json()
  app.post('/api/billing/webhooks', express.raw({ type: 'application/json' }), (req, _res, next) => {
    req.url = '/webhooks';
    billingRoutes(req, _res, next);
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(compression());

  app.use('/api/', rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' },
    skip: (req) =>
      // Lightweight polling & health checks shouldn't burn the quota
      (req.path.startsWith('/notifications') && req.method === 'GET') ||
      req.path.startsWith('/scheduler') && req.method === 'GET' ||
      req.path === '/health',
  }));

  // ── Protected file access ──
  // Source files are private to the workspace that uploaded them.
  // Old clients may still reference /uploads/<file>; those now require auth too.
  const serveProtectedFile = async (req: any, res: any, storedFile: any) => {
    const fs = await import('fs');
    const resolved = path.resolve(config.STORAGE_DIR, storedFile);
    // Prevent path traversal
    if (!resolved.startsWith(path.resolve(config.STORAGE_DIR))) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.sendFile(resolved);
  };

  // Find which project references this file and check workspace membership
  const authorizeFileAccess = async (req: any, res: any, next: any) => {
    try {
      const { ContentProject, WorkspaceMember } = await import('./models');
      const storedFile = path.basename(req.params.file);
      const project = await ContentProject.findOne({ sourceFile: storedFile });
      if (!project) {
        res.status(404).json({ success: false, error: 'File not found' });
        return;
      }
      const membership = await WorkspaceMember.findOne({
        workspaceId: project.workspaceId,
        userId: req.userId,
      });
      if (!membership) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      next();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  app.get('/api/files/:file', authenticate, authorizeFileAccess, (req, res) =>
    serveProtectedFile(req, res, req.params.file)
  );
  app.get('/uploads/:file', authenticate, authorizeFileAccess, (req, res) =>
    serveProtectedFile(req, res, req.params.file)
  );

  // SSE endpoint (no JSON parsing needed)
  app.get('/api/content/:id/events', authenticate, sseHandler);

  app.use('/api/auth', authRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/brand-voices', brandVoiceRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/ideas', ideasRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/integrations', integrationsRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/scheduler', schedulerRoutes);
  app.use('/api/team', teamRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../../web/dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, '../../web/dist/index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
