import { Router, Response } from 'express';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { ContentProject, GeneratedContent, Campaign, Usage } from '../models';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/stats
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [
      totalProjects,
      totalGenerated,
      totalCampaigns,
      publishedProjects,
      usage,
    ] = await Promise.all([
      ContentProject.countDocuments({ workspaceId: req.workspaceId }),
      GeneratedContent.countDocuments({ workspaceId: req.workspaceId }),
      Campaign.countDocuments({ workspaceId: req.workspaceId }),
      ContentProject.countDocuments({ workspaceId: req.workspaceId, status: 'ready' }),
      Usage.findOne({ workspaceId: req.workspaceId, month }),
    ]);

    res.json({
      success: true,
      data: {
        contentCreated: totalProjects,
        piecesGenerated: totalGenerated,
        campaignsCreated: totalCampaigns,
        contentPublished: publishedProjects,
        usage: usage || { minutesProcessed: 0, generations: 0, projects: 0, exports: 0 },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
