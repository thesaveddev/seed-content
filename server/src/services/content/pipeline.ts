import { ContentProject, GeneratedContent, BrandVoice, Usage, Notification } from '../../models';
import { aiProvider } from '../ai';
import { transcriptionProvider } from '../transcription';
import { storage } from '../storage';
import { notifyStatusChange } from '../../routes/events';
import type { Platform } from '../../types';

export class ContentPipeline {
  async processProject(projectId: string): Promise<void> {
    const project = await ContentProject.findById(projectId);
    if (!project) throw new Error('Project not found');

    const userId = (project as any).createdBy?.toString() || '';

    try {
      // Step 1: Transcribe (if audio/video)
      if (project.sourceType === 'video' || project.sourceType === 'audio') {
        await this.transcribe(project);
      }

      // Step 2: Analyse content
      await this.analyse(project, userId);

      // Step 3: Generate content for each platform
      await this.generate(project, userId);

      // Step 4: Quality check
      await this.qualityCheck(project, userId);

      // Step 5: Mark as ready
      project.status = 'ready';
      await project.save();
      notifyStatusChange(project._id.toString(), 'ready');

      // Create success notification
      const generatedCount = await GeneratedContent.countDocuments({ projectId: project._id, status: 'ready' });
      await Notification.create({
        userId: project.createdBy.toString(),
        workspaceId: project.workspaceId.toString(),
        type: 'content_ready',
        title: 'Content pack ready',
        message: `${project.title} — ${generatedCount} piece${generatedCount !== 1 ? 's' : ''} generated for ${project.selectedPlatforms.length} platform${project.selectedPlatforms.length !== 1 ? 's' : ''}.`,
        projectId: project._id.toString(),
        read: false,
      });

      // Track usage
      await this.trackUsage(project.workspaceId);
    } catch (error: any) {
      project.status = 'failed';
      project.errorMessage = error.message || 'Processing failed';
      await project.save();
      notifyStatusChange(project._id.toString(), 'failed');

      // Create failure notification
      await Notification.create({
        userId: project.createdBy.toString(),
        workspaceId: project.workspaceId.toString(),
        type: 'content_failed',
        title: 'Content processing failed',
        message: `${project.title} — ${error.message || 'Something went wrong. You can retry from the content detail page.'}`,
        projectId: project._id.toString(),
        read: false,
      });

      throw error;
    }
  }

  private async transcribe(project: any): Promise<void> {
    project.status = 'transcribing';
    await project.save();
    notifyStatusChange(project._id.toString(), 'transcribing');

    if (project.sourceFile) {
      const localPath = storage.getLocalPath(project.sourceFile);
      const result = await transcriptionProvider.transcribe({
        filePath: localPath,
      });

      project.transcript = result.transcript;
      project.transcriptLanguage = result.language;
      await project.save();
    }
  }

  private async analyse(project: any, userId: string): Promise<void> {
    project.status = 'analysing';
    await project.save();
    notifyStatusChange(project._id.toString(), 'analysing');

    const transcript = project.transcript || '';
    const analysis = await aiProvider.analyseContent(transcript, undefined, userId);
    project.analysis = analysis;

    // Auto-generate title from analysis
    if (!project.title || project.title === 'Untitled Content') {
      project.title = analysis.title || 'Untitled Content';
    }

    await project.save();
  }

  private async generate(project: any, userId: string): Promise<void> {
    project.status = 'generating';
    await project.save();
    notifyStatusChange(project._id.toString(), 'generating');

    if (!project.analysis) throw new Error('Analysis not found');

    // Get brand voice if configured
    let brandVoiceText: string | undefined;
    if (project.brandVoiceId) {
      const brandVoice = await BrandVoice.findById(project.brandVoiceId);
      if (brandVoice) {
        brandVoiceText = `${brandVoice.description}\nTone: ${brandVoice.tone.join(', ')}\nAudience: ${brandVoice.audience}\nAvoid: ${brandVoice.avoidWords.join(', ')}\nPreferred: ${brandVoice.preferredWords.join(', ')}`;
        if (brandVoice.samples.length > 0) {
          brandVoiceText += `\n\nWriting samples:\n${brandVoice.samples.join('\n---\n')}`;
        }
      }
    }

    const platforms = project.selectedPlatforms as Platform[];

    for (const platform of platforms) {
      try {
        const pieces = await aiProvider.generateForPlatform(
          project.analysis,
          platform,
          project.goal,
          brandVoiceText,
          userId
        );

        for (const piece of pieces) {
          await GeneratedContent.create({
            projectId: project._id,
            workspaceId: project.workspaceId,
            platform: piece.platform,
            type: piece.type,
            content: piece.content,
            status: 'ready',
          });
        }
      } catch (error: any) {
        console.error(`Failed to generate for ${platform}:`, error);
        await GeneratedContent.create({
          projectId: project._id,
          workspaceId: project.workspaceId,
          platform,
          type: 'error',
          content: { error: error.message },
          status: 'failed',
        });
      }
    }
  }

  private async qualityCheck(project: any, userId: string): Promise<void> {
    project.status = 'quality_check';
    await project.save();

    const contents = await GeneratedContent.find({
      projectId: project._id,
      status: 'ready',
    });

    const source = project.transcript || '';

    for (const content of contents) {
      const text = typeof content.content === 'object'
        ? JSON.stringify(content.content)
        : String(content.content);

      const result = await aiProvider.qualityCheck(
        source,
        text,
        content.platform as Platform,
        userId
      );

      content.qualityScore = result.score;
      content.qualityIssues = result.issues;
      content.qualitySuggestions = result.suggestions;

      // Auto-regenerate once if score is too low
      if (result.score < 50 && project.analysis) {
        try {
          const pieces = await aiProvider.generateForPlatform(
            project.analysis,
            content.platform as Platform,
            project.goal,
            undefined,
            userId
          );

          if (pieces.length > 0) {
            content.content = pieces[0].content;
            const recheck = await aiProvider.qualityCheck(
              source,
              JSON.stringify(pieces[0].content),
              content.platform as Platform,
              userId
            );
            content.qualityScore = recheck.score;
            content.qualityIssues = recheck.issues;
            content.qualitySuggestions = recheck.suggestions;
          }
        } catch {
          // Keep original content if regeneration fails
        }
      }

      await content.save();
    }
  }

  private async trackUsage(workspaceId: any): Promise<void> {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    await Usage.findOneAndUpdate(
      { workspaceId, month },
      {
        $inc: {
          generations: 1,
          projects: 1,
        },
      },
      { upsert: true }
    );
  }
}

export const contentPipeline = new ContentPipeline();
