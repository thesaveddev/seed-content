const BASE = 'http://localhost:3001/api';

async function test() {
  // Register
  const reg = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ws-test-${Date.now()}@test.com`, password: 'Test1234!', name: 'WS Test' }),
  });
  const regData = await reg.json();
  console.log('Register response:', JSON.stringify(regData).slice(0, 300));

  const token = regData.data.token;
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Check /me to see what workspace we get
  const meRes = await fetch(`${BASE}/auth/me`, { headers: h });
  const meData = await meRes.json();
  console.log('\n/me response:', JSON.stringify(meData).slice(0, 500));

  // Check workspaces
  const wsRes = await fetch(`${BASE}/workspaces/current`, { headers: h });
  const wsData = await wsRes.json();
  console.log('\n/workspace/current response:', JSON.stringify(wsData).slice(0, 300));

  // Try creating content
  const contentRes = await fetch(`${BASE}/content/text`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      title: 'Test',
      text: 'I spent 3 months building a SaaS and learned lessons about product development.',
      goal: 'authority',
      selectedPlatforms: ['linkedin', 'x'],
    }),
  });
  const contentData = await contentRes.json();
  console.log('\nContent creation response:', JSON.stringify(contentData).slice(0, 500));
}

test().catch((e) => { console.error('❌ Failed:', e.message); process.exit(1); });
