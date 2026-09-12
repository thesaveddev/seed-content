/**
 * Smart mock AI provider for development.
 *
 * Generates real, usable platform-specific content from the source text
 * without requiring an OpenAI API key.  Content is derived from the actual
 * source material — paragraphs and their structure — not template
 * placeholders and not arbitrary sentence sampling.
 */

import type { AIProvider, ContentAnalysis, GeneratedPiece, QualityCheckResult } from './index';
import type { Platform } from '../../types';

// ── Text extraction helpers ──────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clamp(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** Matches "First," "Second," "Lesson 3:", "1." "2)" paragraph lead-ins. */
const ORDINAL_RE =
  /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|lesson\s*\d+|\d+\s*[.)])\b[,:]?\s*/i;

export interface Lesson {
  /** Short single-sentence version for list posts / tweets */
  point: string;
  /** Full paragraph text for long-form sections */
  full: string;
}

/**
 * Split source text into structured lessons.
 * - If paragraphs start with ordinals ("First, ..."), each is one lesson.
 * - Otherwise, each paragraph after the intro is one lesson.
 * Returns the hook (first sentence) separately so callers never duplicate it.
 */
function extractLessons(text: string): { hook: string; lessons: Lesson[]; intro: string } {
  const paras = paragraphs(text);
  if (paras.length === 0) paras.push(text);

  const firstSents = sentences(paras[0]);
  const hook = firstSents[0] || '';
  const intro = paras[0];

  const structured = paras.filter((p) => ORDINAL_RE.test(p));

  let lessons: Lesson[];

  if (structured.length >= 2) {
    lessons = structured.map((p) => {
      const point = capitalize(sentences(p)[0]?.replace(ORDINAL_RE, '') || '');
      return { point, full: p };
    });
  } else if (paras.length >= 2) {
    // Unstructured multi-paragraph: first sentence of each body paragraph
    lessons = paras.slice(1).map((p) => ({
      point: capitalize(sentences(p)[0] || ''),
      full: p,
    }));
  } else {
    // Single block: use all sentences after the hook
    lessons = firstSents.slice(1).map((s) => ({ point: capitalize(s), full: s }));
  }

  // Drop empties and any point that merely repeats the hook
  lessons = lessons.filter(
    (l) => l.point.length > 10 && l.point.toLowerCase() !== hook.toLowerCase()
  );

  return { hook, lessons, intro };
}

function extractSummary(text: string): string {
  const paras = paragraphs(text);
  const sents = sentences(paras[0] || text);
  return sents.slice(0, 3).join(' ');
}

/** Sentences containing concrete numbers — honest "claims" for quality checks. */
function extractClaims(text: string): string[] {
  return sentences(text)
    .filter((s) => /\d+%|\d+x\b|\$\d+|£\d+|\b\d{2,}\b/.test(s))
    .slice(0, 6);
}

// ── Hashtag extraction ───────────────────────────────────────────

const HASHTAG_STOP = new Set([
  'about', 'their', 'would', 'could', 'should', 'which', 'these', 'those',
  'being', 'having', 'doing', 'after', 'before', 'where', 'while', 'there',
  'here', 'very', 'really', 'just', 'also', 'into', 'than', 'them', 'then',
  'what', 'when', 'with', 'from', 'some', 'that', 'this', 'have', 'been',
  'were', 'will', 'more', 'most', 'your', 'only', 'over', 'such', 'along',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'every',
  'single', 'spent', 'weeks', 'month', 'months', 'weeks', 'overnight',
  'thing', 'things', 'stuff', 'anyway', 'because', 'instead', 'started',
  'quickly', 'fast', 'possible', 'anything', 'something', 'nothing',
  'learned', 'lesson', 'lessons', 'biggest', 'building', 'getting',
]);

