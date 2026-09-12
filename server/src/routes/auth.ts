import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { User, Workspace, WorkspaceMember } from '../models';
import { authenticate, generateToken } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../types';
import { emailService } from '../services/email';
import { config } from '../config/env';

const router = Router();

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1).max(100),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
});

// POST /api/auth/register
router.post('/register', validate(registerSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name } = req.body;

    // Check if user exists
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already registered' });
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({ email, passwordHash, name });

    // Create default workspace
    const workspace = await Workspace.create({
      name: `${name}'s Workspace`,
      ownerId: user._id,
      plan: 'free',
    });

    // Add user as workspace owner
    await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: 'owner',
    });

    // Generate token
    const token = generateToken(user._id.toString(), workspace._id.toString());

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({
      success: true,
      data: {
        user: { id: user._id, email: user.email, name: user.name, onboardingCompleted: user.onboardingCompleted },
        workspace: { id: workspace._id, name: workspace.name, plan: workspace.plan },
        token,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+passwordHash +isAdmin');
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Disabled accounts cannot log in
    if ((user as any).status === 'disabled') {
      res.status(403).json({ success: false, error: 'This account has been disabled. Contact support.' });
      return;
    }

    // Get user's workspace — resolve directly to work with both real and in-memory DB
    const membership = await WorkspaceMember.findOne({ userId: user._id });
    const workspaceId = membership?.workspaceId as any;
    const workspace = workspaceId ? await Workspace.findById(workspaceId) : null;

    const token = generateToken(
      user._id.toString(),
      workspace?._id?.toString(),
      !!(user as any).isAdmin
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          isAdmin: !!(user as any).isAdmin,
          onboardingCompleted: user.onboardingCompleted,
          onboardingData: user.onboardingData,
        },
        workspace: workspace ? { id: workspace._id, name: workspace.name, plan: workspace.plan } : null,
        token,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req: AuthRequest, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId).select('+isAdmin');
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const membership = await WorkspaceMember.findOne({ userId: user._id });
    const workspaceId = membership?.workspaceId as any;
    const workspace = workspaceId ? await Workspace.findById(workspaceId) : null;

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          isAdmin: !!(user as any).isAdmin,
          onboardingCompleted: user.onboardingCompleted,
          onboardingData: user.onboardingData,
        },
        workspace: workspace ? { id: workspace._id, name: workspace.name, plan: workspace.plan } : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal whether email exists
      res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetHash = await bcrypt.hash(resetToken, 12);

    user.resetPasswordToken = resetHash;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${config.FRONTEND_URL}/reset-password?token=${resetToken}`;
    await emailService.sendPasswordReset(email, resetToken, resetUrl);

    res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: AuthRequest, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ success: false, error: 'Token and password are required' });
      return;
    }

    const user = await User.findOne({
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user || !user.resetPasswordToken) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
      return;
    }

    const valid = await bcrypt.compare(token, user.resetPasswordToken);
    if (!valid) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
      return;
    }

    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/auth/onboarding
router.put('/onboarding', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    user.onboardingData = req.body;
    user.onboardingCompleted = true;
    await user.save();

    res.json({ success: true, data: { user: { onboardingCompleted: true } } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
