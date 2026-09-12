import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { ScheduledPost, GeneratedContent } from '../models';

const router = Router();

// GET /api/scheduler — list scheduled posts (with date range filter)
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, status, platform } = req.query;
    const query: any = { workspaceId: req.workspaceId };

    if (from || to) {
      query.scheduledAt = {};
      if (from) query.scheduledAt.$gte = new Date(from as string);
      if (to) query.scheduledAt.$lte = new Date(to as string);
    }
    if (status) query.status = status;
    if (platform) query.platform = platform;

    const posts = await ScheduledPost.find(query).sort({ scheduledAt: 1 });
    res.json({ success: true, data: posts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/scheduler/:id — get single scheduled post
router.get('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const post = await ScheduledPost.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!post) {
      res.status(404).json({ success: false, error: 'Scheduled post not found' });
      return;
    }
    res.json({ success: true, data: post });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/scheduler — create a scheduled post
router.post('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, generatedContentId, platform, scheduledAt, notes } = req.body;

    if (!projectId || !generatedContentId || !platform || !scheduledAt) {
      res.status(400).json({ success: false, error: 'projectId, generatedContentId, platform, and scheduledAt are required' });
      return;
    }

    const date = new Date(scheduledAt);
    if (isNaN(date.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid scheduledAt date' });
      return;
    }
    if (date < new Date()) {
      res.status(400).json({ success: false, error: 'Cannot schedule in the past' });
      return;
    }

    // Verify the generated content exists and belongs to this workspace
    const gc = await GeneratedContent.findOne({ _id: generatedContentId, workspaceId: req.workspaceId });
    if (!gc) {
      res.status(404).json({ success: false, error: 'Generated content not found' });
      return;
    }

    const post = await ScheduledPost.create({
      workspaceId: req.workspaceId,
      projectId,
      generatedContentId,
      platform,
      scheduledAt: date,
      notes: notes || '',
      status: 'scheduled',
    });

    res.status(201).json({ success: true, data: post });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/scheduler/:id — reschedule or update notes
router.put('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const post = await ScheduledPost.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!post) {
      res.status(404).json({ success: false, error: 'Scheduled post not found' });
      return;
    }

    const { scheduledAt, notes, status } = req.body;
    const updates: any = {};

    if (scheduledAt) {
      const date = new Date(scheduledAt);
      if (isNaN(date.getTime())) {
        res.status(400).json({ success: false, error: 'Invalid scheduledAt date' });
        return;
      }
      if (date < new Date()) {
        res.status(400).json({ success: false, error: 'Cannot schedule in the past' });
        return;
      }
      updates.scheduledAt = date;
    }

    if (notes !== undefined) updates.notes = notes;

    // Allow cancelling or marking as published
    if (status && ['cancelled', 'published'].includes(status)) {
      updates.status = status;
      if (status === 'published') updates.publishedAt = new Date();
    }

    const updated = await ScheduledPost.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      { $set: updates },
      { new: true }
    );

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/scheduler/:id/cancel — cancel a scheduled post
router.put('/:id/cancel', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const updated = await ScheduledPost.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId, status: 'scheduled' },
      { $set: { status: 'cancelled' } },
      { new: true }
    );

    if (!updated) {
      res.status(404).json({ success: false, error: 'Scheduled post not found or already processed' });
      return;
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/scheduler/:id — delete a scheduled post
router.delete('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await ScheduledPost.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Scheduled post not found' });
      return;
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/scheduler — clear all scheduled posts for workspace
router.delete('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    await ScheduledPost.deleteMany({ workspaceId: req.workspaceId, status: 'scheduled' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
