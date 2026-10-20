import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const runtimeUrl = new URL('../runtime-file-utils.mjs', import.meta.url).href
function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-runtime-json-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function execute(dir, body) {
  const source = `import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
    const runtimeUrl=${JSON.stringify(runtimeUrl)}; const root=process.env.GEEKGEEKRUN_RUNTIME_DIR;
    ${body}`
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: dir, GEEKGEEKRUN_TASK_CONFIG_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let error = ''; child.stderr.on('data', data => { error += data })
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(error)))
  })
}

test('real runtime APIs initialize missing defaults and retain optional-file/text behavior', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl); r.ensureConfigFileExist();r.ensureStorageFileExist();
    assert.equal(r.readConfigFile('boss.json').autoChatRunBudget.requests,500);
    assert.deepEqual(r.readStorageFile('boss-cookies.json'),[]);assert.deepEqual(r.readStorageFile('boss-local-storage.json'),{});
    assert.equal(r.readConfigFile('optional.json'),null);assert.equal(r.readStorageFile('prompt.txt',{isJson:false}),null);
    await r.writeStorageFile('prompt.txt','保留换行\\n',{isJson:false});assert.equal(r.readStorageFile('prompt.txt',{isJson:false}),'保留换行\\n');
    await r.writeStorageFile('bytes.bin',new Uint8Array([0,1,255]),{isJson:false});assert.deepEqual([...fs.readFileSync(path.join(r.storageFilePath,'bytes.bin'))],[0,1,255]);`)
})

test('malformed configuration and credentials remain intact and parse errors reveal no values', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl);r.ensureConfigFileExist();r.ensureStorageFileExist();
    for(const [kind,name] of [['config','boss.json'],['storage','boss-cookies.json'],['storage','boss-local-storage.json']]){
      const file=path.join(kind==='config'?r.configFolderPath:r.storageFilePath,name),broken='{"fixtureSecret":"NOT_A_REAL_SECRET",';
      fs.writeFileSync(file,broken);let error;try{kind==='config'?r.readConfigFile(name):r.readStorageFile(name)}catch(e){error=e}
      assert.equal(error.code,'GGR_JSON_INVALID');assert.equal(String(error).includes('NOT_A_REAL_SECRET'),false);assert.equal(error.cause,undefined);
      assert.equal(fs.readFileSync(file,'utf8'),broken);
    }`)
})

test('a captured session validates both halves before writing and empty captures cannot erase login', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl);const cookies=[{name:'session',value:'fixture',domain:'.zhipin.com'}];
    await r.writeBossSession({cookies,localStorage:{key:'old'}});
    for(const invalid of [{cookies:[],localStorage:{}},{cookies,localStorage:{bad:42}},{cookies,localStorage:undefined}])
      await assert.rejects(r.writeBossSession(invalid));
    assert.deepEqual(r.readStorageFile('boss-cookies.json'),cookies);assert.deepEqual(r.readStorageFile('boss-local-storage.json'),{key:'old'});
    await r.writeBossSession({cookies:[{name:'session',value:'new'}],localStorage:{key:'new'}});
    assert.equal(r.readStorageFile('boss-cookies.json')[0].value,'new');assert.deepEqual(r.readStorageFile('boss-local-storage.json'),{key:'new'});
    await r.writeStorageFile('boss-cookies.json',[]);assert.deepEqual(r.readStorageFile('boss-cookies.json'),[]);`)
})

test('all JSON is encoded before batch staging; bad values preserve the entire previous batch', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl);await r.writeStorageFiles([['a.json',{revision:1}],['b.json',{revision:1}]]);
    const cycle={};cycle.self=cycle;await assert.rejects(r.writeStorageFiles([['a.json',{revision:2}],['b.json',cycle]]));
    assert.deepEqual(r.readStorageFile('a.json'),{revision:1});assert.deepEqual(r.readStorageFile('b.json'),{revision:1});
    for(const [name,value] of [['boss.json',null],['llm.json',{}],['target-company-list.json','company']]) await assert.rejects(r.writeConfigFile(name,value));`)
})

