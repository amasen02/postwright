'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
const bin=path.resolve(__dirname,'../../bin/postwright.js');
test('unconfirmed release refuses before draft lookup or account interaction',()=>{const result=spawnSync(process.execPath,[bin,'release','_gate-demo','--channel','x'],{encoding:'utf8',timeout:5000});assert.notEqual(result.status,0);assert.match(result.stderr,/confirm/i);});
test('help is usable without account or model discovery',()=>{const result=spawnSync(process.execPath,[bin,'--help'],{encoding:'utf8',timeout:5000});assert.equal(result.status,0);assert.match(result.stdout,/postwright draft/);});
