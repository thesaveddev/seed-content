import { Router, Response } from 'express';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { BrandVoice } from '../models';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/brand-voices
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const voices = await BrandVoice.find({ workspaceId: req.workspaceId }).sort({ createdAt: -1 });
    res.json({ success: true, data: voices });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/brand-voices
router.post('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    // Enforce brand voice plan limits
    const { Workspace, Usage } = await import('../models');
    const { PLAN_LIMITS } = await import('../types');
    const workspace = await Workspace.findById(req.workspaceId);
    if (workspace) {
      const limits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
      if (limits.brandVoices >= 0) {
        const count = await BrandVoice.countDocuments({ workspaceId: req.workspaceId });
        if (count >= limits.brandVoices) {
          res.status(403).json({
            success: false,
            error: `Your ${workspace.plan} plan allows ${limits.brandVoices} brand voice${limits.brandVoices !== 1 ? 's' : ''}. Upgrade for more.`,
          });
          return;
        }
      }
    }

    const voice = await BrandVoice.create({
      workspaceId: req.workspaceId,
      ...req.body,
    });
    res.status(201).json({ success: true, data: voice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/brand-voices/:id
router.put('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const voice = await BrandVoice.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      req.body,
      { new: true }
    );
    if (!voice) {
      res.status(404).json({ success: false, error: 'Brand voice not found' });
      return;
    }
    res.json({ success: true, data: voice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/brand-voices/:id
router.delete('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const voice = await BrandVoice.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });
    if (!voice) {
      res.status(404).json({ success: false, error: 'Brand voice not found' });
      return;
    }
    res.json({ success: true, message: 'Brand voice deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
