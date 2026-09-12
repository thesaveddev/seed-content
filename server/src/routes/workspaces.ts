import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { Workspace, WorkspaceMember, Usage } from '../models';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/workspaces - Get user's workspaces
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const memberships = await WorkspaceMember.find({ userId: req.userId });
    const workspaceIds = memberships.map((m: any) => m.workspaceId);
    const workspaces = [];
    for (const wid of workspaceIds) {
      const ws = await Workspace.findById(wid);
      if (ws) workspaces.push(ws);
    }

    res.json({ success: true, data: workspaces });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/workspaces - Create workspace
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;

    const workspace = await Workspace.create({
      name,
      ownerId: req.userId,
      plan: 'free',
    });

    await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: req.userId,
      role: 'owner',
    });

    res.status(201).json({ success: true, data: workspace });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/workspaces/current - Get current workspace
router.get('/current', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usage = await Usage.findOne({ workspaceId: workspace._id, month });

    const wsObj = workspace.toObject ? workspace.toObject() : workspace;

    res.json({
      success: true,
      data: {
        ...wsObj,
        usage: usage || { minutesProcessed: 0, generations: 0, projects: 0, exports: 0 },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/workspaces/current - Update current workspace
router.put('/current', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    const workspace = await Workspace.findOneAndUpdate(
      { _id: req.workspaceId },
      { name },
      { new: true }
    );

    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    res.json({ success: true, data: workspace });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
