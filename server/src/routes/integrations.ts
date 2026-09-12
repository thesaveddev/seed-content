import { Router, Response } from 'express';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { Integration } from '../models';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/integrations
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const integrations = await Integration.find({ workspaceId: req.workspaceId });
    res.json({ success: true, data: integrations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/integrations/:provider/connect
router.post('/:provider/connect', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const integration = await Integration.findOneAndUpdate(
      { workspaceId: req.workspaceId, provider: req.params.provider },
      {
        workspaceId: req.workspaceId,
        provider: req.params.provider,
        status: 'connected',
        credentials: req.body.credentials || {},
        metadata: req.body.metadata || {},
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: integration });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/integrations/:provider
router.delete('/:provider', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const integration = await Integration.findOneAndDelete({
      workspaceId: req.workspaceId,
      provider: req.params.provider,
    });
    if (!integration) {
      res.status(404).json({ success: false, error: 'Integration not found' });
      return;
    }
    res.json({ success: true, message: 'Integration disconnected' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
