import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';
import { getCollection } from '../config/database';
import { validate } from '../middleware/validate';
import { errorHandler, AppError } from '../middleware/errorHandler';
import { z } from 'zod';

/**
 * Direct coverage of the in-memory store's query/update surface, the
 * validate middleware, and the error handler — exercised through real
 * HTTP requests wherever possible.
 */

describe('in-memory store query operators', () => {
  let coll: ReturnType<typeof getCollection>;

  beforeEach(async () => {
    await resetDatabase();
    coll = getCollection('querytest');
    coll.deleteMany({});
  });

  function doc(over: Record<string, any> = {}) {
    return { _id: `qd-${Math.random().toString(36).slice(2)}`, name: 'x', ...over };
  }

  it('$regex with $options, $in, $ne, $exists', async () => {
    await coll.create(doc({ name: 'Alpha' }));
    await coll.create(doc({ name: 'beta' }));
    await coll.create(doc({ name: 'Gamma', tag: 'special' }));

    const re = await coll.find({ name: { $regex: '^a', $options: 'i' } });
    expect(re).toHaveLength(1);

    const ins = await coll.find({ name: { $in: ['Alpha', 'Gamma'] } });
    expect(ins).toHaveLength(2);

    const ne = await coll.find({ name: { $ne: 'Alpha' } });
    expect(ne).toHaveLength(2);

    const ex = await coll.find({ tag: { $exists: true } });
    expect(ex).toHaveLength(1);
    const nex = await coll.find({ tag: { $exists: false } });
    expect(nex).toHaveLength(2);
  });

  it('range operators $gt/$gte/$lt/$lte', async () => {
    await coll.create(doc({ n: 5 }));
    await coll.create(doc({ n: 10 }));
    await coll.create(doc({ n: 15 }));

    expect((await coll.find({ n: { $gt: 5, $lt: 15 } }))).toHaveLength(1);
    expect((await coll.find({ n: { $gte: 5, $lte: 15 } }))).toHaveLength(3);
    expect((await coll.find({ n: { $lt: 5 } }))).toHaveLength(0);
  });

  it('array query values require the doc to contain every element', async () => {
    await coll.create(doc({ tags: ['a', 'b'] }));
    await coll.create(doc({ tags: ['a'] }));
    await coll.create(doc({ tags: 'notarray' }));

    expect((await coll.find({ tags: ['a'] }))).toHaveLength(2);
    expect((await coll.find({ tags: ['a', 'b'] }))).toHaveLength(1);
  });

  it('plain object values deep-compare via JSON', async () => {
    await coll.create(doc({ meta: { a: 1 } }));
    await coll.create(doc({ meta: { a: 2 } }));

    expect((await coll.find({ meta: { a: 1 } }))).toHaveLength(1);
    expect((await coll.find({ meta: { a: 2 } }))).toHaveLength(1);
  });

  it('$or composes sub-queries', async () => {
    await coll.create(doc({ name: 'or-a' }));
    await coll.create(doc({ name: 'or-b' }));
    await coll.create(doc({ name: 'other' }));

    const found = await coll.find({
      $or: [{ name: 'or-a' }, { name: 'or-b' }],
    });
    expect(found).toHaveLength(2);
  });

  it('upsert via findOneAndUpdate creates when absent', async () => {
    const upserted = await coll.findOneAndUpdate(
      { name: 'does-not-exist' },
      { $set: { name: 'upserted', value: 42 } },
      { upsert: true, new: true }
    );
    expect(upserted).toBeTruthy();
    expect((upserted as any).value).toBe(42);

    const again = await coll.findOne({ name: 'upserted' });
    expect(again).toBeTruthy();
  });

  it('findOneAndUpdate returns old doc by default, new with option', async () => {
    await coll.create({ _id: 'fnu-1', name: 'fnu', status: 'old' });
    const old = await coll.findOneAndUpdate({ _id: 'fnu-1' }, { $set: { status: 'new' } });
    expect((old as any).status).toBe('old');
    const fresh = await coll.findOneAndUpdate({ _id: 'fnu-1' }, { $set: { status: 'newer' } }, { new: true });
    expect((fresh as any).status).toBe('newer');
  });

  it('aggregate $group with $sum and $addToSet', async () => {
    await coll.create(doc({ bucket: 'a', n: 1 }));
    await coll.create(doc({ bucket: 'a', n: 2 }));
    await coll.create(doc({ bucket: 'b', n: 3 }));

    const grouped = await coll.aggregate([
      { $group: { _id: '$bucket', total: { $sum: '$n' }, items: { $addToSet: '$bucket' } } },
    ]);
    const byId = new Map(grouped.map((g: any) => [g._id, g]));
    expect(byId.get('a').total).toBe(3);
    expect(byId.get('b').total).toBe(3);
    expect(byId.get('a').items).toContain('a');
  });

  it('deletePath via $unset on nested dotted paths', async () => {
    await coll.create({ _id: 'unset-1', name: 'u', metadata: { lastWarnedKey: 'k', other: 'v' } });
    await coll.findOneAndUpdate({ _id: 'unset-1' }, { $unset: { 'metadata.lastWarnedKey': '' } });
    const after = await coll.findOne({ _id: 'unset-1' });
    expect((after as any).metadata.lastWarnedKey).toBeUndefined();
    expect((after as any).metadata.other).toBe('v');
  });

  it('countDocuments honours the query', async () => {
    await coll.create(doc({ grp: 'one' }));
    await coll.create(doc({ grp: 'one' }));
    await coll.create(doc({ grp: 'two' }));
    expect(await coll.countDocuments({ grp: 'one' })).toBe(2);
    expect(await coll.countDocuments({})).toBe(3);
  });

  it('findOneAndDelete removes and returns the doc', async () => {
    await coll.create({ _id: 'del-1', name: 'd' });
    const removed = await coll.findOneAndDelete({ _id: 'del-1' });
    expect((removed as any)._id).toBe('del-1');
    expect(await coll.findOne({ _id: 'del-1' })).toBeNull();
    expect(await coll.findOneAndDelete({ _id: 'del-1' })).toBeNull();
  });
});

