import { config } from '../../config/env';
import { User } from '../../models';
import type { Platform } from '../../types';
import {
  generateLinkedInPrompt,
  generateXPrompt,
  generateInstagramPrompt,
  generateTikTokPrompt,
  generateYouTubePrompt,
  generateThreadsPrompt,
  generateNewsletterPrompt,
  generateBlogPrompt,
} from './prompts';

export interface ContentAnalysis {
  title: string;
  summary: string;
  mainTopic: string;
  keyPoints: string[];
  hook: string;
  audience: string;
  painPoints: string[];
  insights: string[];
  story: string;
  tone: string;
  cta: string;
  contentType: string;
  keywords: string[];
  entities: string[];
  claims: string[];
  suggestedAngles: string[];
}

export interface GeneratedPiece {
  platform: Platform;
  type: string;
  content: any;
}

export interface QualityCheckResult {
  score: number;
  issues: string[];
  suggestions: string[];
}

export interface AIProvider {
  analyseContent(transcript: string, context?: string, userId?: string): Promise<ContentAnalysis>;
  generateForPlatform(
    analysis: ContentAnalysis,
    platform: Platform,
    goal: string,
    brandVoice?: string,
    userId?: string
  ): Promise<GeneratedPiece[]>;
  qualityCheck(
    source: string,
    generated: string,
    platform: Platform,
    userId?: string
  ): Promise<QualityCheckResult>;
  rewriteContent(
    content: string,
    instruction: string,
    brandVoice?: string,
    userId?: string
  ): Promise<string>;
}

// Provider that respects per-user API keys
export class UserKeyAIProvider implements AIProvider {
  private globalClient: any;
  private userKeyClients = new Map<string, any>();

  private async getClient(userId?: string) {
    // Try to get user's personal key first
    if (userId) {
      if (this.userKeyClients.has(userId)) {
        return this.userKeyClients.get(userId);
      }
      try {
        const user = await User.findById(userId).select('+openaiApiKey');
        const userKey = (user as any)?.openaiApiKey as string | undefined;
        if (userKey) {
          const { default: OpenAI } = await import('openai');
          const client = new OpenAI({ apiKey: userKey });
          this.userKeyClients.set(userId, client);
          return client;
        }
      } catch {
        // Fall through to global key
      }
    }

    // Fall back to global key
    if (!this.globalClient && config.OPENAI_API_KEY) {
      const { default: OpenAI } = await import('openai');
      this.globalClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    }
    return this.globalClient;
  }

  private async chat(systemPrompt: string, userPrompt: string, userId?: string): Promise<string> {
    const client = await this.getClient(userId);
    if (!client) throw new Error('No AI provider configured. Please add your OpenAI API key in Settings.');
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });
    return response.choices[0].message.content;
  }

  private async chatJSON(systemPrompt: string, userPrompt: string, userId?: string): Promise<any> {
    const response = await this.chat(
      systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.',
      userPrompt,
      userId
    );
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Failed to parse AI JSON response');
  }

  async analyseContent(transcript: string, context?: string, userId?: string): Promise<ContentAnalysis> {
    const systemPrompt = `You are an expert content analyst. Analyse the following transcript and return a structured JSON analysis. Focus on understanding the core message, audience, tone, and key insights.

Return exactly this JSON structure:
{
  "title": "compelling title",
  "summary": "2-3 sentence summary",
  "mainTopic": "primary topic",
  "keyPoints": ["point 1", "point 2", ...],
  "hook": "the strongest opening hook from the content or a crafted one",
  "audience": "target audience",
  "painPoints": ["pain point 1", ...],
  "insights": ["insight 1", ...],
  "story": "narrative arc of the content",
  "tone": "detected tone",
  "cta": "call to action or suggested CTA",
  "contentType": "type of content",
  "keywords": ["keyword1", ...],
  "entities": ["entity1", ...],
  "claims": ["claim1", ...],
  "suggestedAngles": ["angle 1", ...]
}`;

    const userPrompt = context
      ? `Context: ${context}\n\nTranscript:\n${transcript}`
      : `Transcript:\n${transcript}`;

    return this.chatJSON(systemPrompt, userPrompt, userId);
  }

  async generateForPlatform(
    analysis: ContentAnalysis,
    platform: Platform,
    goal: string,
    brandVoice?: string,
    userId?: string
  ): Promise<GeneratedPiece[]> {
    const platformPrompts: Record<Platform, string> = {
      linkedin: generateLinkedInPrompt,
      x: generateXPrompt,
      instagram: generateInstagramPrompt,
      tiktok: generateTikTokPrompt,
      youtube: generateYouTubePrompt,
      threads: generateThreadsPrompt,
      newsletter: generateNewsletterPrompt,
      blog: generateBlogPrompt,
    };

    const systemPrompt = platformPrompts[platform] || 'Generate content.';

    const goalContext = {
      reach: 'Optimise for curiosity, entertainment, shareability, conversation, and strong hooks.',
      authority: 'Optimise for education, insight, credibility, and useful information.',
      conversion: 'Optimise for problem/solution, product/service relevance, proof, CTA, and lead generation.',
      auto: 'Choose the best approach based on the content.',
    };

    const voiceContext = brandVoice ? `\n\nBrand Voice:\n${brandVoice}` : '';

    const analysisJson = JSON.stringify(analysis, null, 2);

    const response = await this.chat(
      systemPrompt + voiceContext,
      `Content Goal: ${goalContext[goal as keyof typeof goalContext] || goalContext.auto}\n\nSource Analysis:\n${analysisJson}`,
      userId
    );

    return this.parsePlatformResponse(platform, response);
  }

  private parsePlatformResponse(platform: Platform, response: string): GeneratedPiece[] {
    try {
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          platform,
          type: item.type || 'post',
          content: item,
        }));
      }
      return [{ platform, type: 'post', content: parsed }];
    } catch {
      return [{ platform, type: 'post', content: { text: response } }];
    }
  }

  async qualityCheck(
    source: string,
    generated: string,
    platform: Platform,
    userId?: string
  ): Promise<QualityCheckResult> {
    const systemPrompt = `You are a content quality checker. Compare the generated content against the source material.
Check for:
- Factual consistency with source
- Hallucinations or unsupported claims
- Repetition
- Generic AI language
- Platform suitability
- Readability
- Tone consistency

Return JSON:
{
  "score": 0-100,
  "issues": ["issue1", ...],
  "suggestions": ["suggestion1", ...]
}`;

    try {
      return await this.chatJSON(systemPrompt, `Source:\n${source.slice(0, 2000)}\n\nGenerated (${platform}):\n${generated}`, userId);
    } catch {
      return { score: 70, issues: [], suggestions: ['Quality check completed with limited analysis'] };
    }
  }

  async rewriteContent(
    content: string,
    instruction: string,
    brandVoice?: string,
    userId?: string
  ): Promise<string> {
    const voiceContext = brandVoice ? `\n\nBrand Voice: ${brandVoice}` : '';
    return this.chat(
      `You are a content editor. Rewrite the following content based on the user's instruction.${voiceContext}\nReturn only the rewritten content, no explanation.`,
      `Instruction: ${instruction}\n\nContent:\n${content}`,
      userId
    );
  }
}

import { MockAIProvider } from './mock';

function getProvider(): AIProvider {
  if (config.OPENAI_API_KEY || config.AI_PROVIDER === 'openai') {
    return new UserKeyAIProvider();
  }
  return new MockAIProvider();
}

export const aiProvider = getProvider();
