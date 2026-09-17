import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoomHandler } from './rooms.js';
import { localStore } from './local-store.js';

function memoryStore() {
  const rooms = new Map();
  return {
    async get(id) { return structuredClone(rooms.get(id) || null); },
    async put(id, data, etag) {
      if ((rooms.get(id)?.etag ?? null) !== etag) return false;
      rooms.set(id, { data: structuredClone(data), etag: randomUUID() });
      return true;
    }
  };
}
function client(handler) {
  return async (path = '', { method = 'GET', token, body } = {}) => {
    const response = await handler(new Request(`http://localhost/api/rooms${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    }));
    return { status: response.status, ...await response.json() };
  };
}
async function setup(options = {}) {
  const request = client(createRoomHandler(memoryStore(), options));
  const host = await request('', { method: 'POST', body: { name: '우리 방', nickname: '방장' } });
  assert.equal(host.status, 201);
  const path = `/${host.room.id}`;
  const guest = await request(`${path}/join`, { method: 'POST', body: { nickname: '참여자', role: 'host' } });
  const add = (person, label, generation = 0) => request(`${path}/nodes`, { method: 'POST', token: person.token, body: { id: randomUUID(), label, generation } });
  return { request, host, guest, path, add };
}

test('guest role is server-assigned; no host secrets leak in room snapshots', async () => {
  const { request, guest, path } = await setup();
  assert.equal(guest.room.me.role, 'guest');
  const snapshot = await request(path, { token: guest.token });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.room.memberCount, 2);
  assert.ok(!JSON.stringify(snapshot).includes('tokenHash'));
  assert.equal(snapshot.room.members, undefined);
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { token: 'x'.repeat(43) })).status, 401);
});

test('guests cannot clear by calling the API directly; host clear is visible to guests', async () => {
  const { request, host, guest, path, add } = await setup();
  const added = await add(guest, '산책');
  const body = { revision: added.room.revision, role: 'host' };
  assert.equal((await request(`${path}/clear`, { method: 'POST', token: guest.token, body })).status, 403);
  assert.equal((await request(`${path}/clear`, { method: 'POST', body })).status, 401);
  const cleared = await request(`${path}/clear`, { method: 'POST', token: host.token, body });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.room.nodes.length, 0);
  const snapshot = await request(path, { token: guest.token });
  assert.deepEqual(snapshot.room.nodes, []);
  assert.deepEqual(snapshot.room.edges, []);
  assert.equal(snapshot.room.generation, 1);
});

test('concurrent additions are merged, and guests can only delete their own nodes', async () => {
  const { request, host, guest, path, add } = await setup();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => add(i % 2 ? guest : host, `생각 ${i}`)));
  assert.ok(results.every(r => r.status === 201));
  const snapshot = await request(path, { token: host.token });
  assert.equal(snapshot.room.nodes.length, 8);
  assert.equal(snapshot.room.edges.length, 7);
  const hostNode = snapshot.room.nodes.find(n => n.authorId === host.room.me.id);
  assert.equal((await request(`${path}/nodes/${hostNode.id}`, { method: 'DELETE', token: guest.token })).status, 403);
  const own = snapshot.room.nodes.find(n => n.authorId === guest.room.me.id);
  assert.equal((await request(`${path}/nodes/${own.id}`, { method: 'DELETE', token: guest.token })).status, 200);
});

test('clear checks the confirmed revision; pre-clear submissions cannot resurrect nodes', async () => {
  const { request, host, guest, path, add } = await setup();
  const before = await request(path, { token: host.token });
  const added = await add(guest, '나중에 추가된 생각');
  assert.equal((await request(`${path}/clear`, { method: 'POST', token: host.token, body: { revision: before.room.revision } })).status, 409);
  await request(`${path}/clear`, { method: 'POST', token: host.token, body: { revision: added.room.revision } });
  assert.equal((await add(guest, '늦게 도착한 생각', 0)).status, 409);
  assert.equal((await add(guest, '새 생각', 1)).status, 201);
});

test('host tokens from another room are rejected and guest-supplied edges are ignored', async () => {
  const { request, host, guest, path } = await setup();
  const other = await request('', { method: 'POST', body: { name: '다른 방', nickname: '다른 방장' } });
  assert.equal((await request(`${path}/clear`, { method: 'POST', token: other.token, body: { revision: guest.room.revision } })).status, 401);
  const id = randomUUID();
  const body = { id, label: '정상 생각', generation: 0, authorId: host.room.me.id, status: 'done', edges: [{ source: id, target: id, weight: 1 }] };
  const first = await request(`${path}/nodes`, { method: 'POST', token: guest.token, body });
  const retry = await request(`${path}/nodes`, { method: 'POST', token: guest.token, body });
  assert.equal(first.room.nodes[0].authorId, guest.room.me.id);
  assert.equal(retry.room.nodes.length, 1);
  assert.equal(retry.room.edges.length, 0);
});

test('an analysis response arriving after clear cannot restore deleted content', async () => {
  let finish, started;
  const began = new Promise(resolve => { started = resolve; });
  const work = new Promise(resolve => { finish = resolve; });
  const { request, host, guest, path, add } = await setup({ apiKey: 'test-key', analyze: async () => { started(); return work; } });
  const added = await add(guest, '숲');
  const id = added.room.nodes[0].id;
  const pending = request(`${path}/analyze/${id}`, { method: 'POST', token: guest.token, body: {} });
  await began;
  const latest = await request(path, { token: host.token });
  await request(`${path}/clear`, { method: 'POST', token: host.token, body: { revision: latest.room.revision } });
  finish([]);
  await pending;
  const snapshot = await request(path, { token: guest.token });
  assert.deepEqual(snapshot.room.nodes, []);
  assert.deepEqual(snapshot.room.edges, []);
});

test('local server persists shared rooms across handler restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'yarureong-room-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = client(createRoomHandler(localStore(directory)));
  const created = await first('', { method: 'POST', body: { name: '저장되는 방', nickname: '방장' } });
  const second = client(createRoomHandler(localStore(directory)));
  const restored = await second(`/${created.room.id}`, { token: created.token });
  assert.equal(restored.status, 200);
  assert.equal(restored.room.me.role, 'host');
});
