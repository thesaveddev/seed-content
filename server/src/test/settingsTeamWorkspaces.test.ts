import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase, type TestUser } from './helpers';
import { generateToken } from '../middleware/auth';
import { WorkspaceMember } from '../models';

// Valid OpenAI-format key: sk- + 24 chars
const GOOD_KEY = `sk-${'a'.repeat(24)}`;

/** Flip a workspace's plan directly in the data store. */
async function setPlan(workspaceId: string, plan: string): Promise<void> {
  const models = await import('../models');
  await models.Workspace.findByIdAndUpdate(workspaceId, { plan });
}

/**
 * A token scoped to a given workspace. The JWT's workspaceId is what
 * requireWorkspace/requireRole resolve against, so acting inside another
 * workspace needs a token minted for it — same as real multi-workspace use.
 */
function tokenFor(user: TestUser, workspaceId: string): string {
  return generateToken(user.user.id, workspaceId, false);
}

async function findMemberId(workspaceId: string, userId: string): Promise<string> {
  const m = await WorkspaceMember.findOne({ workspaceId, userId } as any);
  return String((m as any)._id);
}

describe('Settings, team, and workspaces routes', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  // ── Settings: API key ──────────────────────────────────────────

  it('settings api-key: starts unconfigured with a null masked key', async () => {
    const { token } = await registerUser('Key Starter');
    const res = await auth(token).get('/api/settings/api-key');
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.maskedKey).toBeNull();
    expect(res.body.data.provider).toBe('openai');
  });

  it('settings api-key: rejects a malformed key and a missing key', async () => {
    const { token } = await registerUser('Key Validator');

    const missing = await auth(token).put('/api/settings/api-key').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/required/i);

    const bad = await auth(token).put('/api/settings/api-key').send({ apiKey: 'not-a-real-key' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/invalid openai api key format/i);
  });

  it('settings api-key: saves, masks, and removes a key — never returning the raw value', async () => {
    const { token } = await registerUser('Key Saver');

    const saved = await auth(token).put('/api/settings/api-key').send({ apiKey: GOOD_KEY });
    expect(saved.status).toBe(200);
    expect(saved.body.data.configured).toBe(true);
    // maskKey = first 3 + ... + last 6
    expect(saved.body.data.maskedKey).toBe('sk-...aaaaaa');
    expect(saved.body.data.maskedKey).not.toContain(GOOD_KEY);

    const fetched = await auth(token).get('/api/settings/api-key');
    expect(fetched.body.data.configured).toBe(true);
    expect(fetched.body.data.maskedKey).toBe('sk-...aaaaaa');

    const removed = await auth(token).put('/api/settings/api-key').send({ remove: true });
    expect(removed.status).toBe(200);
    expect(removed.body.data.configured).toBe(false);

    const after = await auth(token).get('/api/settings/api-key');
    expect(after.body.data.configured).toBe(false);
  });

  // ── Settings: profile + password ───────────────────────────────

  it('settings profile: updates the name and normalises a new email', async () => {
    const { token } = await registerUser('Profile Person');
    const res = await auth(token).put('/api/settings/profile').send({
      name: '  Renamed Person  ',
      email: 'Renamed@EXAMPLE.com ',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('Renamed Person');
    expect(res.body.data.user.email).toBe('renamed@example.com');
  });

  it('settings profile: refuses an email already used by another account', async () => {
    const a = await registerUser('Profile A');
    const b = await registerUser('Profile B');

    const res = await auth(a.token).put('/api/settings/profile').send({ email: b.user.email });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  it('settings password: enforces field presence, length, and the current password', async () => {
    const { token } = await registerUser('Password Changer');

    const missing = await auth(token).put('/api/settings/password').send({ currentPassword: 'x' });
    expect(missing.status).toBe(400);

    const short = await auth(token)
      .put('/api/settings/password')
      .send({ currentPassword: 'Password123!', newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/at least 8/i);

    const wrong = await auth(token)
      .put('/api/settings/password')
      .send({ currentPassword: 'WrongPassword1!', newPassword: 'NewPassword123!' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatch(/incorrect/i);
  });

  it('settings password: rotates the credential — old password stops working', async () => {
    const { token, user } = await registerUser('Password Rotator');

    const changed = await auth(token)
      .put('/api/settings/password')
      .send({ currentPassword: 'Password123!', newPassword: 'BrandNew123!' });
    expect(changed.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Password123!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'BrandNew123!' });
    expect(newLogin.status).toBe(200);
  });

  // ── Workspaces ─────────────────────────────────────────────────

  it('workspaces: lists the registration workspace, creates a second, and lists both', async () => {
    const { token } = await registerUser('Space Owner');

    const initial = await auth(token).get('/api/workspaces');
    expect(initial.status).toBe(200);
    expect(initial.body.data.length).toBe(1);

    const created = await auth(token).post('/api/workspaces').send({ name: 'Second Space' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Second Space');
    expect(created.body.data.plan).toBe('free');

    const both = await auth(token).get('/api/workspaces');
    expect(both.body.data.length).toBe(2);
    expect(both.body.data.map((w: any) => w.name)).toContain('Second Space');
  });

  it('workspaces: current returns the workspace with a zeroed usage block', async () => {
    const { token } = await registerUser('Current Space');
    const res = await auth(token).get('/api/workspaces/current');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBeTruthy();
    expect(res.body.data.usage).toMatchObject({
      minutesProcessed: 0,
      generations: 0,
      projects: 0,
      exports: 0,
    });
  });

  it('workspaces: renames the current workspace', async () => {
    const { token } = await registerUser('Renaming Owner');
    const res = await auth(token).put('/api/workspaces/current').send({ name: 'Renamed Space' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Space');

    const check = await auth(token).get('/api/workspaces/current');
    expect(check.body.data.name).toBe('Renamed Space');
  });

  // ── Team: members ──────────────────────────────────────────────

  it('team members: the owner sees themself with user info enriched', async () => {
    const user = await registerUser('Listed Owner');
    const res = await auth(user.token).get('/api/team/members');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].role).toBe('owner');
    expect(res.body.data[0].user.name).toBe('Listed Owner');
    expect(res.body.data[0].user.email).toBe(user.user.email);
  });

  it('team brand-voices: returns an empty list for a fresh workspace', async () => {
    const { token } = await registerUser('Voice Lister');
    const res = await auth(token).get('/api/team/brand-voices');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // ── Team: invites ──────────────────────────────────────────────

  it('team invite: requires an email and blocks the free plan', async () => {
    const { token } = await registerUser('Free Inviter');

    const noEmail = await auth(token).post('/api/team/invite').send({});
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toMatch(/email is required/i);

    const free = await auth(token).post('/api/team/invite').send({ email: 'friend@test.local' });
    expect(free.status).toBe(403);
    expect(free.body.error).toMatch(/upgrade/i);
  });

  it('team invite: creates an invite on a paid plan, normalises unknown roles, and flags duplicates', async () => {
    const owner = await registerUser('Paid Inviter');
    await setPlan(owner.workspace.id, 'creator');

    // Unknown role falls back to 'member'
    const created = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: '  NewFriend@TEST.local ', role: 'boss' });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('newfriend@test.local');
    expect(created.body.data.role).toBe('member');
    expect(created.body.data.token).toBeTruthy();
    expect(created.body.data.inviteLink).toContain(created.body.data.token);

    // Duplicate pending invite → 409
    const dup = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: 'newfriend@test.local' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already pending/i);
  });

  it('team invite: blocks re-inviting an existing member and enforces the plan member cap', async () => {
    const owner = await registerUser('Cap Owner');
    await setPlan(owner.workspace.id, 'creator');

    const member = await registerUser('Cap Member');
    const inv = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: member.user.email });
    expect(inv.status).toBe(201);

    // Accept so they become a real member
    const accepted = await auth(member.token)
      .post('/api/team/accept-invite')
      .send({ token: inv.body.data.token });
    expect(accepted.status).toBe(200);

    // Now the pending-invite check no longer fires — the membership check does
    const already = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: member.user.email });
    expect(already.status).toBe(409);
    expect(already.body.error).toMatch(/already a member/i);

    // Fill the workspace to the creator cap (5 members total: owner + 4)
    const fillers: TestUser[] = [];
    for (let i = 0; i < 3; i++) {
      const filler = await registerUser(`Filler ${i}`);
      fillers.push(filler);
      await WorkspaceMember.create({
        workspaceId: owner.workspace.id,
        userId: filler.user.id,
        role: 'member',
      });
    }

    const capped = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: 'overthecap@test.local' });
    expect(capped.status).toBe(403);
    expect(capped.body.error).toMatch(/creator plan allows up to 5 members/i);
  });

  it('team invites: lists pending invites and revocation frees the email for a new invite', async () => {
    const owner = await registerUser('Revoke Owner');
    await setPlan(owner.workspace.id, 'creator');

    const created = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: 'revoke-me@test.local' });

    const listed = await auth(owner.token).get('/api/team/invites');
    expect(listed.status).toBe(200);
    const match = listed.body.data.find((i: any) => i.email === 'revoke-me@test.local');
    expect(match).toBeTruthy();
    expect(match.invitedBy).toBe('Revoke Owner');

    const revoked = await auth(owner.token).delete(`/api/team/invites/${created.body.data._id}`);
    expect(revoked.status).toBe(200);

    const reInvited = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: 'revoke-me@test.local' });
    expect(reInvited.status).toBe(201);
  });

  it('team accept-invite: validates the token, the email match, then joins the workspace', async () => {
    const owner = await registerUser('Accept Owner');
    await setPlan(owner.workspace.id, 'creator');
    const invitee = await registerUser('Accept Invitee');

    const missing = await auth(invitee.token).post('/api/team/accept-invite').send({});
    expect(missing.status).toBe(400);

    const unknown = await auth(invitee.token)
      .post('/api/team/accept-invite')
      .send({ token: 'no-such-token' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatch(/not found or expired/i);

    // An invite addressed to someone else cannot be accepted by invitee
    const wrongEmail = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: 'someone-else@test.local' });
    const wrongAccept = await auth(invitee.token)
      .post('/api/team/accept-invite')
      .send({ token: wrongEmail.body.data.token });
    expect(wrongAccept.status).toBe(403);
    expect(wrongAccept.body.error).toMatch(/different email/i);

    // The real flow: invite the invitee's own email, accept, verify membership
    const inv = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: invitee.user.email, role: 'viewer' });
    expect(inv.status).toBe(201);

    const accepted = await auth(invitee.token)
      .post('/api/team/accept-invite')
      .send({ token: inv.body.data.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.workspaceName).toBe(owner.workspace.name);
    expect(accepted.body.data.role).toBe('viewer');

    // Owner now sees two members
    const members = await auth(owner.token).get('/api/team/members');
    expect(members.body.data.length).toBe(2);

    // The token is single-use
    const replay = await auth(invitee.token)
      .post('/api/team/accept-invite')
      .send({ token: inv.body.data.token });
    expect(replay.status).toBe(404);
  });

  // ── Team: roles and removal ────────────────────────────────────

  it('team roles: only the owner can change roles, with guard rails', async () => {
    const owner = await registerUser('Role Owner');
    const memberUser = await registerUser('Role Member');
    const outsider = await registerUser('Role Outsider');

    await WorkspaceMember.create({
      workspaceId: owner.workspace.id,
      userId: memberUser.user.id,
      role: 'member',
    });

    const outsiderToken = tokenFor(outsider, owner.workspace.id);
    const ownerToken = tokenFor(owner, owner.workspace.id);

    // A member (not owner) of this workspace cannot change roles
    const forbidden = await auth(outsiderToken)
      .put('/api/team/members/whatever/role')
      .send({ role: 'admin' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatch(/insufficient permissions/i);

    const badRole = await auth(ownerToken)
      .put('/api/team/members/whatever/role')
      .send({ role: 'emperor' });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toMatch(/admin, member, viewer/i);

    const notFound = await auth(ownerToken)
      .put('/api/team/members/000000000000000000000000/role')
      .send({ role: 'admin' });
    expect(notFound.status).toBe(404);

    // Owner cannot be demoted
    const ownerMemberId = await findMemberId(owner.workspace.id, owner.user.id);
    const touchOwner = await auth(ownerToken)
      .put(`/api/team/members/${ownerMemberId}/role`)
      .send({ role: 'member' });
    expect(touchOwner.status).toBe(403);
    expect(touchOwner.body.error).toMatch(/cannot change the owner role/i);

    // Owner promotes the member to admin
    const memberMemberId = await findMemberId(owner.workspace.id, memberUser.user.id);
    const promoted = await auth(ownerToken)
      .put(`/api/team/members/${memberMemberId}/role`)
      .send({ role: 'admin' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('admin');
  });

  it('team removal: owner, admin-vs-admin, and missing-member guards all hold', async () => {
    const owner = await registerUser('Removal Owner');
    const adminUser = await registerUser('Removal Admin');
    const plainUser = await registerUser('Removal Plain');

    await WorkspaceMember.create({
      workspaceId: owner.workspace.id,
      userId: adminUser.user.id,
      role: 'admin',
    });
    await WorkspaceMember.create({
      workspaceId: owner.workspace.id,
      userId: plainUser.user.id,
      role: 'member',
    });

    const ownerToken = tokenFor(owner, owner.workspace.id);
    const adminToken = tokenFor(adminUser, owner.workspace.id);
    const plainToken = tokenFor(plainUser, owner.workspace.id);

    const adminId = await findMemberId(owner.workspace.id, adminUser.user.id);
    const plainId = await findMemberId(owner.workspace.id, plainUser.user.id);
    const ownerMemberId = await findMemberId(owner.workspace.id, owner.user.id);

    // Owner cannot be removed
    const removeOwner = await auth(ownerToken).delete(`/api/team/members/${ownerMemberId}`);
    expect(removeOwner.status).toBe(403);
    expect(removeOwner.body.error).toMatch(/cannot remove the workspace owner/i);

    // Admin cannot remove another admin
    const adminVsAdmin = await auth(adminToken).delete(`/api/team/members/${adminId}`);
    expect(adminVsAdmin.status).toBe(403);
    expect(adminVsAdmin.body.error).toMatch(/admins cannot remove other admins/i);

    // A plain member cannot remove anyone (insufficient role)
    const plainRemoves = await auth(plainToken).delete(`/api/team/members/${plainId}`);
    expect(plainRemoves.status).toBe(403);
    expect(plainRemoves.body.error).toMatch(/insufficient permissions/i);

    // Owner removes the admin — allowed
    const ownerRemovesAdmin = await auth(ownerToken).delete(`/api/team/members/${adminId}`);
    expect(ownerRemovesAdmin.status).toBe(200);

    // Removing a nonexistent member → 404
    const missing = await auth(ownerToken).delete('/api/team/members/000000000000000000000000');
    expect(missing.status).toBe(404);
  });

  it('team leave: sole owner is blocked, a joined member can leave, then is not a member', async () => {
    const owner = await registerUser('Leave Owner');
    await setPlan(owner.workspace.id, 'creator');

    // Sole owner cannot leave
    const blocked = await auth(owner.token).post('/api/team/leave').send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/only owner/i);

    // A joined member leaves successfully
    const joiner = await registerUser('Leave Joiner');
    const inv = await auth(owner.token)
      .post('/api/team/invite')
      .send({ email: joiner.user.email });
    expect(inv.status).toBe(201);
    const accepted = await auth(joiner.token)
      .post('/api/team/accept-invite')
      .send({ token: inv.body.data.token });
    expect(accepted.status).toBe(200);

    // Leave needs a token scoped to the owner's workspace (the JWT's
    // workspaceId is what the route resolves membership against)
    const joinerToken = tokenFor(joiner, owner.workspace.id);
    const left = await auth(joinerToken).post('/api/team/leave').send({});
    expect(left.status).toBe(200);

    // After leaving, leaving again → not a member
    const again = await auth(joinerToken).post('/api/team/leave').send({});
    expect(again.status).toBe(404);
    expect(again.body.error).toMatch(/not a member/i);
  });
});