function extractHashtags(text: string, n = 4): string[] {
  const words = text.match(/\b[A-Za-z][a-zA-Z]{4,}\b/g) || [];
  const freq: Record<string, number> = {};
  for (const w of words) {
    const lw = w.toLowerCase();
    if (HASHTAG_STOP.has(lw)) continue;
    freq[lw] = (freq[lw] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => '#' + w);
}

function extractKeywords(text: string): string[] {
  return extractHashtags(text, 10).map((h) => h.slice(1));
}

// ── Heuristic classifiers ────────────────────────────────────────

function guessAudience(text: string): string {
  const lower = text.toLowerCase();
  if (/founder|startup|saas|business|entrepreneur|ceo|cto/.test(lower)) return 'Founders and startup builders';
  if (/marketer|marketing|seo|content|social media/.test(lower)) return 'Marketers and content creators';
  if (/developer|code|engineer|tech|api/.test(lower)) return 'Developers and technical teams';
  if (/design|ux|ui|creative/.test(lower)) return 'Designers and creatives';
  if (/freelanc|solopreneur|client/.test(lower)) return 'Freelancers and solopreneurs';
  return 'Professionals and creators';
}

function guessTone(text: string): string {
  const lower = text.toLowerCase();
  if (/data|research|study|percent|statistics/.test(lower)) return 'analytical and data-driven';
  if (/story|remember|once|finally|journey/.test(lower)) return 'narrative and reflective';
  if (text.split('!').length > 4) return 'energetic and passionate';
  return 'confident and informative';
}

function guessContentType(text: string): string {
  const lower = text.toLowerCase();
  if (/lesson|learn|mistake|what i/.test(lower)) return 'lessons learned';
  if (/step|how to|guide|tutorial/.test(lower)) return 'tutorial';
  if (/review|compared|vs|versus/.test(lower)) return 'comparison';
  if (/mistake|wrong|fail|avoid/.test(lower)) return 'advice';
  return 'educational';
}

function extractCTA(text: string): string {
  const sents = sentences(text);
  const last = sents[sents.length - 1] || '';
  // Only use the last sentence as CTA if it's short and directive
  if (last.length < 140 && /try|start|follow|sign up|check out|join|share|comment|subscribe|download/i.test(last)) {
    return last;
  }
  return 'What would you add to this list?';
}

// ── Mock AI Provider ─────────────────────────────────────────────

export class MockAIProvider implements AIProvider {
  async analyseContent(transcript: string, _context?: string, _userId?: string): Promise<ContentAnalysis> {
    await sleep(300);

    const { hook, lessons } = extractLessons(transcript);
    const points = lessons.map((l) => l.point);
    const keywords = extractKeywords(transcript);

    return {
      title: capitalize(hook.replace(/[.!?]+$/, '')),
      summary: extractSummary(transcript),
      mainTopic: keywords.slice(0, 3).join(', ') || 'General topic',
      keyPoints: points.length > 0 ? points : [capitalize(hook)],
      hook,
      audience: guessAudience(transcript),
      painPoints: points.slice(0, 3),
      insights: points,
      story: extractSummary(transcript),
      tone: guessTone(transcript),
      cta: extractCTA(transcript),
      contentType: guessContentType(transcript),
      keywords,
      entities: [],
      claims: extractClaims(transcript),
      suggestedAngles: ['Lessons learned', 'Behind the scenes', 'Contrarian take'],
    };
  }

  async generateForPlatform(
    analysis: ContentAnalysis,
    platform: Platform,
    goal: string,
    _brandVoice?: string,
    _userId?: string
  ): Promise<GeneratedPiece[]> {
    await sleep(200);

    // Re-derive lessons from the analysis fields so generators always have
    // clean, hook-free points to work with.
    const points = analysis.keyPoints.filter(
      (p) => p.toLowerCase() !== analysis.hook.toLowerCase()
    );
    const hashtags = extractHashtags(analysis.summary + ' ' + points.join(' '), 4);

    return platformGenerators[platform]?.(analysis, points, hashtags, goal) || [];
  }

  async qualityCheck(
    source: string,
    generated: string,
    _platform: Platform,
    _userId?: string
  ): Promise<QualityCheckResult> {
    await sleep(100);

    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 85;

    if (generated.length < 50) {
      issues.push('Content is very short — may feel incomplete');
      score -= 15;
    }

    const sourceWords = new Set(source.toLowerCase().split(/\s+/));
    const genWords = generated.toLowerCase().split(/\s+/);
    const overlap = genWords.filter((w) => sourceWords.has(w)).length;
    const overlapRatio = genWords.length > 0 ? overlap / genWords.length : 0;
    if (overlapRatio < 0.1) {
      issues.push("Content doesn't seem connected to the source material");
      score -= 20;
    }

    const aiPhrases = ['leverage', 'synergy', 'delve', 'tapestry', 'landscape', 'realm', 'game-changer', 'unlock the power', "in today's world"];
    if (aiPhrases.some((p) => generated.toLowerCase().includes(p))) {
      issues.push('Contains generic AI language — sounds robotic');
      score -= 10;
    }

    if (!generated.includes('!') && !generated.includes('?')) {
      suggestions.push('Consider adding a question or exclamation for engagement');
    }
    if (!/sign up|try|learn more|follow|comment|share|subscribe/i.test(generated)) {
      suggestions.push('Consider adding a call-to-action');
    }

    return { score: Math.max(0, score), issues, suggestions };
  }

  async rewriteContent(content: string, instruction: string, _brandVoice?: string, _userId?: string): Promise<string> {
    await sleep(150);
    let rewritten = content;
    if (/shorter|concise|trim/i.test(instruction)) {
      const sents = sentences(content);
      rewritten = sents.slice(0, Math.max(1, Math.floor(sents.length / 2))).join(' ');
    } else if (/longer|expand|detail/i.test(instruction)) {
      rewritten = content + '\n\nThis is an important point worth exploring further.';
    } else if (/formal|professional/i.test(instruction)) {
      rewritten = content.replace(/!/g, '.').replace(/you're/g, 'you are').replace(/don't/g, 'do not');
    } else if (/casual|friendly|fun/i.test(instruction)) {
      rewritten = content.replace(/\./g, '!').replace(/you are/g, "you're");
    }
    return rewritten;
  }
}

// ── Platform-specific generators ─────────────────────────────────

type Generator = (
  a: ContentAnalysis,
  points: string[],
  hashtags: string[],
  goal: string
) => GeneratedPiece[];

const platformGenerators: Record<Platform, Generator> = {
  linkedin: (a, points, hashtags, goal) => {
    const hook = clamp(a.hook, 220);
    const body = points.slice(0, 6).map((p) => `→ ${clamp(p, 250)}`).join('\n\n');
    const engagement =
      goal === 'conversion'
        ? `\n\n${a.cta}`
        : `\n\n💬 ${/add to this list/.test(a.cta) ? a.cta : 'What would you add to this list?'}`;
    const tags = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';

    return [{
      platform: 'linkedin',
      type: 'post',
      content: { text: `${hook}\n\n${body}${engagement}${tags}` },
    }];
  },

  x: (a, points, _hashtags, _goal) => {
    const short = clamp(a.hook, 260);

    // Thread: opener = hook, one tweet per point, closer = engagement
    const total = points.length;
    const opener = `🧵 ${clamp(a.hook, 250)}`;
    const numbered = points
      .slice(0, 7)
      .map((p, i) => `${i + 1}/${total} ${clamp(p, 265)}`);
    const closer = `That's the whole list. Which one hit hardest?\n\n♻️ Repost if it helped.`;

    return [
      { platform: 'x', type: 'short', content: { text: short } },
      {
        platform: 'x',
        type: 'thread',
        content: { tweets: total > 0 ? [opener, ...numbered, closer] : [opener, closer] },
      },
    ];
  },

  instagram: (a, points, hashtags, _goal) => {
    const hook = clamp(a.hook, 150);
    const list = points.slice(0, 6).map((p, i) => `${i + 1}. ${clamp(p, 200)}`).join('\n\n');
    const caption = `${hook}\n\n${list}\n\n💬 Which one resonates most with you?\n\n${hashtags.join(' ')}`;

    return [{
      platform: 'instagram',
      type: 'caption',
      content: {
        firstLine: hook,
        caption,
        hashtags,
      },
    }];
  },

  tiktok: (a, points, _hashtags, _goal) => {
    const hook = clamp(a.hook, 150);
    const onScreen = points.slice(0, 5);

    return [{
      platform: 'tiktok',
      type: 'caption',
      content: {
        hook,
        caption: `${hook}\n\n${onScreen.slice(0, 3).map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nFollow for more 💡`,
        cta: 'Follow for more tips',
        onScreenText: onScreen,
      },
    }];
  },

  youtube: (a, points, _hashtags, _goal) => {
    return [{
      platform: 'youtube',
      type: 'metadata',
      content: {
        titles: [
          a.title,
          `${a.title} — Honest Lessons`,
          `What I Learned: ${a.title}`,
        ],
        description: `${a.summary}\n\nKey takeaways:\n${points.map((p) => `• ${p}`).join('\n')}\n\n${a.cta}`,
        shortDescription: clamp(a.summary, 150),
        keywords: a.keywords,
      },
    }];
  },

  threads: (a, points, _hashtags, _goal) => {
    const text = `${clamp(a.hook, 240)}\n\n${points.slice(0, 4).map((p) => clamp(p, 240)).join('\n\n')}`;
    return [{ platform: 'threads', type: 'post', content: { text } }];
  },

  newsletter: (a, points, _hashtags, _goal) => {
    const subjectLines = [
      a.title,
      `${a.title} — what actually worked`,
      `Lessons from: ${a.title}`,
    ];

    const body = `# ${a.title}\n\n${a.summary}\n\n## Key takeaways\n\n${points.map((p) => `- ${p}`).join('\n')}\n\n${a.cta}`;

    return [{
      platform: 'newsletter',
      type: 'email',
      content: {
        subjectLines,
        previewText: clamp(a.summary, 100),
        body,
        cta: a.cta,
      },
    }];
  },

  blog: (a, points, _hashtags, _goal) => {
    const sections = points.map((p, i) => ({
      h2: `${i + 1}. ${clamp(p, 80)}`,
      content: `${p}`,
    }));

    const body = `# ${a.title}\n\n${a.summary}\n\n${sections
      .map((s) => `## ${s.h2}\n\n${s.content}`)
      .join('\n\n')}\n\n## Conclusion\n\n${a.cta}`;

    return [{
      platform: 'blog',
      type: 'article',
      content: {
        seoTitle: a.title,
        metaDescription: clamp(a.summary, 160),
        h1: a.title,
        sections,
        keywords: a.keywords,
        body,
      },
    }];
  },
};
