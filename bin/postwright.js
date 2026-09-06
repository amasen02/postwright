#!/usr/bin/env node
'use strict';
const {main}=require('../src/cli');
const {exitCodeFor,toSafeJson}=require('../src/core/errors');
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(toSafeJson(error)));process.exitCode=exitCodeFor(error);});
module.exports={main};
