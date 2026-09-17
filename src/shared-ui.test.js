import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import { createRoomHandler } from '../server/rooms.js';

const bundle = await build({ configFile: false, logLevel: 'silent', build: { write: false, rollupOptions: { input: 'src/main.js' } } });
const code = bundle.output.find(file => file.type === 'chunk' && file.isEntry).code;
function api() {
  const data = new Map();
  return createRoomHandler({
    async get(id) { return structuredClone(data.get(id) || null); },
    async put(id, value, etag) {
      if ((data.get(id)?.etag ?? null) !== etag) return false;
      data.set(id, { data: structuredClone(value), etag: randomUUID() });
      return true;
    }
  });
}
function screen(handler, roomId, credentials) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: `http://localhost/${roomId ? '?room=' + roomId : ''}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (credentials) w.localStorage.setItem('yarureong.rooms', credentials);
  w.matchMedia = () => ({ matches: true });
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.AbortSignal = AbortSignal;
  w.fetch = (url, options) => handler(new Request(new URL(url, w.location.href), options));
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1024, height: 768, x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: 768 });
  w.SVGElement.prototype.getBoundingClientRect = w.HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(w.SVGElement.prototype, 'width', { get: () => ({ baseVal: { value: 1024 } }) });
  Object.defineProperty(w.SVGElement.prototype, 'height', { get: () => ({ baseVal: { value: 768 } }) });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.eval(code);
  const $ = selector => w.document.querySelector(selector);
  return { dom, w, $, submit: selector => $(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) };
}
async function until(condition) {
  const end = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > end) assert.fail('UI state did not settle');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('two independent screens share additions; only the host can clear; personal data survives', { timeout: 20000 }, async t => {
  const handler = api();
  const host = screen(handler);
  t.after(() => host.dom.window.close());
  assert.equal(host.$('#node-count').textContent, '0개의 생각');
  host.$('#thought').value = '개인 기록';
  host.submit('#composer');
  assert.equal(host.$('#node-count').textContent, '1개의 생각');
  host.$('#room-menu').click();
  host.$('#nickname').value = '방장';
  host.$('#room-name').value = '함께 쓰는 방';
  host.submit('#create-room-form');
  await until(() => host.$('#room-role').textContent === '방장');
  assert.equal(host.$('#node-count').textContent, '0개의 생각');
  const roomId = new URL(host.w.location.href).searchParams.get('room');
  assert.ok(roomId);
  const guest = screen(handler, roomId);
  t.after(() => guest.dom.window.close());
  guest.$('#nickname').value = '참여자';
  guest.submit('#join-room-form');
  await until(() => guest.$('#room-role').textContent === '참여자');
  assert.equal(guest.$('#clear').hidden, true);
  guest.$('#thought').value = '함께 남긴 생각';
  guest.submit('#composer');
  await until(() => guest.$('#node-count').textContent === '1개의 생각');
  await until(() => host.$('#node-count').textContent === '1개의 생각');
  assert.equal(host.$('#graph .node text').textContent, '함께 남긴 생각');
  assert.equal(host.$('#clear').hidden, false);
  host.$('#clear').click();
  assert.equal(host.$('#clear-dialog').open, true);
  host.$('#confirm-clear').click();
  await until(() => host.$('#node-count').textContent === '0개의 생각');
  await until(() => guest.$('#node-count').textContent === '0개의 생각');
  assert.equal(guest.$('#graph .nodes').children.length, 0);
  host.$('#room-menu').click();
  assert.ok(!host.$('#invite-link').value.includes('token'));
  host.$('#leave-room').click();
  assert.equal(host.$('#node-count').textContent, '1개의 생각');
  assert.equal(host.$('#graph .node text').textContent, '개인 기록');
  const resumed = screen(handler, roomId, host.w.localStorage.getItem('yarureong.rooms'));
  t.after(() => resumed.dom.window.close());
  await until(() => resumed.$('#room-role').textContent === '방장');
  assert.equal(resumed.$('#node-count').textContent, '0개의 생각');
  assert.equal(resumed.$('#room-dialog').open, false);
});
