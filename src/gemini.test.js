import test from 'node:test';
import assert from 'node:assert/strict';
import { getConnections, validateConnections } from './gemini.js';

const nodes = [{ id: 'a', label: '산책', x: 100 }];

test('rejects invented IDs, duplicate IDs and invalid weights', () => {
  assert.deepEqual(validateConnections([{id:'x',weight:0.9},{id:'a',weight:2},{id:'a',weight:'0.8'},{id:'a',weight:0.8},{id:'a',weight:0.9}],nodes),[{id:'a',weight:0.8}]);
  assert.throws(()=>validateConnections({},nodes));
});

test('sends labels without coordinates and accepts a weak nearest match', async t => {
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.ok(url.endsWith('gemini-2.5-flash:generateContent'));
    const body=JSON.parse(options.body);
    const prompt=JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(prompt.existing,[{id:'a',label:'산책'}]);
    assert.equal(options.headers['x-goog-api-key'],'test-key');
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'[{"id":"a","weight":0.2}]'}]}}]}));
  });
  assert.deepEqual(await getConnections('우주',nodes,'test-key'),[{id:'a',weight:0.2}]);
});

test('empty graph needs no API request', async t => {
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected request');});
  assert.deepEqual(await getConnections('처음',[],'test-key'),[]);
  assert.equal(fetch.mock.callCount(),0);
});

test('rate limit and malformed responses are surfaced for retry', async t => {
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:429}));
  await assert.rejects(getConnections('숲',nodes,'test-key'),/요청 한도/);
  fetch.mock.mockImplementation(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'[]'}]}}]})));
  await assert.rejects(getConnections('숲',nodes,'test-key'),/연결을 찾지/);
});
