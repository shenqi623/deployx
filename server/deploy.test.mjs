import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { generateKeyPairSync } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import ssh2 from 'ssh2'
import { connect } from './ssh.mjs'
import { deploySite } from './deploy.mjs'
import { validateConfig } from './core.mjs'
const {Server}=ssh2
test('build → archive → real SFTP transfer → remote command → cleanup, with secret redaction',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
  const uploads=new Map();const commands=[]
  const server=new Server({hostKeys:[privateKey]},client=>{
    client.on('error',()=>{})
    client.on('authentication',ctx=>ctx.method==='password'?ctx.accept():ctx.reject()).on('ready',()=>client.on('session',accept=>{
      const session=accept()
      session.on('sftp',accept=>{
        const s=accept();let id=0;const handles=new Map()
        s.on('OPEN',(req,file)=>{const h=Buffer.alloc(4);h.writeUInt32BE(++id);handles.set(id,file);uploads.set(file,Buffer.alloc(0));s.handle(req,h)})
        s.on('WRITE',(req,h,offset,data)=>{const file=handles.get(h.readUInt32BE(0));const old=uploads.get(file);const next=Buffer.alloc(Math.max(old.length,offset+data.length));old.copy(next);data.copy(next,offset);uploads.set(file,next);s.status(req,0)})
        s.on('CLOSE',(req)=>s.status(req,0))
      })
      session.on('exec',(accept,reject,info)=>{commands.push(info.command);const s=accept();s.write('DEPLOYMENT_COMPLETE\n');s.exit(0);s.end()})
    }))
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const fixture=await mkdtemp(path.join(os.tmpdir(),'deployx-pipeline-'))
  try{
    await writeFile(path.join(fixture,'package.json'),JSON.stringify({type:'module',scripts:{build:'node build.mjs'}}))
    await writeFile(path.join(fixture,'build.mjs'),"import {mkdirSync,writeFileSync} from 'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html','<h1>fixture</h1>');console.log(process.env.API_TOKEN);")
    await writeFile(path.join(fixture,'.env'),'API_TOKEN=private-test-token\n')
    const c=validateConfig({projectPath:fixture,framework:'vue',mode:'static',output:'dist',entry:'',spa:true,buildTool:'npm',buildScript:'build',baseDir:'/var/www/deployx',https:false,validation:'minimal',sites:[{domain:'example.com'}],loadEnv:true,envText:''})
    const credentials={host:'127.0.0.1',port:server.address().port,username:'tester',auth:'password',password:'test-only'}
    credentials.fingerprint=await connect(credentials,true)
    const logs=[];const j={log:s=>logs.push(s)}
    const result=await deploySite(c,c.sites[0],credentials,j,path.join(fixture,'state'))
    assert.equal(result.status,'deployed');assert.equal(result.port,null)
    assert.ok([...uploads.keys()].some(p=>p.endsWith('.tar.gz')))
    const script=[...uploads.entries()].find(([p])=>p.endsWith('.sh'))[1].toString()
    const encoded=script.match(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d \| sudo/)[1]
    assert.match(Buffer.from(encoded,'base64').toString(),/server_name example.com/);assert.match(script,/chmod 755/)
    assert.ok(commands.some(c=>c.startsWith('bash ')))
    assert.ok(!logs.join('').includes('private-test-token'));assert.ok(logs.join('').includes('••••••'))
    assert.equal(await readFile(path.join(fixture,'.env'),'utf8'),'API_TOKEN=private-test-token\n')
  }finally{await new Promise(r=>server.close(r));await rm(fixture,{recursive:true,force:true})}
})
