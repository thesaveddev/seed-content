import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ContentProject, GeneratedContent, Workspace, Usage, BrandVoice as BrandVoiceModel, Campaign as CampaignModel } from '../models';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { AuthRequest, PLAN_LIMITS } from '../types';
import { addContentProcessingJob } from '../services/queue';
import { storage } from '../services/storage';
import { contentPipeline } from '../services/content/pipeline';

const router = Router();

// Helper: enforce plan limits for a workspace
async function enforcePlanLimits(workspaceId: string | undefined, opts: {
  file?: { size: number };
  platforms?: string[];
  brandVoiceId?: string;
  campaignId?: string;
} = {}): Promise<{ ok: true; workspace: any; planLimits: any; month: string } | { ok: false; status: number; error: string }> {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return { ok: false, status: 404, error: 'Workspace not found' };

  const planLimits = PLAN_LIMITS[workspace.plan] || PLAN_LIMITS.free;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const usage = await Usage.findOne({ workspaceId: workspace._id, month });

  // Projects per month — check both Usage counter AND actual project count (pipeline is async)
  const projectCount = await ContentProject.countDocuments({ workspaceId: workspace._id });
  const effectiveCount = Math.max(usage?.projects || 0, projectCount);
  if (effectiveCount >= planLimits.projectsPerMonth) {
    return { ok: false, status: 429, error: `You've reached your ${workspace.plan} plan limit of ${planLimits.projectsPerMonth} projects this month. Upgrade your plan for more.` };
  }

  // File size
  if (opts.file && opts.file.size > planLimits.maxFileSize * 1024 * 1024) {
    return { ok: false, status: 413, error: `File too large. Your ${workspace.plan} plan allows up to ${planLimits.maxFileSize}MB.` };
  }

  // Platforms
  if (opts.platforms && planLimits.supportedPlatforms.length > 0) {
    const blocked = opts.platforms.filter((p) => !planLimits.supportedPlatforms.includes(p as any));
    if (blocked.length > 0) {
      return { ok: false, status: 403, error: `Your ${workspace.plan} plan does not support: ${blocked.join(', ')}. Upgrade for all platforms.` };
    }
  }

  // Brand voices
  if (opts.brandVoiceId) {
    const voiceCount = await BrandVoiceModel.countDocuments({ workspaceId: workspace._id });
    if (planLimits.brandVoices >= 0 && voiceCount >= planLimits.brandVoices) {
      return { ok: false, status: 403, error: `Your ${workspace.plan} plan allows ${planLimits.brandVoices} brand voice${planLimits.brandVoices !== 1 ? 's' : ''}. Upgrade for more.` };
    }
  }

  // Campaigns
  if (opts.campaignId) {
    const campaignCount = await CampaignModel.countDocuments({ workspaceId: workspace._id });
    if (planLimits.campaigns >= 0 && campaignCount >= planLimits.campaigns) {
      return { ok: false, status: 403, error: `Your ${workspace.plan} plan allows ${planLimits.campaigns} campaign${planLimits.campaigns !== 1 ? 's' : ''}. Upgrade for more.` };
    }
  }

  return { ok: true, workspace, planLimits, month };
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: './uploads',
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
      'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/mp4',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
});

