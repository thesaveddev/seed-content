import { Router, Response } from 'express';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { ContentIdea } from '../models';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/ideas
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const query: any = { workspaceId: req.workspaceId };
    if (status) query.status = status;

    const ideas = await ContentIdea.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: ideas });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ideas
router.post('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const idea = await ContentIdea.create({
      workspaceId: req.workspaceId,
      ...req.body,
    });
    res.status(201).json({ success: true, data: idea });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/ideas/:id
router.put('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const idea = await ContentIdea.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      req.body,
      { new: true }
    );
    if (!idea) {
      res.status(404).json({ success: false, error: 'Idea not found' });
      return;
    }
    res.json({ success: true, data: idea });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/ideas/:id
router.delete('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const idea = await ContentIdea.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });
    if (!idea) {
      res.status(404).json({ success: false, error: 'Idea not found' });
      return;
    }
    res.json({ success: true, message: 'Idea deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
