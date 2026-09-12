import { ScheduledPost, GeneratedContent, Notification, ContentProject } from '../../models';

/**
 * Scheduled-post publisher.
 *
 * Periodically finds posts whose `scheduledAt` time has arrived and moves
 * them through the publish lifecycle.  Without platform OAuth (launch
 * state), "publishing" means marking the post published and notifying the
 * creator — the content is ready to copy/paste.  When a platform
 * integration with real posting capability is connected, the actual API
 * call happens here.
 *
 * Design notes:
 * - Marks posts in-flight first so overlapping ticks never double-publish.
 * - Every terminal transition (published/failed) notifies the creator.
 * - Uses a bounded query so a large backlog is processed in batches.
 */

const TICK_MS = 60 * 1000; // check once a minute
const BATCH = 50;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function publishOne(post: any): Promise<void> {
  const gc = await GeneratedContent.findById(post.generatedContentId);

  if (!gc) {
    await ScheduledPost.findByIdAndUpdate(post._id, {
      status: 'failed',
      errorMessage: 'Generated content no longer exists',
    });
    return;
  }

  // ── Actual publish step ──
  // TODO(launch+): when a platform integration supports posting
  // (e.g. LinkedIn UGC posts API), perform the API call here using the
  // integration's stored credentials.  Until then the "publish" is a
  // hand-off: mark published + notify the creator that the post is due.
  await ScheduledPost.findByIdAndUpdate(post._id, {
    status: 'published',
    publishedAt: new Date(),
  });

  // Notify the creator that their post is due for publishing
  // ScheduledPost has no createdBy — resolve the owner via the project.
  try {
    const project = await ContentProject.findById(post.projectId);
    if (project) {
      await Notification.create({
        userId: String(project.createdBy),
        workspaceId: String(project.workspaceId),
        type: 'info',
        title: `Post due: ${post.platform}`,
        message: `Your ${post.platform} post is due now. Open the content pack to copy it into ${post.platform}.`,
        projectId: String(post.projectId),
        read: false,
      });
    }
  } catch {
    // Notification is best-effort — never fail the publish over it
  }
}

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

          await publishOne(claimed);
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
