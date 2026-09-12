import { ScheduledPost } from '../../models';
import { publishScheduledPost } from '../publisher';

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

export class ScheduledPostPublisher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start() {
    if (this.timer) return;
    console.log('📅 Scheduled-post publisher started (checking every minute)');
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Run one tick shortly after boot
    setTimeout(() => void this.tick(), 5000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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
}

export const scheduledPostPublisher = new ScheduledPostPublisher();
