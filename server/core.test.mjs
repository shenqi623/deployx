import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { parseCsv, sitesFromRows, parseEnv, envText, validateConfig, quote, redact, columnName, unwrapPath, parseAstroHints, parseNextHints, resolveProjectProfile, assertDeployShape, inspectProject } from './core.mjs'
import { remoteScript, parseSiteProbe } from './deploy.mjs'
const base = () => ({projectPath:path.resolve('.'),framework:'astro',mode:'node',output:'dist',entry:'dist/server/entry.mjs',buildTool:'auto',buildScript:'build',baseDir:'/var/www/deployx',https:true,email:'ops@example.com',validation:'minimal',startPort:3021,requireSiteKey:true,sites:[{domain:'example.com',siteKey:'site-a',selected:true}],envText:''})
test('CSV supports Chinese headers, leading notes, quoted commas and multiline fields',()=>{
  const input='维护说明\n序号,域名,siteKey,Port,备注\n11,example.com,site-a,,"a,b\nc"\n12,example.org,site-b,3022,'
  const data=sitesFromRows(parseCsv(input));assert.equal(data.sites[0].seq,'11');assert.equal(data.sites[0].sourceRow,3);assert.equal(data.sites[1].port,3022);assert.equal(data.portColumn,3)
})
test('CSV accepts semicolon delimiter and alternate domain headers',()=>{
  const data=sitesFromRows(parseCsv('编号;网站;site_key;端口\n1;https://a.example.com/path;key-a;3010'))
  assert.equal(data.sites[0].domain,'a.example.com');assert.equal(data.sites[0].siteKey,'key-a');assert.equal(data.sites[0].port,3010)
})
test('CSV missing domain header shows preview',()=>assert.throws(()=>sitesFromRows(parseCsv('name,value\na,1')),/找不到域名列/))
test('CSV malformed quotes fail explicitly',()=>assert.throws(()=>parseCsv('domain\n"oops'),/引号/))
test('env values preserve hash and quotes without shell interpolation',()=>{const env=parseEnv('A="a#b"\nB=ok # note\nexport TOKEN=x\n');assert.deepEqual(env,{A:'a#b',B:'ok',TOKEN:'x'});assert.deepEqual(parseEnv(envText(env)),env);assert.throws(()=>parseEnv('bad row'))})
test('auto ports skip existing listeners and explicit reservations',()=>{const c=base();c.sites.push({domain:'example.org',siteKey:'b',port:3023});const parsed=validateConfig(c,[3021,3022]);assert.equal(parsed.sites[0].port,3024);assert.equal(parsed.sites[1].port,3023)})
test('selected range excludes unselected sites',()=>{const c=base();c.sites.push({domain:'invalid',selected:false});assert.equal(validateConfig(c).sites.length,1)})
test('rejects shell injection, traversal, duplicate domains and missing site keys',()=>{
  for(const patch of [{baseDir:'/var/www/a;echo'},{output:'../secrets'},{output:'/tmp'},{buildScript:'build;echo'},{sites:[{domain:'a.com;id',siteKey:'a'}]},{sites:[{domain:'a.com',siteKey:''}]},{sites:[{domain:'a.com',siteKey:'a'},{domain:'a.com',siteKey:'b'}]}])assert.throws(()=>validateConfig({...base(),...patch}))
})
test('static sites have no PM2 port or secret-serving web root',()=>{const c=validateConfig({...base(),framework:'vue',mode:'static',entry:'',requireSiteKey:false,spa:true});assert.equal(c.sites[0].port,null);const script=remoteScript(c,c.sites[0],'test-release','/tmp/artifact.tar.gz',{});assert.ok(!script.includes('pm2 start "$target'));assert.ok(script.includes('nginx -t'));assert.ok(script.includes('rollback()'));assert.ok(!script.includes('renew --dry-run'))})
test('site probe output identifies previous deployments',()=>{const m=parseSiteProbe("DX_SITE a.com managed node 3021 1759000000\nDX_SITE b.com foreign\nDX_SITE c.com nginx-elsewhere root|/var/www/old/c-com/current/dist\nDX_SITE d.com new\n");assert.deepEqual(m.get('a.com'),{status:'managed',mode:'node',port:3021,deployedAt:new Date(1759000000000).toISOString()});assert.equal(m.get('b.com').status,'foreign');assert.equal(m.get('c.com').target,'root /var/www/old/c-com/current/dist');assert.equal(m.get('d.com').status,'new')})
test('mode switch is refused unless the user confirmed it for that domain',()=>{const c=validateConfig({...base(),framework:'vue',mode:'static',entry:'',requireSiteKey:false,spa:true});const refused=remoteScript(c,c.sites[0],'r1','/tmp/a.tar.gz',{});assert.ok(refused.includes('exit 22'));assert.ok(!refused.includes('switching=1'));const allowed=remoteScript({...c,allowModeSwitch:[c.sites[0].domain]},c.sites[0],'r1','/tmp/a.tar.gz',{});assert.ok(allowed.includes('switching=1'));assert.ok(allowed.includes('.deployx-bak'));assert.ok(allowed.includes(`pm2 delete 'lp-${c.sites[0].slug}'`))})
test('Node scripts guard ownership, port reuse, rollback, and env permissions',()=>{const c=validateConfig(base());const script=remoteScript(c,c.sites[0],'test-release','/tmp/artifact.tar.gz',{});for(const expected of ['.deployx-owned','.deployx-domain','.deployx-port','chmod 600','ecosystem.json','pm2 start','--keep-until-expiring','previous-release'])assert.ok(script.includes(expected),expected);assert.ok(!script.includes('curl'));assert.ok(!script.includes('rm -rf'))})
test('shell quoting and log masking',()=>{assert.equal(quote("a'b"),"'a'\\''b'");assert.ok(!redact('token=abc SECRET-VALUE',['SECRET-VALUE']).includes('SECRET-VALUE'));assert.equal(columnName(5),'F');assert.equal(columnName(26),'AA')})
test('unwrapPath strips Windows copy-as-path quotes',()=>{
  assert.equal(unwrapPath('"C:\\\\Users\\\\a\\\\.ssh\\\\id_ed25519"'),'C:\\\\Users\\\\a\\\\.ssh\\\\id_ed25519')
  assert.equal(unwrapPath("'D:\\\\Project\\\\app'"),'D:\\\\Project\\\\app')
  assert.equal(unwrapPath('  "C:\\\\tmp"  '),'C:\\\\tmp')
})
test('framework profile resolves Astro/Nuxt/Next deploy shapes',()=>{
  assert.equal(parseAstroHints("output: 'server'").output,'server')
  assert.equal(parseNextHints("output: 'export'").staticExport,true)
  const astroNode=resolveProjectProfile('astro',{'@astrojs/node':'1'},{build:'astro build'},{astro:{output:'server',hasNodeAdapter:true}})
  assert.equal(astroNode.mode,'node');assert.equal(astroNode.entry,'dist/server/entry.mjs')
  const astroStatic=resolveProjectProfile('astro',{},{build:'astro build'},{astro:{output:'static'}})
  assert.equal(astroStatic.mode,'static');assert.equal(astroStatic.entry,'')
  const nuxt=resolveProjectProfile('nuxt',{nuxt:'3'},{generate:'nuxt generate'},{nuxt:{preferStatic:true}})
  assert.equal(nuxt.output,'.output/public');assert.equal(nuxt.buildScript,'generate')
  const next=resolveProjectProfile('next',{next:'14'},{build:'next build'},{next:{staticExport:true}})
  assert.equal(next.output,'out');assert.equal(next.nextSsr,false);assert.equal(next.mode,'static')
  const nextSsr=resolveProjectProfile('next',{next:'14'},{build:'next build'},{next:{staticExport:false}})
  assert.equal(nextSsr.mode,'node');assert.equal(nextSsr.runner,'next-start');assert.equal(nextSsr.runtimeInstall,true)
  const nuxtSsr=resolveProjectProfile('nuxt',{nuxt:'3'},{build:'nuxt build'},{nuxt:{preferStatic:false}})
  assert.equal(nuxtSsr.mode,'node');assert.equal(nuxtSsr.entry,'.output/server/index.mjs')
  assert.throws(()=>assertDeployShape({framework:'next',mode:'node',output:'dist',entry:'x',runner:'next-start'}),/\.next/)
  const nextOk=assertDeployShape({framework:'next',mode:'node',output:'.next',entry:'node_modules/next/dist/bin/next'})
  void nextOk
  const shaped={framework:'next',mode:'node',output:'.next',entry:'node_modules/next/dist/bin/next'}
  assertDeployShape(shaped);assert.equal(shaped.runner,'next-start');assert.equal(shaped.runtimeInstall,true)
})
test('buildEcosystem uses next start for Next SSR',async()=>{
  const { buildEcosystem } = await import('./deploy.mjs')
  const next=buildEcosystem({framework:'next',mode:'node',runner:'next-start'},{port:3021},'/var/www/a/releases/1','lp-a')
  assert.equal(next.apps[0].script,'node_modules/next/dist/bin/next')
  assert.match(next.apps[0].args,/start -H 127\.0\.0\.1 -p 3021/)
  const nuxt=buildEcosystem({framework:'nuxt',mode:'node',entry:'.output/server/index.mjs',runner:'node-file'},{port:3022},'/var/www/a/releases/1','lp-b')
  assert.equal(nuxt.apps[0].script,'/var/www/a/releases/1/.output/server/index.mjs')
  assert.equal(nuxt.apps[0].env.NITRO_PORT,'3022')
})
test('inspectProject reads configs from disk',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lp-inspect-'))
  try{
    await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'demo-astro',scripts:{build:'astro build'},dependencies:{astro:'4.0.0','@astrojs/node':'8.0.0'}}))
    await writeFile(path.join(dir,'astro.config.mjs'),"export default { output: 'server', adapter: {} }\n")
    const info=await inspectProject(dir)
    assert.equal(info.framework,'astro');assert.equal(info.mode,'node');assert.equal(info.adapter,true)
    await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'demo-next',scripts:{build:'next build'},dependencies:{next:'14.0.0',react:'18.0.0'}}))
    await writeFile(path.join(dir,'next.config.mjs')," const nextConfig = { output: 'export' }; export default nextConfig\n")
    const next=await inspectProject(dir)
    assert.equal(next.framework,'next');assert.equal(next.mode,'static');assert.equal(next.output,'out');assert.equal(next.nextSsr,false)
  }finally{await rm(dir,{recursive:true,force:true})}
})
