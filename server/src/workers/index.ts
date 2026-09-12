import { connectDatabase } from '../config/database';
import { initQueue } from '../services/queue';
import { contentPipeline } from '../services/content/pipeline';

async function startWorker() {
  console.log('🔧 Starting content processing worker...');

  await connectDatabase();

  await initQueue(async (data) => {
    const { projectId } = data;
    console.log(`📥 Processing project ${projectId}`);
    try {
      await contentPipeline.processProject(projectId);
      console.log(`✅ Project ${projectId} processed successfully`);
    } catch (error: any) {
      console.error(`❌ Project ${projectId} failed:`, error.message);
    }
  });

  console.log('✅ Worker started and listening for jobs');
}

startWorker().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
