import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { AuthRequest } from '../types';
import { WorkspaceMember } from '../models';

interface JwtPayload {
  userId: string;
  workspaceId?: string;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;

    // Enforce account status on every request: disabled users are locked out
    // everywhere, immediately (no waiting for token expiry).
    const { User } = await import('../models');
    const user = await (User as any).findById(decoded.userId).select('+status +isAdmin');
    if (!user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    if (user.status === 'disabled') {
      res.status(403).json({ success: false, error: 'This account has been disabled. Contact support.' });
      return;
    }

    req.userId = decoded.userId;
    if (decoded.workspaceId) {
      req.workspaceId = decoded.workspaceId;
    }
    if (user.isAdmin) {
      req.isAdmin = true;
    }
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function requireWorkspace(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.workspaceId) {
    res.status(400).json({ success: false, error: 'Workspace context required' });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userId || !req.workspaceId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    // Check role from workspace member record
    WorkspaceMember.findOne({ userId: req.userId, workspaceId: req.workspaceId })
      .then((member: any) => {
        if (!member || !roles.includes(member.role)) {
          res.status(403).json({ success: false, error: 'Insufficient permissions' });
          return;
        }
        req.userRole = member.role;
        next();
      })
      .catch(() => {
        res.status(500).json({ success: false, error: 'Authorization check failed' });
      });
  };
}

/**
 * Platform-admin gate. Verifies against the database so admin revocation
 * takes effect immediately (the JWT claim only drives the UI).
 */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  try {
    const { User } = await import('../models');
    const user = await (User as any).findById(req.userId).select('+isAdmin +status');
    if (!user || !user.isAdmin || user.status === 'disabled') {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export function generateToken(userId: string, workspaceId?: string, isAdmin = false): string {
  const payload: JwtPayload & { isAdmin?: boolean } = { userId };
  if (workspaceId) payload.workspaceId = workspaceId;
  if (isAdmin) payload.isAdmin = true;
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as any });
}