describe('validate middleware', () => {
  const schema = z.object({
    body: z.object({ email: z.string().email() }),
    query: z.any(),
    params: z.any(),
  });

  function makeApp() {
    const express = require('express') as typeof import('express');
    const a = express();
    a.use(express.json());
    a.post('/v', validate(schema), (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return a;
  }

  it('passes valid payloads through', async () => {
    const res = await request(makeApp()).post('/v').send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
  });

  it('returns 400 with field paths on invalid payloads', async () => {
    const res = await request(makeApp()).post('/v').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details[0].path).toBe('body.email');
  });
});

describe('errorHandler', () => {
  function makeApp(errFactory: () => Error) {
    const express = require('express') as typeof import('express');
    const a = express();
    a.get('/boom', (_req, _res, next) => next(errFactory()));
    a.use(errorHandler);
    return a;
  }

  it('uses AppError statusCode and message', async () => {
    const res = await request(makeApp(() => new AppError('Nope', 403))).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Nope');
  });

  it('maps generic errors to 500 in test env', async () => {
    const res = await request(makeApp(() => new Error('kaboom'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('kaboom');
  });
});

describe('auth middleware 401 paths', () => {
  beforeEach(resetDatabase);

  it('rejects missing tokens on protected routes with 401', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('rejects malformed bearer tokens', async () => {
    const res = await request(app).get('/api/notifications').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });
});

describe('models wrapper aliases (in-memory)', () => {
  it('findByIdAndDelete works with an id and with a query object', async () => {
    const { Workspace } = await import('../models');
    const ws: any = await Workspace.create({ name: 'alias-ws', ownerId: 'u1', plan: 'free' });

    const byId = await Workspace.findByIdAndDelete(ws._id);
    expect(byId).toBeTruthy();
    expect(await Workspace.findById(ws._id)).toBeNull();

    const ws2: any = await Workspace.create({ name: 'alias-ws2', ownerId: 'u1', plan: 'free' });
    const byQuery = await (Workspace as any).findByIdAndDelete({ _id: ws2._id });
    expect(byQuery).toBeTruthy();
  });

  it('deleteOne reports deletedCount', async () => {
    const { Workspace } = await import('../models');
    const ws: any = await Workspace.create({ name: 'delone', ownerId: 'u1', plan: 'free' });
    const res: any = await (Workspace as any).deleteOne({ _id: ws._id });
    expect(res.deletedCount).toBe(1);
    const res2: any = await (Workspace as any).deleteOne({ _id: ws._id });
    expect(res2.deletedCount).toBe(0);
  });
});
