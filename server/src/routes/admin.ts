import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  User,
  Workspace,
  WorkspaceMember,
  ContentProject,
  GeneratedContent,
  ScheduledPost,
} from '../models';
import { AuthRequest } from '../types';

const router = Router();

// Every admin route: authenticate (also enforces non-disabled) then
// requireAdmin (re-verified against the database on each call).
router.use(authenticate, requireAdmin);

// ── GET /api/admin/overview — platform-wide stats ────────────────
router.get('/overview', async (_req: AuthRequest, res: Response) => {
  try {
    const month = new Date().toISOString().slice(0, 7);

    const [
      totalUsers,
      activeUsers,
      disabledUsers,
      adminCount,      totalWorkspaces,
      planCounts,
      totalProjects,
      projectsThisMonth,
      totalGenerated,
      scheduledUpcoming,
      postsPublished,
    ] = await Promise.all([
      User.countDocuments({}),
      // Users without a status field (created pre-admin-feature) count as active
      User.countDocuments({ status: { $ne: 'disabled' } }),
      User.countDocuments({ status: 'disabled' }),
      User.countDocuments({ isAdmin: true }),
      Workspace.countDocuments({}),
      Workspace.aggregate([
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]),
      ContentProject.countDocuments({}),
      ContentProject.countDocuments({
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      }),
      GeneratedContent.countDocuments({}),
      ScheduledPost.countDocuments({ status: 'scheduled', scheduledAt: { $gte: new Date() } }),
      ScheduledPost.countDocuments({ status: 'published' }),
    ]);

    const plans: Record<string, number> = { free: 0, creator: 0, pro: 0, agency: 0 };
    for (const row of planCounts as any[]) {
      if (row?._id && row._id in plans) plans[row._id] = row.count;
    }

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers, disabled: disabledUsers, admins: adminCount },
        workspaces: { total: totalWorkspaces, plans },
        content: { totalProjects, projectsThisMonth, totalGenerated },
        scheduling: { scheduledUpcoming, published: postsPublished },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/admin/users — list users with usage + pagination ────
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;

    const query: Record<string, any> = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }
    if (status === 'active' || status === 'disabled') {
      query.status = status;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(query),
    ]);

    // Attach workspace + usage info per user
    const enriched = await Promise.all(
      users.map(async (u: any) => {
        const membership = await WorkspaceMember.findOne({ userId: u._id });
        const workspace = membership ? await Workspace.findById(membership.workspaceId) : null;
        const projectCount = await ContentProject.countDocuments({ createdBy: u._id });

        return {
          id: u._id,
          email: u.email,
          name: u.name,
          isAdmin: !!u.isAdmin,
          status: u.status || 'active',
          createdAt: u.createdAt,
          workspace: workspace
            ? { id: workspace._id, name: workspace.name, plan: workspace.plan }
            : null,
          projectCount,
        };
      })
    );

    res.json({
      success: true,
      data: enriched,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/admin/users/:id — user detail ───────────────────────
router.get('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const [memberships, projects] = await Promise.all([
      WorkspaceMember.find({ userId: user._id }),
      ContentProject.find({ createdBy: user._id }).sort({ createdAt: -1 }).limit(10),
    ]);

    const workspaces = await Promise.all(
      memberships.map(async (m: any) => {
        const ws = await Workspace.findById(m.workspaceId);
        return ws
          ? { id: ws._id, name: ws.name, plan: ws.plan, role: m.role }
          : null;
      })
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          isAdmin: !!user.isAdmin,
          status: user.status || 'active',
          onboardingCompleted: user.onboardingCompleted,
          createdAt: user.createdAt,
        },
        workspaces: workspaces.filter(Boolean),
        recentProjects: projects,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── PUT /api/admin/users/:id/status — disable / re-enable ────────
router.put('/users/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (status !== 'active' && status !== 'disabled') {
      res.status(400).json({ success: false, error: 'status must be "active" or "disabled"' });
      return;
    }

    const target = await User.findById(req.params.id).select('+isAdmin');
    if (!target) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Safety: an admin cannot disable themselves, and cannot disable
    // the last remaining admin (keeps the platform operable).
    if ((target as any).isAdmin) {
      if (req.userId === target._id.toString()) {
        res.status(400).json({ success: false, error: 'You cannot disable your own admin account.' });
        return;
      }
      const adminCount = await User.countDocuments({ isAdmin: true, status: { $ne: 'disabled' } });
      if (adminCount <= 1) {
        res.status(400).json({ success: false, error: 'Cannot disable the last active admin.' });
        return;
      }
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({
      success: true,
      data: { id: updated!._id, status: updated!.status },
      message: status === 'disabled' ? 'Account disabled' : 'Account re-enabled',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── PUT /api/admin/users/:id/admin — grant / revoke admin ────────
router.put('/users/:id/admin', async (req: AuthRequest, res: Response) => {
  try {
    const { isAdmin } = req.body;
    if (typeof isAdmin !== 'boolean') {
      res.status(400).json({ success: false, error: 'isAdmin must be a boolean' });
      return;
    }

    // Safety: cannot revoke your own admin (would lock you out mid-action)
    if (!isAdmin && req.userId === req.params.id) {
      res.status(400).json({ success: false, error: 'You cannot revoke your own admin access.' });
      return;
    }

    const target = await User.findById(req.params.id);
    if (!target) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Never leave the platform without an active admin
    if (!isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true, status: { $ne: 'disabled' } });
      if (adminCount <= 1) {
        res.status(400).json({ success: false, error: 'Cannot remove the last active admin.' });
        return;
      }
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { isAdmin },
      { new: true }
    );

    res.json({
      success: true,
      data: { id: updated!._id, isAdmin: !!(updated as any).isAdmin },
      message: isAdmin ? 'Admin access granted' : 'Admin access revoked',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/admin/workspaces — list workspaces with usage ───────
router.get('/workspaces', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));

    const [workspaces, total] = await Promise.all([
      Workspace.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Workspace.countDocuments({}),
    ]);

    const enriched = await Promise.all(
      workspaces.map(async (ws: any) => {
        const [members, projectCount, generatedCount] = await Promise.all([
          WorkspaceMember.find({ workspaceId: ws._id }),
          ContentProject.countDocuments({ workspaceId: ws._id }),
          GeneratedContent.countDocuments({ workspaceId: ws._id }),
        ]);

        const memberDetails = await Promise.all(
          members.map(async (m: any) => {
            const u = await User.findById(m.userId);
            return u ? { id: u._id, name: u.name, email: u.email, role: m.role } : null;
          })
        );

        return {
          id: ws._id,
          name: ws.name,
          plan: ws.plan,
          createdAt: ws.createdAt,
          memberCount: members.length,
          members: memberDetails.filter(Boolean),
          projectCount,
          generatedCount,
        };
      })
    );

    res.json({
      success: true,
      data: enriched,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
