import test from 'node:test';
import assert from 'node:assert/strict';
import { addThought, ensureConnected, restoreGraph } from './graph-state.js';

test('adding a thought without an API key keeps it connected', () => {
  const state = { nodes: [{ id: 'first', label: '산책' }], edges: [] };
  addThought(state, { id: 'second', label: '숲', status: 'local' });
  assert.equal(state.edges.length, 1);
  assert.equal(state.edges[0].kind, 'provisional');
  assert.equal(state.edges[0].weight, 0);
});

test('first visit starts empty and stored examples are removed without deleting user input', () => {
  assert.deepEqual(restoreGraph(null), { nodes: [], edges: [] });
  const user = { id: 'user-1', label: '창의성', status: 'local' };
  assert.deepEqual(restoreGraph({nodes:[{id:'sample-0',status:'example'},user],edges:[{source:'sample-0',target:'user-1'}]}),{nodes:[user],edges:[]});
});

test('repairs saved disconnected thoughts and is idempotent', () => {
  const state = {nodes:[{id:'a'},{id:'b'},{id:'c'},{id:'d'}],edges:[{source:{id:'a'},target:{id:'b'},weight:0.9,kind:'gemini'}]};
  ensureConnected(state);
  assert.equal(state.edges.length,3);
  assert.equal(state.edges[0].kind,'gemini');
  ensureConnected(state);
  assert.equal(state.edges.length,3);
});

test('does not bridge already connected nodes or create a self edge', () => {
  const state={nodes:[],edges:[]};
  addThought(state,{id:'a'});
  assert.equal(state.edges.length,0);
  addThought(state,{id:'b'});
  state.edges[0]={source:'a',target:'b',weight:0.8,kind:'gemini'};
  ensureConnected(state);
  assert.equal(state.edges.length,1);
  assert.equal(state.edges[0].weight,0.8);
});
