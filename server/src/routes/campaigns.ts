import { Router, Response } from 'express';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { Campaign, ContentProject } from '../models';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/campaigns
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const campaigns = await Campaign.find({ workspaceId: req.workspaceId }).sort({ createdAt: -1 });

    // Get content counts per campaign
    const campaignIds = campaigns.map((c: any) => c._id);
    const counts = await ContentProject.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      { $group: { _id: '$campaignId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c: any) => [c._id.toString(), c.count]));

    const enriched = campaigns.map((c: any) => ({
      ...c,
      contentCount: countMap.get(c._id.toString()) || 0,
    }));

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/campaigns
router.post('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    // Enforce campaign plan limits
    const { Workspace } = await import('../models');
    const { PLAN_LIMITS } = await import('../types');
    const workspace = await Workspace.findById(req.workspaceId);
    if (workspace) {
      const limits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
      if (limits.campaigns >= 0) {
        const count = await Campaign.countDocuments({ workspaceId: req.workspaceId });
        if (count >= limits.campaigns) {
          res.status(403).json({
            success: false,
            error: `Your ${workspace.plan} plan allows ${limits.campaigns} campaign${limits.campaigns !== 1 ? 's' : ''}. Upgrade for more.`,
          });
          return;
        }
      }
    }

    const campaign = await Campaign.create({
      workspaceId: req.workspaceId,
      ...req.body,
    });
    res.status(201).json({ success: true, data: campaign });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/campaigns/:id
router.put('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      req.body,
      { new: true }
    );
    if (!campaign) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }
    res.json({ success: true, data: campaign });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await Campaign.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });
    if (!campaign) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }
    // Unlink projects from this campaign
    await ContentProject.updateMany(
      { campaignId: campaign._id },
      { $unset: { campaignId: '' } }
    );
    res.json({ success: true, message: 'Campaign deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
