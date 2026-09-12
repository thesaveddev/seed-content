import mongoose from 'mongoose';
import { config } from './env';

let isConnected = false;

class InMemoryCollection {
  private data: Map<string, Record<string, any>> = new Map();

  async findOne(query: Record<string, any> = {}): Promise<Record<string, any> | null> {
    for (const doc of this.data.values()) {
      if (this.matches(doc, query)) return { ...doc };
    }
    return null;
  }

  async find(query: Record<string, any> = {}): Promise<Record<string, any>[]> {
    return Array.from(this.data.values()).filter((doc) => this.matches(doc, query)).map((d) => ({ ...d }));
  }

  async create(data: Record<string, any>): Promise<Record<string, any>> {
    const id = data._id || require('crypto').randomUUID();
    const coll = this;
    const doc: any = { ...data, _id: id, createdAt: new Date(), updatedAt: new Date() };
    // Attach save/toObject so Mongoose-style code works
    doc.save = async function() { this.updatedAt = new Date(); coll.data.set(this._id, { ...this }); return this; };
    doc.toObject = function() { const { save, toObject, ...rest } = this; return rest; };
    this.data.set(id, doc);
    return doc;
  }

  private hydrate(doc: Record<string, any>): any {
    const coll = this;
    const d: any = { ...doc };
    d.save = async function() { this.updatedAt = new Date(); coll.data.set(this._id, { ...this }); return this; };
    d.toObject = function() { const { save, toObject, ...rest } = this; return rest; };
    return d;
  }

  async findOneAndUpdate(query: Record<string, any>, update: Record<string, any>, options: Record<string, any> = {}): Promise<Record<string, any> | null> {
    const doc = await this.findOne(query);
    if (!doc && !options.upsert) return null;
    if (doc) {
      // applyUpdate copies the doc and applies operators in place, so $unset
      // genuinely removes keys (a { ...doc, ...result } spread would re-add them).
      const updated = this.applyUpdate(doc, update);
      updated.updatedAt = new Date();
      this.data.set(doc._id, updated);
      return options.new ? this.hydrate(updated) : this.hydrate(doc);
    }
    if (options.upsert) {
      return this.create({ ...query, ...this.applyUpdate({}, update) });
    }
    return null;
  }

  async findOneAndDelete(query: Record<string, any>): Promise<Record<string, any> | null> {
    for (const [id, doc] of this.data.entries()) {
      if (this.matches(doc, query)) { this.data.delete(id); return doc; }
    }
    return null;
  }

  async deleteMany(query: Record<string, any>): Promise<{ deletedCount: number }> {
    let count = 0;
    for (const [id, doc] of this.data.entries()) {
      if (this.matches(doc, query)) { this.data.delete(id); count++; }
    }
    return { deletedCount: count };
  }

  async updateMany(query: Record<string, any>, update: Record<string, any>): Promise<{ modifiedCount: number }> {
    let count = 0;
    for (const [id, doc] of this.data.entries()) {
      if (this.matches(doc, query)) {
        const updated = this.applyUpdate(doc, update);
        updated.updatedAt = new Date();
        this.data.set(id, updated);
        count++;
      }
    }
    return { modifiedCount: count };
  }

  async countDocuments(query: Record<string, any> = {}): Promise<number> {
    return Array.from(this.data.values()).filter((doc) => this.matches(doc, query)).length;
  }

  private resolveRef(val: any, doc: Record<string, any>): any {
    if (typeof val === 'string' && val.startsWith('$')) return doc[val.slice(1)];
    return val;
  }

  async aggregate(pipeline: Record<string, any>[]): Promise<Record<string, any>[]> {
    let results = Array.from(this.data.values());
    for (const stage of pipeline) {
      if (stage.$match) results = results.filter((doc) => this.matches(doc, stage.$match));
      if (stage.$group) {
        const groups = new Map<string, Record<string, any>>();
        for (const doc of results) {
          const groupIdVal = this.resolveRef(stage.$group._id, doc);
          const groupId = groupIdVal === null || groupIdVal === undefined ? '__null__' : String(groupIdVal);
          if (!groups.has(groupId)) groups.set(groupId, { _id: groupIdVal ?? null });
          const group = groups.get(groupId)!;
          for (const [field, op] of Object.entries(stage.$group)) {
            if (field === '_id') continue;
            const opObj = op as Record<string, any>;
            if (opObj.$sum !== undefined) {
              const sumVal = this.resolveRef(opObj.$sum, doc);
              group[field] = (group[field] || 0) + (sumVal === 1 ? 1 : (sumVal || 0));
            }
            if (opObj.$addToSet !== undefined) {
              const addVal = this.resolveRef(opObj.$addToSet, doc);
              if (!group[field]) group[field] = [];
              if (!group[field].includes(addVal)) group[field].push(addVal);
            }
          }
        }
        results = Array.from(groups.values());
      }
    }
    return results;
  }

