import { config } from './config/env';
import { connectDatabase } from './config/database';
import { initQueue, type ContentProcessingJobData } from './services/queue';
import { contentPipeline } from './services/content/pipeline';
import { scheduledPostPublisher } from './services/scheduler';
import { createApp } from './app';

async function main() {
  await connectDatabase();

  await initQueue(async (data: ContentProcessingJobData) => {
    try {
      await contentPipeline.processProject(data.projectId);
    } catch (error: any) {
      console.error(`Failed to process project ${data.projectId}:`, error.message);
    }
  });

  const app = createApp();

  scheduledPostPublisher.start();

  app.listen(config.PORT, '0.0.0.0', () => {
    const { isUsingInMemory } = require('./config/database');
    const dbMode = isUsingInMemory() ? 'In-memory (fallback)' : 'MongoDB';
    console.log(`\n🚀 Seed API running
   Port: ${config.PORT}
   Environment: ${config.NODE_ENV}
   AI Provider: ${config.AI_PROVIDER}
   Storage: ${config.STORAGE_PROVIDER}
   Database: ${dbMode}
    `);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
