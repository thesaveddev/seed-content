import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { AuthRequest } from '../types';
import { WorkspaceMember } from '../models';

interface JwtPayload {
  userId: string;
  workspaceId?: string;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.userId = decoded.userId;
    if (decoded.workspaceId) {
      req.workspaceId = decoded.workspaceId;
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

    // Check owner role from workspace member record
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

export function generateToken(userId: string, workspaceId?: string): string {
  const payload: JwtPayload = { userId };
  if (workspaceId) payload.workspaceId = workspaceId;
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as any });
}
