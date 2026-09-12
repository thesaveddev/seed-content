// Telegram bot service - architecture ready for when token is provided
// For MVP, this provides the interface and a webhook-based handler

import { config } from '../../config/env';

export interface TelegramBotConfig {
  token: string;
  webhookUrl?: string;
}

export interface TelegramMessage {
  chatId: number;
  text: string;
  replyMarkup?: any;
}

export class TelegramBotService {
  private token: string;
  private apiBase: string;

  constructor() {
    this.token = config.TELEGRAM_BOT_TOKEN || '';
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  get isConfigured(): boolean {
    return !!this.token;
  }

  async sendMessage(chatId: number, text: string, replyMarkup?: any): Promise<void> {
    if (!this.isConfigured) return;

    await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      }),
    });
  }

  async sendContentPack(chatId: number, projectId: string): Promise<void> {
    await this.sendMessage(
      chatId,
      `✅ Your content pack is ready!\n\nView it here: ${config.FRONTEND_URL}/content/${projectId}`,
      {
        inline_keyboard: [
          [{ text: '📝 View Content', url: `${config.FRONTEND_URL}/content/${projectId}` }],
          [
            { text: '💼 LinkedIn', callback_data: `copy_linkedin_${projectId}` },
            { text: '𝕏 X', callback_data: `copy_x_${projectId}` },
          ],
          [
            { text: '📸 Instagram', callback_data: `copy_instagram_${projectId}` },
            { text: '🎵 TikTok', callback_data: `copy_tiktok_${projectId}` },
          ],
        ],
      }
    );
  }

  async sendProcessingStatus(chatId: number, status: string): Promise<void> {
    const messages: Record<string, string> = {
      processing: '🔄 Analysing your content...',
      transcribing: '🎙 Transcribing audio...',
      analysing: '🧠 Understanding your message...',
      generating: '✍️ Creating content for each platform...',
      quality_check: '✅ Running quality checks...',
      ready: '🎉 Your content pack is ready!',
      failed: '❌ Something went wrong. Please try again.',
    };

    await this.sendMessage(chatId, messages[status] || `Status: ${status}`);
  }

  // Handle incoming webhook from Telegram
  async handleWebhook(body: any): Promise<void> {
    const message = body.message;
    if (!message?.text || !message?.chat) return;

    const chatId = message.chat.id;
    const text = message.text;

    // Command: /start
    if (text === '/start') {
      await this.sendMessage(
        chatId,
        `Welcome to Seed! 🚀\n\nSend me a video or text, and I'll create a content pack for you.\n\nCommands:\n/help - Show help\n/link - Link your account`,
        {
          inline_keyboard: [
            [{ text: '🌐 Open Web App', url: config.FRONTEND_URL }],
          ],
        }
      );
      return;
    }

    // Command: /help
    if (text === '/help') {
      await this.sendMessage(
        chatId,
        `How to use Seed:\n\n1. Send a video/audio file or paste text\n2. I'll analyse it and create content\n3. View your content pack in the web app\n\nOr paste a URL and I'll process it.`
      );
      return;
    }

    // Handle video/audio messages
    if (message.video || message.audio || message.document) {
      await this.sendMessage(chatId, '🎬 Got it! I\'m analysing your content...\n\nThis may take a minute.');
      // In production: download file, upload to storage, create project, queue processing
      return;
    }

    // Handle text messages
    if (text && text.length > 20 && text !== '/start' && text !== '/help') {
      await this.sendMessage(chatId, '📝 Got it! I\'m creating your content pack...');
      // In production: create text project, queue processing
      return;
    }
  }
}

export const telegramBot = new TelegramBotService();
