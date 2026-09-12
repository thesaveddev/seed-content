import { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { ContentProject } from '../models';

// In-memory SSE connections: projectId -> Set of response objects
const connections = new Map<string, Set<Response>>();

// Called from content pipeline to push status updates
export function notifyStatusChange(projectId: string, status: string) {
  const listeners = connections.get(projectId);
  if (!listeners) return;
  const data = JSON.stringify({ projectId, status, timestamp: new Date().toISOString() });
  for (const res of listeners) {
    res.write(`data: ${data}\n\n`);
  }
  // Auto-close if terminal status
  if (['ready', 'failed', 'archived'].includes(status)) {
    for (const res of listeners) {
      res.end();
    }
    connections.delete(projectId);
  }
}

// GET /api/content/:id/events — SSE stream
export function sseHandler(req: AuthRequest, res: Response) {
  const projectId = req.params.id;
  if (!projectId) {
    res.status(400).json({ success: false, error: 'Project ID required' });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial heartbeat
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Register listener
  if (!connections.has(projectId)) connections.set(projectId, new Set());
  connections.get(projectId)!.add(res);

  // Clean up on disconnect
  req.on('close', () => {
    connections.get(projectId)?.delete(res);
    if (connections.get(projectId)?.size === 0) connections.delete(projectId);
  });

  // Send heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => clearInterval(heartbeat));
}
