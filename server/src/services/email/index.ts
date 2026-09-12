import { config } from '../../config/env';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private async sendMail(options: EmailOptions): Promise<boolean> {
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
      // Dev fallback: log to console
      console.log('\n📧 EMAIL (dev mode — configure SMTP_HOST/USER/PASS to send):');
      console.log(`   To: ${options.to}`);
      console.log(`   Subject: ${options.subject}`);
      console.log(`   Preview: ${(options.text || options.html.replace(/<[^>]+>/g, '')).slice(0, 200)}`);
      console.log('');
      return false;
    }

    try {
      // Dynamic import to avoid compile-time dependency
      const nodemailer = await import('nodemailer' as any);
      const transporter = nodemailer.default.createTransport({
        host: config.SMTP_HOST,
        port: (config.SMTP_PORT as number) || 587,
        secure: (config.SMTP_PORT as number) === 465,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      });

      await transporter.sendMail({
        from: config.SMTP_FROM || config.SMTP_USER,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      return true;
    } catch (error: any) {
      console.error('Email send failed:', error.message);
      return false;
    }
  }

  async sendPasswordReset(email: string, _resetToken: string, resetUrl: string): Promise<boolean> {
    return this.sendMail({
      to: email,
      subject: 'Reset your Seed password',
      html: `
        <div style="max-width:480px;margin:0 auto;font-family:sans-serif;">
          <h2 style="color:#1f2937;">Reset your password</h2>
          <p style="color:#4b5563;font-size:15px;">You requested a password reset for your Seed account.</p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#4263eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0;">
            Reset password
          </a>
          <p style="color:#9ca3af;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
      text: `Reset your Seed password: ${resetUrl}\n\nThis link expires in 1 hour.`,
    });
  }
}

export const emailService = new EmailService();