test('legacy migration publishes exclusively, keeps old regex semantics and never rewrites its sources', async t => {
  await execute(folder(t), `fs.mkdirSync(path.join(root,'config'),{recursive:true});
    const boss='{"expectJobRegExpStr":"产品","expectCityList":["深圳"]}',companies='["示例公司"]';
    fs.writeFileSync(path.join(root,'config/boss.json'),boss);fs.writeFileSync(path.join(root,'config/target-company-list.json'),companies);
    const r=await import(runtimeUrl),common=r.readConfigFile('common-job-condition-config.json');
    assert.equal(common.expectJobNameRegExpStr,'产品');assert.equal(common.expectJobDescRegExpStr,'产品');assert.deepEqual(common.expectCompanies,['示例公司']);
    assert.equal(fs.readFileSync(path.join(root,'config/boss.json'),'utf8'),boss);assert.equal(fs.readFileSync(path.join(root,'config/target-company-list.json'),'utf8'),companies);`)
})

test('corrupt legacy migration sources are preserved and no default target is substituted', async t => {
  await execute(folder(t), `fs.mkdirSync(path.join(root,'config'),{recursive:true});const file=path.join(root,'config/boss.json');
    fs.writeFileSync(file,'{');const r=await import(runtimeUrl);assert.throws(()=>r.ensureConfigFileExist(),error=>error.code==='GGR_JSON_INVALID');
    assert.equal(fs.readFileSync(file,'utf8'),'{');assert.equal(fs.existsSync(path.join(root,'config/common-job-condition-config.json')),false);`)
})

test('concurrent default initialization cannot overwrite a successfully saved config', async t => {
  const dir = folder(t)
  const initialize = `const r=await import(runtimeUrl);r.ensureConfigFileExist();r.ensureStorageFileExist();`
  await Promise.all([
    execute(dir, initialize + `await r.writeConfigFile('boss.json',{savedByUser:true});`),
    ...Array.from({ length: 3 }, () => execute(dir, initialize))
  ])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config/boss.json'))), { savedByUser: true })
})

test('transient read errors do not delete existing credentials or expose exception payloads', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl);await r.writeStorageFile('boss-cookies.json',[{name:'n',value:'v'}]);
    const file=path.join(r.storageFilePath,'boss-cookies.json'),original=fs.readFileSync,before=original(file,'utf8');
    fs.readFileSync=function(p,...args){if(p===file)throw Object.assign(Error('NOT_A_REAL_SECRET'),{code:'EACCES'});return original(p,...args)};
    assert.throws(()=>r.readStorageFile('boss-cookies.json'),e=>e.code==='GGR_FILE_READ_FAILED'&&!String(e).includes('NOT_A_REAL_SECRET'));
    fs.readFileSync=original;assert.equal(fs.readFileSync(file,'utf8'),before);`)
})

test('runtime filenames cannot escape the storage/config directory', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl);
    for(const name of ['../outside.json','..\\\\outside.json','/tmp/outside.json','NUL','COM1.json','',String.fromCharCode(0)]){
      assert.throws(()=>r.readStorageFile(name),/文件名/);assert.throws(()=>r.readConfigFile(name),/文件名/);
      await assert.rejects(r.writeStorageFile(name,{}),/文件名/);await assert.rejects(r.writeConfigFile(name,{}),/文件名/);
    }`)
})

test('runtime write failures are explicit terminal storage errors and preserve an existing destination', async t => {
  await execute(folder(t), `const r=await import(runtimeUrl);const blocked=path.join(r.storageFilePath,'blocked.json');
    fs.mkdirSync(blocked,{recursive:true});fs.writeFileSync(path.join(blocked,'keep'),'old');
    await assert.rejects(r.writeStorageFile('blocked.json',{}),e=>e.code==='GGR_FILE_WRITE_FAILED'&&!e.atomicCommitted);
    assert.equal(fs.readFileSync(path.join(blocked,'keep'),'utf8'),'old');`)
})
