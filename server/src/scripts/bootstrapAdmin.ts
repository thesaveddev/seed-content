/**
 * Bootstrap the first platform admin.
 *
 * Usage:
 *   npm run bootstrap:admin                      # promote by email
 *   ADMIN_EMAIL=you@example.com npm run bootstrap:admin
 *
 * Run on the machine that can reach the production database
 * (e.g. inside the container: docker compose exec app npm run bootstrap:admin)
 */
import mongoose from 'mongoose';
import { config } from '../config/env';
import { connectDatabase, isUsingInMemory } from '../config/database';
import { User } from '../models';

async function main() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;

  if (!email) {
    console.error('Usage: npm run bootstrap:admin -- <email>');
    console.error('   or: ADMIN_EMAIL=<email> npm run bootstrap:admin');
    process.exit(1);
  }

  await connectDatabase();

  if (isUsingInMemory()) {
    console.error('❌ No database connection — refusing to bootstrap against the in-memory store.');
    process.exit(1);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    console.error(`❌ No user found with email "${email}". Register first, then re-run.`);
    process.exit(1);
  }

  if ((user as any).isAdmin) {
    console.log(`ℹ️  ${email} is already an admin.`);
  } else {
    await User.findByIdAndUpdate(user._id, { isAdmin: true });
    console.log(`✅ ${email} is now a platform admin.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Bootstrap failed:', err.message);
  process.exit(1);
});