  private matches(doc: Record<string, any>, query: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or' && Array.isArray(value)) {
        if (!value.some((q) => this.matches(doc, q))) return false;
        continue;
      }
      const docVal = doc[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const v = value as Record<string, any>;
        if (v.$regex && new RegExp(v.$regex, v.$options || '').test(String(docVal || ''))) continue;
        if (v.$regex && !new RegExp(v.$regex, v.$options || '').test(String(docVal || ''))) return false;
        if (v.$gt !== undefined && !(docVal > v.$gt)) return false;
        if (v.$gte !== undefined && !(docVal >= v.$gte)) return false;
        if (v.$lt !== undefined && !(docVal < v.$lt)) return false;
        if (v.$lte !== undefined && !(docVal <= v.$lte)) return false;
        if (v.$in !== undefined && !v.$in.includes(docVal)) return false;
        if (v.$ne !== undefined && docVal === v.$ne) return false;
        if (v.$exists !== undefined && (v.$exists ? docVal === undefined : docVal !== undefined)) return false;
        if (!v.$regex && v.$gt === undefined && v.$gte === undefined && v.$lt === undefined && v.$lte === undefined && v.$in === undefined && v.$ne === undefined && v.$exists === undefined) {
          if (JSON.stringify(docVal) !== JSON.stringify(value)) return false;
        }
      } else if (Array.isArray(value)) {
        if (!Array.isArray(docVal) || !value.every((v) => docVal.includes(v))) return false;
      } else {
        if (docVal !== value) return false;
      }
    }
    return true;
  }

  private applyUpdate(doc: Record<string, any>, update: Record<string, any>): Record<string, any> {
    // Copies the doc and applies operators in place, so $unset genuinely
    // removes keys (a { ...doc, ...result } spread would re-add them).
    // Dotted keys ('metadata.lastWarnedKey') write/delete nested paths like
    // MongoDB instead of creating literal dotted property names.
    const result = { ...doc };
    const applyPatch = (patch: Record<string, any>, isUnset = false) => {
      for (const [key, val] of Object.entries(patch)) {
        if (isUnset) deletePath(result, key);
        else setPath(result, key, val);
      }
    };
    if (update.$set) applyPatch(update.$set);
    if (update.$unset) applyPatch(update.$unset, true);
    if (update.$inc) {
      for (const [key, val] of Object.entries(update.$inc)) {
        setPath(result, key, (getPath(result, key) || 0) + (val as number));
      }
    }
    if (update.$push) {
      for (const [key, val] of Object.entries(update.$push)) {
        const arr = getPath(result, key);
        setPath(result, key, Array.isArray(arr) ? [...arr, val] : [val]);
      }
    }
    if (!update.$set && !update.$unset && !update.$inc && !update.$push) applyPatch(update);
    return result;
  }
}

const collections: Map<string, InMemoryCollection> = new Map();

function setPath(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj: Record<string, any>, path: string): any {
  let cur: any = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function deletePath(obj: Record<string, any>, path: string): void {
  const parts = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

export function getCollection(name: string): InMemoryCollection {
  if (!collections.has(name)) collections.set(name, new InMemoryCollection());
  return collections.get(name)!;
}

let useInMemory = false;

export async function connectDatabase(): Promise<void> {
  if (isConnected) return;

  // Tests are hermetic: never touch a real MongoDB, always use the in-memory store.
  if (config.NODE_ENV === 'test') {
    useInMemory = true;
    isConnected = true;
    return;
  }

  try {
    await mongoose.connect(config.MONGODB_URI);
    isConnected = true;
    console.log('✅ Connected to MongoDB');
    return;
  } catch {
    console.warn('⚠️  MongoDB not available, using in-memory database');
  }
  useInMemory = true;
  isConnected = true;
  console.log('✅ In-memory database ready (no external dependencies needed)');
}

export function isUsingInMemory(): boolean { return useInMemory; }
