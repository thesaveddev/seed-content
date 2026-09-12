import { Router, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest, PLAN_LIMITS } from '../types';
import { authenticate, requireWorkspace, requireRole } from '../middleware/auth';
import { Workspace, WorkspaceMember, User, Invite, BrandVoice } from '../models';

const router = Router();

// GET /api/team/members — list all members in workspace
router.get('/members', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const members = await WorkspaceMember.find({ workspaceId: req.workspaceId });
    // Enrich with user info
    const enriched = [];
    for (const m of members) {
      const user = await User.findById(m.userId);
      enriched.push({
        _id: m._id,
        userId: m.userId,
        workspaceId: m.workspaceId,
        role: m.role,
        createdAt: m.createdAt,
        user: user ? { name: user.name, email: user.email, avatar: user.avatar } : null,
      });
    }
    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/team/invite — send an invite
router.post('/invite', authenticate, requireWorkspace, requireRole('owner', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, role = 'member' } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user is already a member
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const existingMember = await WorkspaceMember.findOne({
        workspaceId: req.workspaceId,
        userId: existingUser._id,
      });
      if (existingMember) {
        res.status(409).json({ success: false, error: 'User is already a member of this workspace' });
        return;
      }
    }

    // Check for pending invite
    const pendingInvite = await Invite.findOne({
      workspaceId: req.workspaceId,
      email: normalizedEmail,
      acceptedAt: undefined,
      expiresAt: { $gt: new Date() },
    });
    if (pendingInvite) {
      res.status(409).json({ success: false, error: 'An invite is already pending for this email' });
      return;
    }

    // Check member limit based on plan
    const workspace = await Workspace.findById(req.workspaceId);
    const plan = workspace?.plan || 'free';
    if (plan === 'free') {
      res.status(403).json({ success: false, error: 'Upgrade your plan to invite team members' });
      return;
    }

    const memberCount = await WorkspaceMember.countDocuments({ workspaceId: req.workspaceId });
    const limits: Record<string, number> = { creator: 5, pro: 20, agency: -1 };
    const maxMembers = limits[plan] || 5;
    if (maxMembers > 0 && memberCount >= maxMembers) {
      res.status(403).json({ success: false, error: `Your ${plan} plan allows up to ${maxMembers} members. Upgrade for more.` });
      return;
    }

    // Validate role
    const validRoles = ['admin', 'member', 'viewer'];
    const assignRole = validRoles.includes(role) ? role : 'member';

    // Create invite
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const invite = await Invite.create({
      workspaceId: req.workspaceId,
      token,
      email: normalizedEmail,
      role: assignRole,
      invitedBy: req.userId,
      expiresAt,
    });

    res.status(201).json({
      success: true,
      data: {
        _id: invite._id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        expiresAt: invite.expiresAt,
        inviteLink: `/accept-invite?token=${invite.token}`,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/team/invites — list pending invites
router.get('/invites', authenticate, requireWorkspace, requireRole('owner', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const invites = await Invite.find({
      workspaceId: req.workspaceId,
      acceptedAt: undefined,
      expiresAt: { $gt: new Date() },
    });

    const enriched = [];
    for (const inv of invites) {
      const inviter = await User.findById(inv.invitedBy);
      enriched.push({
        _id: inv._id,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        invitedBy: inviter ? inviter.name : 'Unknown',
      });
    }

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/team/invites/:id — revoke an invite
router.delete('/invites/:id', authenticate, requireWorkspace, requireRole('owner', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    await Invite.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/team/accept-invite — accept an invite (public, needs auth)
router.post('/accept-invite', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ success: false, error: 'Invite token is required' });
      return;
    }

    const invite = await Invite.findOne({
      token,
      acceptedAt: undefined,
      expiresAt: { $gt: new Date() },
    });

    if (!invite) {
      res.status(404).json({ success: false, error: 'Invite not found or expired' });
      return;
    }

    // Check if user's email matches invite email
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    if (user.email !== invite.email) {
      res.status(403).json({ success: false, error: 'This invite is for a different email address' });
      return;
    }

    // Check if already a member
    const existing = await WorkspaceMember.findOne({
      workspaceId: invite.workspaceId,
      userId: req.userId,
    });
    if (existing) {
      res.status(409).json({ success: false, error: 'You are already a member of this workspace' });
      return;
    }

    // Add as workspace member
    await WorkspaceMember.create({
      workspaceId: invite.workspaceId,
      userId: req.userId,
      role: invite.role,
    });

    // Mark invite as accepted
    await Invite.findOneAndUpdate(
      { _id: invite._id },
      { $set: { acceptedAt: new Date() } }
    );

    const workspace = await Workspace.findById(invite.workspaceId);

    res.json({
      success: true,
      data: {
        workspaceId: invite.workspaceId,
        workspaceName: workspace?.name,
        role: invite.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/team/members/:id/role — update a member's role
router.put('/members/:id/role', authenticate, requireWorkspace, requireRole('owner'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;
    const validRoles = ['admin', 'member', 'viewer'];

    if (!validRoles.includes(role)) {
      res.status(400).json({ success: false, error: `Role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const member = await WorkspaceMember.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!member) {
      res.status(404).json({ success: false, error: 'Member not found' });
      return;
    }

    // Can't change owner's role
    if (member.role === 'owner') {
      res.status(403).json({ success: false, error: 'Cannot change the owner role' });
      return;
    }

    // Can't change your own role
    if (member.userId === req.userId) {
      res.status(403).json({ success: false, error: 'Cannot change your own role' });
      return;
    }

    const updated = await WorkspaceMember.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { new: true }
    );

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/team/members/:id — remove a member
router.delete('/members/:id', authenticate, requireWorkspace, requireRole('owner', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const member = await WorkspaceMember.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!member) {
      res.status(404).json({ success: false, error: 'Member not found' });
      return;
    }

    // Can't remove owner
    if (member.role === 'owner') {
      res.status(403).json({ success: false, error: 'Cannot remove the workspace owner' });
      return;
    }

    // Admins can only remove members/viewers, not other admins
    if (req.userRole === 'admin' && member.role === 'admin') {
      res.status(403).json({ success: false, error: 'Admins cannot remove other admins' });
      return;
    }

    // Can't remove yourself
    if (member.userId === req.userId) {
      res.status(403).json({ success: false, error: 'Use leave workspace instead' });
      return;
    }

    await WorkspaceMember.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/team/brand-voices — shared brand voices for workspace
router.get('/brand-voices', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const voices = await BrandVoice.find({ workspaceId: req.workspaceId });
    res.json({ success: true, data: voices });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/team/leave — leave workspace (can't leave if you're the only owner)
router.post('/leave', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const member = await WorkspaceMember.findOne({
      userId: req.userId,
      workspaceId: req.workspaceId,
    });

    if (!member) {
      res.status(404).json({ success: false, error: 'Not a member of this workspace' });
      return;
    }

    if (member.role === 'owner') {
      // Check if there are other owners
      const otherOwners = await WorkspaceMember.find({
        workspaceId: req.workspaceId,
        role: 'owner',
        userId: { $ne: req.userId },
      });
      if (otherOwners.length === 0) {
        res.status(403).json({ success: false, error: 'You are the only owner. Transfer ownership before leaving.' });
        return;
      }
    }

    await WorkspaceMember.findOneAndDelete({
      userId: req.userId,
      workspaceId: req.workspaceId,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
