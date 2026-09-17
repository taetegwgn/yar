const STORAGE_KEY = 'yarureong.rooms';

export function savedRooms() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

export class RoomClient {
  constructor({ onSnapshot, onStatus, onWarning }) {
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.onWarning = onWarning;
    this.session = null;
    this.epoch = 0;
    this.failures = 0;
  }
  async request(path, { token, method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetch(`/api/rooms${path}`, {
        method, cache: 'no-store', signal: AbortSignal.timeout(40000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new Error('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.');
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('공유 방 서버를 사용할 수 없습니다. 개발 서버 또는 Netlify 배포를 확인해 주세요.');
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || '공유 방 요청에 실패했습니다.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  remember() {
    const sessions = savedRooms();
    const { id, token, room } = this.session;
    sessions[id] = { token, name: room.name, role: room.me.role, nickname: room.me.name };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); }
    catch { this.onWarning('참여 인증을 저장하지 못했습니다. 이 창을 닫으면 방장 권한을 잃을 수 있습니다.'); }
  }
  async create(name, nickname) {
    const result = await this.request('', { method: 'POST', body: { name, nickname } });
    this.activate(result);
  }
  async join(id, nickname) {
    const result = await this.request(`/${id}/join`, { method: 'POST', body: { nickname } });
    this.activate(result);
  }
  async resume(id) {
    const credentials = savedRooms()[id];
    if (!credentials?.token) return false;
    const result = await this.request(`/${id}`, { token: credentials.token });
    this.activate({ ...result, token: credentials.token });
    return true;
  }
  activate({ room, token }) {
    this.stop();
    this.session = { id: room.id, token, room };
    this.remember();
    this.onSnapshot(room);
    this.onStatus('connected');
    this.schedule();
  }
  accept(data, epoch) {
    if (epoch !== this.epoch || !this.session || data.room.id !== this.session.id) return;
    if (data.room.revision >= this.session.room.revision) {
      this.session.room = data.room;
      this.onSnapshot(data.room);
    }
    if (data.warning) this.onWarning(data.warning);
  }
  async sync() {
    if (!this.session) return;
    const epoch = this.epoch;
    try {
      const result = await this.request(`/${this.session.id}`, { token: this.session.token });
      if (epoch !== this.epoch) return;
      this.accept(result, epoch);
      this.failures = 0;
      this.onStatus('connected');
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.failures++;
      this.onStatus(error.status === 401 || error.status === 404 ? 'expired' : 'offline');
      if (error.status === 401 || error.status === 404) {
        this.onWarning(error.message);
        clearTimeout(this.timer);
        return;
      }
    }
    if (epoch === this.epoch) this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), Math.min(30000, Math.max(document.hidden ? 10000 : 2000, 2000 * 2 ** this.failures)));
  }
  async action(path, body, method = 'POST') {
    if (!this.session) throw new Error('먼저 방에 참여해 주세요.');
    const epoch = this.epoch;
    const result = await this.request(`/${this.session.id}${path}`, { token: this.session.token, method, body });
    this.accept(result, epoch);
    return result;
  }
  stop() {
    clearTimeout(this.timer);
    this.epoch++;
    this.session = null;
    this.failures = 0;
  }
}
