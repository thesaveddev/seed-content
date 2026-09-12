import { Router, Response } from 'express';
import { z } from 'zod';
import { User } from '../models';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../types';

const router = Router();

// Mask an API key for safe display: "sk-...abc123"
function maskKey(key: string): string {
  if (!key || key.length < 10) return '***';
  return key.slice(0, 3) + '...' + key.slice(-6);
}

// Validate OpenAI key format
function isValidOpenAIKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(key);
}

// GET /api/settings/api-key — Get masked API key status
router.get('/api-key', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId).select('+openaiApiKey');
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const key = (user as any).openaiApiKey as string | undefined;
    res.json({
      success: true,
      data: {
        configured: !!key,
        maskedKey: key ? maskKey(key) : null,
        provider: 'openai',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/api-key — Save or update API key
router.put('/api-key', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { apiKey, remove } = req.body;

    const user = await User.findById(req.userId).select('+openaiApiKey');
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Remove key
    if (remove) {
      (user as any).openaiApiKey = undefined;
      await user.save();
      res.json({ success: true, data: { configured: false, message: 'API key removed' } });
      return;
    }

    // Validate key
    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({ success: false, error: 'API key is required' });
      return;
    }

    if (!isValidOpenAIKey(apiKey.trim())) {
      res.status(400).json({ success: false, error: 'Invalid OpenAI API key format. Key should start with sk- and contain only letters, numbers, underscores, and hyphens.' });
      return;
    }

    (user as any).openaiApiKey = apiKey.trim();
    await user.save();

    res.json({
      success: true,
      data: {
        configured: true,
        maskedKey: maskKey(apiKey.trim()),
        message: 'API key saved',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/profile — Update user profile
router.put('/profile', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    if (name && typeof name === 'string' && name.trim()) {
      user.name = name.trim();
    }
    if (email && typeof email === 'string' && email.trim()) {
      // Check uniqueness
      const existing = await User.findOne({ email: email.trim().toLowerCase(), _id: { $ne: user._id } });
      if (existing) {
        res.status(409).json({ success: false, error: 'Email already in use' });
        return;
      }
      user.email = email.trim().toLowerCase();
    }
    await user.save();

    res.json({
      success: true,
      data: { user: { id: user._id, name: user.name, email: user.email } },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/password — Change password
router.put('/password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, error: 'Current and new passwords are required' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
      return;
    }

    const bcrypt = await import('bcryptjs');
    const user = await User.findById(req.userId).select('+passwordHash');
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const valid = await bcrypt.default.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Current password is incorrect' });
      return;
    }

    const salt = await bcrypt.default.genSalt(12);
    user.passwordHash = await bcrypt.default.hash(newPassword, salt);
    await user.save();

    res.json({ success: true, message: 'Password updated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
