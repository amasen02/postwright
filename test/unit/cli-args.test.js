'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {parseArgs}=require('../../src/cli-args');
test('CLI accepts draft, evidence and explicit release syntax',()=>{assert.equal(parseArgs(['draft','REST','--no-gif']).options.noGif,true);assert.equal(parseArgs(['lint','rest','--x-evidence','https://x.com/amasen02/status/123','--replies','2']).options.replies,2);assert.equal(parseArgs(['release','rest','--channel','x']).options.confirm,undefined);});
test('CLI rejects ambiguous and unknown options',()=>{for(const args of [['draft','REST','--gif','--no-gif'],['lint','--all','rest'],['release','rest','--channel','other'],['auth','--confirm'],['draft','a','--out'],['lint','a','--replies','2'],['lint','a','--force','one','--force','two']])assert.throws(()=>parseArgs(args),{code:'USAGE'});});
test('CLI accepts run with --visual, --channels, and --release --confirm',()=>{
 assert.equal(parseArgs(['run','REST']).input,'REST');
 assert.equal(parseArgs(['draft','REST','--visual','mindmap']).options.visual,'mindmap');
 assert.equal(parseArgs(['run','REST','--visual','diagram']).options.visual,'diagram');
 assert.deepEqual(parseArgs(['run','REST','--channels','x,devto']).options.channels,'x,devto');
 const released=parseArgs(['run','REST','--release','--confirm']);
 assert.equal(released.options.release,true);assert.equal(released.options.confirm,true);
});
test('CLI rejects an unknown --visual, a malformed --channels list, and a missing run topic',()=>{
 for(const args of [['run','REST','--visual','bogus'],['draft','REST','--visual','bogus'],['run','REST','--channels','x,x'],['run','REST','--channels','bogus'],['run']])assert.throws(()=>parseArgs(args),{code:'USAGE'});
});