// GET /api/content - List projects
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status, search } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const query: any = { workspaceId: req.workspaceId };
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
      ];
    }

    const [projects, total] = await Promise.all([
      ContentProject.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      ContentProject.countDocuments(query),
    ]);

    // Get generated content counts for each project
    const projectIds = projects.map((p: any) => p._id);
    const counts = await GeneratedContent.aggregate([
      { $match: { projectId: { $in: projectIds } } },
      { $group: { _id: '$projectId', count: { $sum: 1 }, platforms: { $addToSet: '$platform' } } },
    ]);

    const countMap = new Map<string, any>(counts.map((c: any) => [c._id.toString(), c]));

    const enriched = projects.map((p: any) => ({
      ...p,
      generatedCount: countMap.get(p._id.toString())?.count || 0,
      platforms: countMap.get(p._id.toString())?.platforms || [],
    }));

    res.json({
      success: true,
      data: enriched,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content - Create project and upload file
router.post('/', authenticate, requireWorkspace, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const { title, goal, selectedPlatforms, brandVoiceId, campaignId, sourceType = 'video' } = req.body;
    const platforms = selectedPlatforms ? JSON.parse(selectedPlatforms) : ['linkedin', 'x', 'instagram'];

    const limitCheck = await enforcePlanLimits(req.workspaceId, {
      file: req.file ? { size: req.file.size } : undefined,
      platforms,
    });
    if (!limitCheck.ok) {
      res.status(limitCheck.status).json({ success: false, error: limitCheck.error });
      return;
    }
    const { workspace, planLimits, month } = limitCheck;

    let storedFile: string | undefined;
    if (req.file) {
      // Read the uploaded file and store via storage provider
      const fs = await import('fs');
      const fileBuffer = fs.readFileSync(req.file.path);
      storedFile = await storage.upload(fileBuffer, req.file.originalname, req.file.mimetype);

      // Remove temp file
      fs.unlinkSync(req.file.path);
    }

    const project = await ContentProject.create({
      workspaceId: req.workspaceId,
      createdBy: req.userId,
      title: title || 'Untitled Content',
      sourceType: req.file ? (req.file.mimetype.startsWith('video') ? 'video' : 'audio') : sourceType,
      sourceFile: storedFile,
      sourceUrl: req.body.sourceUrl,
      goal: goal || 'auto',
      selectedPlatforms: selectedPlatforms ? JSON.parse(selectedPlatforms) : ['linkedin', 'x', 'instagram'],
      brandVoiceId: brandVoiceId || undefined,
      campaignId: campaignId || undefined,
      status: 'uploading',
    });

    // Queue processing job
    const jobId = await addContentProcessingJob({
      projectId: project._id.toString(),
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      sourceType: project.sourceType,
      sourceFile: storedFile,
      sourceUrl: project.sourceUrl,
      goal: project.goal,
      selectedPlatforms: project.selectedPlatforms,
      brandVoiceId: brandVoiceId || undefined,
    });

    project.jobId = jobId;
    project.status = 'processing';
    await project.save();

    res.status(201).json({
      success: true,
      data: project,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content/text - Create from pasted text
router.post('/text', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { title, text, goal, selectedPlatforms, brandVoiceId, campaignId } = req.body;

    if (!text || text.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Text content is required' });
      return;
    }

    const limitCheck = await enforcePlanLimits(req.workspaceId, {
      platforms: selectedPlatforms || ['linkedin', 'x', 'instagram'],
    });
    if (!limitCheck.ok) {
      res.status(limitCheck.status).json({ success: false, error: limitCheck.error });
      return;
    }
    const { workspace, planLimits, month } = limitCheck;

    const project = await ContentProject.create({
      workspaceId: req.workspaceId,
      createdBy: req.userId,
      title: title || 'Untitled Content',
      sourceType: 'text',
      transcript: text,
      goal: goal || 'auto',
      selectedPlatforms: selectedPlatforms || ['linkedin', 'x', 'instagram'],
      brandVoiceId: brandVoiceId || undefined,
      campaignId: campaignId || undefined,
      status: 'processing',
    });

    // Process inline (no file upload needed)
    const jobId = await addContentProcessingJob({
      projectId: project._id.toString(),
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      sourceType: 'text',
      goal: project.goal,
      selectedPlatforms: project.selectedPlatforms,
      brandVoiceId,
    });

    project.jobId = jobId;
    await project.save();

    res.status(201).json({ success: true, data: project });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/content/:id - Get project details
router.get('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const project = await ContentProject.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const generatedContent = await GeneratedContent.find({
      projectId: project._id,
    }).sort({ platform: 1 });

    res.json({
      success: true,
      data: { project, generatedContent },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/content/:id/status - Get processing status
router.get('/:id/status', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const project = await ContentProject.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    }).select('status errorMessage title');

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    res.json({ success: true, data: project });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content/:id/generate - Regenerate all
router.post('/:id/generate', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const project = await ContentProject.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    // Delete existing generated content
    await GeneratedContent.deleteMany({ projectId: project._id });

    // Re-queue
    project.status = 'processing';
    await project.save();

    const jobId = await addContentProcessingJob({
      projectId: project._id.toString(),
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      sourceType: project.sourceType,
      sourceFile: project.sourceFile,
      sourceUrl: project.sourceUrl,
      goal: project.goal,
      selectedPlatforms: project.selectedPlatforms,
      brandVoiceId: project.brandVoiceId?.toString(),
    });

    project.jobId = jobId;
    await project.save();

    res.json({ success: true, data: project });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content/:id/regenerate/:platform - Regenerate for specific platform
router.post('/:id/regenerate/:platform', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const project = await ContentProject.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    // Delete existing content for this platform
    await GeneratedContent.deleteMany({
      projectId: project._id,
      platform: req.params.platform,
    });

    // Re-queue with specific platform
    project.status = 'processing';
    await project.save();

    const jobId = await addContentProcessingJob({
      projectId: project._id.toString(),
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      sourceType: project.sourceType,
      sourceFile: project.sourceFile,
      sourceUrl: project.sourceUrl,
      goal: project.goal,
      selectedPlatforms: [req.params.platform],
      brandVoiceId: project.brandVoiceId?.toString(),
    });

    project.jobId = jobId;
    await project.save();

    res.json({ success: true, data: project });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/content/:id/transcript - Edit transcript
router.put('/:id/transcript', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { transcript } = req.body;
    const project = await ContentProject.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      { transcript },
      { new: true }
    );

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    res.json({ success: true, data: project });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/content/:generatedId/content - Update generated content
router.put('/:generatedId/content', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    const generated = await GeneratedContent.findOneAndUpdate(
      { _id: req.params.generatedId, workspaceId: req.workspaceId },
      { content, status: 'edited' },
      { new: true }
    );

    if (!generated) {
      res.status(404).json({ success: false, error: 'Generated content not found' });
      return;
    }

    res.json({ success: true, data: generated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content/:id/rewrite - AI rewrite
router.post('/:id/rewrite', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { generatedId, instruction } = req.body;

    const generated = await GeneratedContent.findOne({
      _id: generatedId,
      workspaceId: req.workspaceId,
    });

    if (!generated) {
      res.status(404).json({ success: false, error: 'Generated content not found' });
      return;
    }

    // Dynamic import to avoid circular dependency
    const { aiProvider } = await import('../services/ai');

    const text = typeof generated.content === 'object'
      ? JSON.stringify(generated.content)
      : String(generated.content);

    const rewritten = await aiProvider.rewriteContent(text, instruction, undefined, req.userId);

    generated.content = { text: rewritten, original: generated.content };
    generated.status = 'edited';
    await generated.save();

    res.json({ success: true, data: generated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content/url - Import from URL (YouTube, web pages, etc.)
router.post('/url', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const { title, url, goal, selectedPlatforms, brandVoiceId, campaignId } = req.body;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ success: false, error: 'URL is required' });
      return;
    }

    const limitCheck = await enforcePlanLimits(req.workspaceId, {
      platforms: selectedPlatforms || ['linkedin', 'x', 'instagram'],
    });
    if (!limitCheck.ok) {
      res.status(limitCheck.status).json({ success: false, error: limitCheck.error });
      return;
    }
    const { workspace, planLimits, month } = limitCheck;

    // Detect URL type and extract content
    let transcript = '';
    let detectedTitle = title || '';
    const isYouTube = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/.test(url);

    if (isYouTube) {
      // YouTube: fetch transcript via timedtext API
      try {
        const videoId = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1];
        if (!videoId) throw new Error('Could not extract YouTube video ID');

        // Fetch video page to get title
        const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const pageHtml = await pageRes.text();
        const titleMatch = pageHtml.match(/<title>([^<]+)<\/title>/);
        if (titleMatch && !detectedTitle) {
          detectedTitle = titleMatch[1].replace(' - YouTube', '').trim();
        }

        // Try to get captions/transcript
        // YouTube captions require consent cookies, so we try the innertube API
        const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
            params: Buffer.from(`\n\x0b${videoId}`).toString('base64'),
          }),
        });
        const innertubeData = await innertubeRes.json() as any;
        const segments = innertubeData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups;
        if (segments && segments.length > 0) {
          transcript = segments.map((s: any) => s.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer?.cue?.simpleText || '').filter(Boolean).join(' ');
        }

        // If innertube failed, fall back to fetching the timedtext directly
        if (!transcript) {
          // Extract caption track URL from page HTML
          const captionMatch = pageHtml.match(/"captions":\{"playerCaptionsTracklistRenderer":\{"captionTracks":(\[.*?\])/);
          if (captionMatch) {
            const tracks = JSON.parse(captionMatch[1]);
            const enTrack = tracks.find((t: any) => t.languageCode === 'en') || tracks[0];
            if (enTrack?.baseUrl) {
              const captionRes = await fetch(enTrack.baseUrl);
              const captionXml = await captionRes.text();
              // Parse XML captions to plain text
              transcript = captionXml
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, ' ')
                .trim();
            }
          }
        }

        if (!transcript) {
          transcript = `YouTube video: ${detectedTitle || url}. The transcript could not be automatically extracted. You may need to manually paste the transcript.`;
        }
      } catch (err: any) {
        transcript = `YouTube video: ${detectedTitle || url}. Transcript extraction failed: ${err.message}. You may need to manually paste the transcript.`;
      }
    } else {
      // Web page: fetch and extract text content
      try {
        const pageRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(10000),
        });
        const html = await pageRes.text();

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && !detectedTitle) {
          detectedTitle = titleMatch[1].trim();
        }

        // Extract main content — strip scripts, styles, nav, footer, then get text
        let cleaned = html
          .replace(/<script[^\>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^\>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^\>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[^\>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<header[^\>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<aside[^\>]*>[\s\S]*?<\/aside>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();

        // Take first ~50000 chars (enough for analysis)
        transcript = cleaned.slice(0, 50000);

        if (transcript.length < 100) {
          transcript = `Web page: ${detectedTitle || url}. The page content could not be extracted. You may need to paste the content manually.`;
        }
      } catch (err: any) {
        transcript = `Web page: ${url}. Content extraction failed: ${err.message}. You may need to paste the content manually.`;
      }
    }

    const project = await ContentProject.create({
      workspaceId: req.workspaceId,
      createdBy: req.userId,
      title: detectedTitle || 'Imported Content',
      sourceType: 'url',
      sourceUrl: url,
      transcript,
      goal: goal || 'auto',
      selectedPlatforms: selectedPlatforms || ['linkedin', 'x', 'instagram'],
      brandVoiceId: brandVoiceId || undefined,
      campaignId: campaignId || undefined,
      status: 'processing',
    });

    const jobId = await addContentProcessingJob({
      projectId: project._id.toString(),
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      sourceType: 'url',
      sourceUrl: url,
      goal: project.goal,
      selectedPlatforms: project.selectedPlatforms,
      brandVoiceId,
    });

    project.jobId = jobId;
    await project.save();

    res.status(201).json({ success: true, data: project });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/content/:id/export - Export content
router.post('/:id/export', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const project = await ContentProject.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const generated = await GeneratedContent.find({ projectId: project._id, status: { $in: ['ready', 'edited'] } });
    const format = (req.body.format as string) || 'markdown';

    const platformNames: Record<string, string> = {
      linkedin: 'LinkedIn', x: 'X (Twitter)', instagram: 'Instagram',
      tiktok: 'TikTok', youtube: 'YouTube', threads: 'Threads',
      newsletter: 'Newsletter', blog: 'Blog',
    };

    function getText(content: any): string {
      if (typeof content === 'string') return content;
      if (content.text) return content.text;
      if (content.caption) return content.caption;
      if (content.body) return content.body;
      if (content.tweets) return content.tweets.join('\n\n---\n\n');
      if (content.thread) return content.thread.join('\n\n---\n\n');
      if (content.firstLine && content.caption) return `${content.firstLine}\n\n${content.caption}`;
      if (content.subjectLines) return `Subject: ${content.subjectLines[0]}\n\n${content.body || ''}`;
      if (content.seoTitle) return `# ${content.h1 || content.seoTitle}\n\n${content.body || ''}`;
      return JSON.stringify(content, null, 2);
    }

    if (format === 'markdown') {
      let md = `# ${project.title}\n\n`;
      md += `> Exported from Seed on ${new Date().toLocaleDateString('en-GB')}\n\n`;

      // Group by platform
      const byPlatform: Record<string, any[]> = {};
      for (const g of generated) {
        if (!byPlatform[g.platform]) byPlatform[g.platform] = [];
        byPlatform[g.platform].push(g);
      }

      for (const [platform, contents] of Object.entries(byPlatform)) {
        md += `## ${platformNames[platform] || platform}\n\n`;
        for (const c of contents) {
          const label = c.type && c.type !== 'error' ? `**${c.type}:**\n\n` : '';
          md += `${label}${getText(c.content)}\n\n---\n\n`;
        }
      }

      // Track export usage
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await Usage.findOneAndUpdate(
        { workspaceId: req.workspaceId, month },
        { $inc: { exports: 1 } },
        { upsert: true }
      );

      res.json({ success: true, data: { format: 'markdown', content: md } });
    } else if (format === 'text') {
      let txt = `${project.title}\n${'='.repeat(project.title.length)}\n\n`;

      const byPlatform: Record<string, any[]> = {};
      for (const g of generated) {
        if (!byPlatform[g.platform]) byPlatform[g.platform] = [];
        byPlatform[g.platform].push(g);
      }

      for (const [platform, contents] of Object.entries(byPlatform)) {
        txt += `${platformNames[platform] || platform}\n${'-'.repeat((platformNames[platform] || platform).length)}\n\n`;
        for (const c of contents) {
          txt += `${getText(c.content)}\n\n---\n\n`;
        }
      }

      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await Usage.findOneAndUpdate(
        { workspaceId: req.workspaceId, month },
        { $inc: { exports: 1 } },
        { upsert: true }
      );

      res.json({ success: true, data: { format: 'text', content: txt } });
    } else if (format === 'json') {
      const data = {
        title: project.title,
        exportedAt: new Date().toISOString(),
        platforms: Object.fromEntries(
          Object.entries(
            generated.reduce((acc: Record<string, any[]>, g: any) => {
              if (!acc[g.platform]) acc[g.platform] = [];
              acc[g.platform].push({ type: g.type, content: g.content, qualityScore: g.qualityScore });
              return acc;
            }, {})
          )
        ) as Record<string, any[]>,
      };

      res.json({ success: true, data: { format: 'json', content: JSON.stringify(data, null, 2) } });
    } else {
      res.status(400).json({ success: false, error: 'Supported formats: markdown, text, json' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/content/:id - Delete project
router.delete('/:id', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const project = await ContentProject.findOneAndDelete({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    // Delete associated generated content
    await GeneratedContent.deleteMany({ projectId: project._id });

    // Delete source file
    if (project.sourceFile) {
      await storage.delete(project.sourceFile);
    }

    res.json({ success: true, message: 'Project deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
