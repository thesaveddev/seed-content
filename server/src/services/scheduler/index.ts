import { ScheduledPost, Integration } from '../../models';
import { publishScheduledPost } from '../publisher';
import { decryptCredentials } from '../crypto/secrets';

/**
 * Scheduled-post publisher loop.
 *
 * Periodically finds posts whose `scheduledAt` time has arrived and hands
 * each to the publishing service, which performs the real platform call
 * (Telegram works end-to-end today; other platforms validate the account
 * and notify the creator with ready-to-paste content).
 *
 * Design notes:
 * - Marks posts in-flight first so overlapping ticks never double-publish.
 * - Every terminal transition (published/failed) notifies the creator.
 * - Uses a bounded query so a large backlog is processed in batches.
 */

const TICK_MS = 60 * 1000; // check once a minute
const BATCH = 50;
const EXPIRY_CHECK_MS = 24 * 60 * 60 * 1000; // token-expiry sweep once a day
const EXPIRY_WARN_DAYS = 7; // warn when a token expires within a week

export class ScheduledPostPublisher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private lastExpirySweep = 0;
  private running = false;

  start() {
    if (this.timer) return;
    console.log('📅 Scheduled-post publisher started (checking every minute)');
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Daily sweep: warn about expiring platform tokens
    this.expiryTimer = setInterval(() => {
      void this.checkTokenExpiry();
    }, EXPIRY_CHECK_MS);
    setTimeout(() => void this.checkTokenExpiry(), 30_000);
    // Run one tick shortly after boot
    setTimeout(() => void this.tick(), 5000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await ScheduledPost.find({
        status: 'scheduled',
        scheduledAt: { $lte: new Date() },
      }).limit(BATCH);

      for (const post of due) {
        try {
          // Claim the post first — prevents double-publish on overlap
          const claimed = await ScheduledPost.findOneAndUpdate(
            { _id: post._id, status: 'scheduled' },
            { $set: { status: 'publishing' } },
            { new: true }
          );
          if (!claimed) continue;

          await publishScheduledPost(claimed);
        } catch (err: any) {
          await ScheduledPost.findByIdAndUpdate(post._id, {
            status: 'failed',
            errorMessage: err?.message || 'Publish failed',
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error('Scheduler tick failed:', err?.message);
    } finally {
      this.running = false;
    }
  }

  /**
   * Daily sweep: notify workspaces whose OAuth tokens expire soon or have
   * already errored on refresh, so they reconnect before posts fail.
   */
  async checkTokenExpiry(): Promise<void> {
    // Guard against overlapping sweeps
    if (Date.now() - this.lastExpirySweep < EXPIRY_CHECK_MS - 60_000) return;
    this.lastExpirySweep = Date.now();

    try {
      const soon = new Date(Date.now() + EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);
      const { Notification } = await import('../../models');

      const all = await Integration.find({ status: 'connected' });
      for (const integration of all) {
        const creds = decryptCredentials(integration.credentials || {});
        const expiresAt = creds.expiresAt ? Date.parse(creds.expiresAt) : NaN;

        let reason: string | null = null;
        if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
          reason = `Your ${integration.provider} connection expired. Reconnect it in Integrations so scheduled posts can publish.`;
        } else if (!Number.isNaN(expiresAt) && expiresAt <= soon.getTime()) {
          const days = Math.max(1, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
          reason = `Your ${integration.provider} connection expires in ~${days} day${days === 1 ? '' : 's'}. Reconnect soon to keep scheduled posts publishing.`;
        } else if (integration.metadata?.refreshError) {
          reason = `Your ${integration.provider} connection needs attention: ${integration.metadata.refreshError}. Reconnect it in Integrations.`;
        }
        if (!reason) continue;

        // One notification per integration per expiry event (dedupe key in metadata)
        const dedupeKey = `expiry-warn-${expiresAt || integration.metadata?.refreshErrorAt || ''}`;
        if (integration.metadata?.lastWarnedKey === dedupeKey) continue;

        await Integration.findByIdAndUpdate(integration._id, {
          'metadata.lastWarnedKey': dedupeKey,
        });

        const { ContentProject } = await import('../../models');
        const anyProject = await ContentProject.findOne({ workspaceId: integration.workspaceId }, 'createdBy');
        if (!anyProject?.createdBy) continue;

        await Notification.create({
          userId: String(anyProject.createdBy),
          workspaceId: String(integration.workspaceId),
          type: 'warning',
          title: `${integration.provider} needs reconnecting`,
          message: reason,
          read: false,
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error('Token-expiry sweep failed:', err?.message);
    }
  }
}

export const scheduledPostPublisher = new ScheduledPostPublisher();
