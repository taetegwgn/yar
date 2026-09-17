import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ensureConnected } from '../src/graph-state.js';
import { getConnections } from '../src/gemini.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const digest = token => createHash('sha256').update(token).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const MEMBER_COLORS = ['#f54e00', '#1f8a65', '#5372b8', '#875eb5', '#a87520', '#bf4b67', '#217d82', '#7e6c44'];
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${name}을 확인해 주세요 (최대 ${max}자).`);
  return value.trim();
};
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

function authenticate(room, request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) fail(401, '방에 다시 참여해 주세요.');
  const hash = Buffer.from(digest(token), 'hex');
  const member = room.members.find(m => timingSafeEqual(Buffer.from(m.tokenHash, 'hex'), hash));
  if (!member) fail(401, '이 방의 참여 인증이 유효하지 않습니다.');
  return member;
}
function requireHost(member) {
  if (member.role !== 'host') fail(403, '전체 삭제는 방장만 할 수 있습니다.');
}
function publicRoom(room, member, aiEnabled) {
  const members = room.members.map((item, index) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    color: item.color || MEMBER_COLORS[index % MEMBER_COLORS.length],
    nodeCount: room.nodes.filter(node => node.authorId === item.id).length
  }));
  return {
    id: room.id, name: room.name, revision: room.revision, generation: room.generation,
    memberCount: room.members.length, members, me: { id: member.id, name: member.name, role: member.role },
    aiEnabled, nodes: room.nodes.map(({ analysisId, analysisStarted, ...n }) => n), edges: room.edges
  };
}

export function createRoomHandler(store, { apiKey = '', analyze = getConnections, now = Date.now } = {}) {
  async function load(id) {
    const value = await store.get(id);
    if (!value) fail(404, '방을 찾을 수 없습니다. 초대 링크를 확인해 주세요.');
    return value;
  }
  // Conditional writes retry against the newest room, preventing lost concurrent edits.
  async function mutate(id, change) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const { data, etag } = await load(id);
      const room = structuredClone(data);
      change(room);
      room.revision++;
      room.updatedAt = now();
      if (await store.put(id, room, etag)) return room;
    }
    fail(409, '동시 변경이 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  return async function handle(request) {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
      if (parts[0] !== 'api' || parts[1] !== 'rooms' || parts.length > 5) fail(404, '요청 경로가 올바르지 않습니다.');
      const [, , id, action, nodeId] = parts;
      const method = request.method;
      if (!['GET', 'POST', 'DELETE'].includes(method)) fail(405, '지원하지 않는 요청입니다.');
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) fail(403, '다른 사이트에서 보낸 요청은 허용하지 않습니다.');
      let body = {};
      if (method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON 요청만 허용합니다.');
        if (Number(request.headers.get('content-length')) > 8192) fail(413, '요청이 너무 큽니다.');
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 8192) fail(413, '요청이 너무 큽니다.');
        try { body = JSON.parse(raw); } catch { fail(400, 'JSON 형식이 올바르지 않습니다.'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, '요청 내용을 확인해 주세요.');
      }
      if (!id && method === 'POST') {
        const token = secret();
        const host = { id: randomUUID(), name: text(body.nickname, 30, '닉네임'), role: 'host', color: MEMBER_COLORS[0], tokenHash: digest(token) };
        const room = { id: randomUUID(), name: text(body.name, 60, '방 이름'), revision: 1, generation: 0, members: [host], nodes: [], edges: [], updatedAt: now() };
        if (!await store.put(room.id, room, null)) fail(409, '방 생성에 실패했습니다. 다시 시도해 주세요.');
        return json({ token, room: publicRoom(room, host, !!apiKey) }, 201);
      }
      if (!validId(id)) fail(404, '초대 링크의 방 ID가 올바르지 않습니다.');
      if (action === 'join' && !nodeId && method === 'POST') {
        const token = secret();
        const guest = { id: randomUUID(), name: text(body.nickname, 30, '닉네임'), role: 'guest', tokenHash: digest(token) };
        const room = await mutate(id, r => {
          if (r.members.length >= 100) fail(409, '이 방의 참여 한도에 도달했습니다.');
          guest.color = MEMBER_COLORS[r.members.length % MEMBER_COLORS.length];
          r.members.push(guest);
        });
        return json({ token, room: publicRoom(room, guest, !!apiKey) }, 201);
      }
      const { data: current } = await load(id);
      const member = authenticate(current, request);
      if (!action && method === 'GET') return json({ room: publicRoom(current, member, !!apiKey) });
      if (action === 'clear' && !nodeId && method === 'POST') {
        const room = await mutate(id, r => {
          requireHost(authenticate(r, request));
          if (body.revision !== r.revision) fail(409, '다른 참여자가 내용을 변경했습니다. 삭제할 내용을 다시 확인해 주세요.');
          r.nodes = []; r.edges = []; r.generation++;
        });
        return json({ room: publicRoom(room, member, !!apiKey) });
      }
      if (action === 'nodes' && !nodeId && method === 'POST') {
        const label = text(body.label, 160, '생각');
        if (!validId(body.id)) fail(400, '생각 ID가 올바르지 않습니다.');
        const room = await mutate(id, r => {
          const author = authenticate(r, request);
          if (body.generation !== r.generation) fail(409, '방이 초기화되었습니다. 내용을 확인하고 다시 입력해 주세요.');
          if (r.nodes.some(n => n.id === body.id && n.authorId === author.id && n.label === label)) return;
          if (r.nodes.some(n => n.id === body.id || n.label.toLocaleLowerCase() === label.toLocaleLowerCase())) fail(409, '이미 기록된 생각입니다.');
          if (r.nodes.length >= 200) fail(409, '방당 최대 200개의 생각을 기록할 수 있습니다.');
          r.nodes.push({ id: body.id, label, authorId: author.id, authorName: author.name, status: 'local', createdAt: now() });
          ensureConnected(r);
        });
        return json({ room: publicRoom(room, member, !!apiKey) }, 201);
      }
      if (action === 'nodes' && validId(nodeId) && method === 'DELETE') {
        const room = await mutate(id, r => {
          const author = authenticate(r, request);
          const n = r.nodes.find(n => n.id === nodeId);
          if (!n) fail(404, '이미 삭제된 생각입니다.');
          if (author.role !== 'host' && author.id !== n.authorId) fail(403, '본인이 작성한 생각만 삭제할 수 있습니다.');
          r.nodes = r.nodes.filter(n => n.id !== nodeId);
          r.edges = r.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
          ensureConnected(r);
        });
        return json({ room: publicRoom(room, member, !!apiKey) });
      }
      if (action === 'analyze' && validId(nodeId) && method === 'POST') {
        if (!apiKey) fail(503, '공유 방의 Gemini 키가 서버에 설정되지 않았습니다.');
        const analysisId = randomUUID();
        const locked = await mutate(id, r => {
          const author = authenticate(r, request);
          const n = r.nodes.find(n => n.id === nodeId);
          if (!n) fail(404, '이미 삭제된 생각입니다.');
          if (author.role !== 'host' && n.authorId !== author.id) fail(403, '본인이 작성한 생각만 분석할 수 있습니다.');
          if (n.status === 'pending' && now() - n.analysisStarted < 45000) fail(409, '이미 분석 중입니다.');
          n.status = 'pending'; n.analysisId = analysisId; n.analysisStarted = now();
        });
        const n = locked.nodes.find(n => n.id === nodeId);
        let matches, message;
        try {
          matches = await analyze(n.label, locked.nodes.filter(v => v.id !== nodeId), apiKey, AbortSignal.timeout(30000));
        } catch {
          message = '의미 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.';
        }
        const room = await mutate(id, r => {
          const target = r.nodes.find(v => v.id === nodeId);
          if (r.generation !== locked.generation || target?.analysisId !== analysisId) return;
          delete target.analysisId; delete target.analysisStarted;
          if (!matches) { target.status = 'failed'; return; }
          const valid = matches.filter(e => r.nodes.some(n => n.id === e.id) && e.id !== nodeId);
          const strong = valid.filter(e => e.weight > 0.5);
          const chosen = strong.length ? strong : valid.sort((a, b) => b.weight - a.weight).slice(0, 1);
          r.edges = r.edges.filter(e => e.source !== nodeId && !(e.kind === 'provisional' && e.target === nodeId));
          r.edges.push(...chosen.map(e => ({ source: nodeId, target: e.id, weight: e.weight, kind: 'gemini' })));
          target.status = 'done';
          ensureConnected(r);
        });
        return json({ room: publicRoom(room, member, !!apiKey), ...(message ? { warning: message } : {}) });
      }
      fail(404, '요청 경로가 올바르지 않습니다.');
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : '서버 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, error instanceof HttpError ? error.status : 500);
    }
  };
}
