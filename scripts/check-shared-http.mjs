import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_ORIGIN || 'http://localhost:5173';
async function request(path, token, body) {
  const response = await fetch(`${base}/api/rooms${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, ...await response.json() };
}
const host = await request('', null, { name: 'HTTP 검증용 방', nickname: '방장' });
assert.equal(host.status, 201);
const path = `/${host.room.id}`;
const guest = await request(`${path}/join`, null, { nickname: '참여자' });
const added = await request(`${path}/nodes`, guest.token, { id: randomUUID(), label: '다른 기기의 생각', generation: 0 });
assert.equal(added.status, 201);
assert.equal((await request(path, host.token)).room.nodes.length, 1);
const denied = await request(`${path}/clear`, guest.token, { revision: added.room.revision });
assert.equal(denied.status, 403);
const cleared = await request(`${path}/clear`, host.token, { revision: added.room.revision });
assert.equal(cleared.status, 200);
assert.equal((await request(path, guest.token)).room.nodes.length, 0);
console.log('HTTP verification passed: create, join, shared input, guest clear 403, host clear 200, guest sees empty graph.');
