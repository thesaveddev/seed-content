import { Router, Response } from 'express';
import { resolveMediaPath, verifyMediaSignature } from '../services/media';
import fs from 'fs';

const router = Router();

/**
 * GET /api/media/:file?expires=...&sig=...
 *
 * Serves publicly-hosted media (image cards) that platform servers
 * (Instagram/TikTok) fetch by URL when publishing. Access requires a
 * valid HMAC signature + unexpired timestamp — no auth cookie, because
 * the caller is a platform server.
 */
router.get('/:file', async (req: any, res: Response) => {
  try {
    const file = String(req.params.file || '');
    const expires = req.query.expires as string | undefined;
    const sig = req.query.sig as string | undefined;

    if (!verifyMediaSignature(file, expires, sig)) {
      res.status(403).json({ success: false, error: 'Invalid or expired media link' });
      return;
    }

    const filePath = resolveMediaPath(file);
    if (!filePath) {
      res.status(404).json({ success: false, error: 'Media not found' });
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
