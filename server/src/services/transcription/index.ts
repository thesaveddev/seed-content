import { config } from '../../config/env';

export interface TranscriptionInput {
  filePath: string;
  language?: string;
}

export interface TranscriptionResult {
  transcript: string;
  language: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }>;
  confidence?: number;
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

// Mock transcription for development
class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    // Simulate processing time
    await new Promise((r) => setTimeout(r, 1000));

    return {
      transcript: `This is a mock transcript for the file: ${input.filePath}. In production, this would be the actual transcription of the audio/video content. The transcription service would use a provider like Whisper, Assembly AI, or Deepgram to convert the audio to text with high accuracy.`,
      language: input.language || 'en',
      duration: 60,
      segments: [
        { start: 0, end: 10, text: 'Mock transcript segment 1' },
        { start: 10, end: 20, text: 'Mock transcript segment 2' },
      ],
      confidence: 0.95,
    };
  }
}

// OpenAI Whisper provider
export class WhisperTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

    const fs = await import('fs');
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(input.filePath),
      model: 'whisper-1',
      language: input.language,
      response_format: 'verbose_json',
    });

    return {
      transcript: response.text,
      language: response.language || input.language || 'en',
      duration: response.duration,
      segments: response.segments?.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
    };
  }
}

function getTranscriptionProvider(): TranscriptionProvider {
  if (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
    return new WhisperTranscriptionProvider();
  }
  return new MockTranscriptionProvider();
}

export const transcriptionProvider = getTranscriptionProvider();
