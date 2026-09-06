'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEditorial,slugify,assertSafeTopic}=require('../../src/model/editorial');

test('known topics produce concrete channel-native editorial copy',()=>{
  const rest=createEditorial('idempotency keys in REST APIs');
  assert.equal(slugify(rest.topic),'idempotency-keys-in-rest-apis');
  assert.match(rest.x,/idempotency key/i);assert.ok(rest.x.length<=280);
  assert.doesNotMatch(rest.linkedin,/https?:\/\//i);
  assert.match(rest.article,/^---\ntitle: "Idempotency Keys in REST APIs"\ntags: \[rest, api, reliability, distributed-systems\]\npublished: false\ncover_image: asset\.gif\n---/);
  assert.match(rest.article,/https:\/\/docs\.stripe\.com\/api\/idempotent_requests/);
  const graph=createEditorial('GraphRAG vs vector RAG');
  assert.match(graph.x,/knowledge graph/i);assert.match(graph.article,/microsoft\.github\.io\/graphrag/);
});

test('topic validation refuses publishable private or credential-shaped input',()=>{
  for(const topic of ['', 'line\nbreak', 'C:\\Users\\operator\\notes', 'person@example.test', 'api_key=abcdefghijklmnopqrstuvwxyz123456'])assert.throws(()=>assertSafeTopic(topic),{code:'USAGE'});
});
