import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import ssh2 from 'ssh2'
const { Server, utils } = ssh2
import { connect, remote } from './ssh.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const {privateKey} = generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
test('real SSH handshake, host pinning, password and key authentication, exit errors',async()=>{
  const key = utils.parseKey(privateKey)
  const server = new Server({hostKeys:[privateKey]},client=>{
    client.on('error',()=>{})
    client.on('authentication',ctx=>{
      if(ctx.method==='password'&&ctx.username==='tester'&&ctx.password==='test-only')return ctx.accept()
      if(ctx.method==='publickey'&&ctx.key.data.equals(key.getPublicSSH())&&(!ctx.signature||key.verify(ctx.blob,ctx.signature,ctx.hashAlgo)===true))return ctx.accept()
      ctx.reject()
    }).on('ready',()=>client.on('session',accept=>accept().on('exec',(accept,reject,info)=>{const stream=accept();if(info.command==='fail'){stream.stderr.write('controlled failure');stream.exit(7)}else{stream.write('connected');stream.exit(0)}stream.end()})))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const dir=await mkdtemp(path.join(os.tmpdir(),'deployx-test-'))
  try{
    const config={host:'127.0.0.1',port:server.address().port,username:'tester',auth:'password',password:'test-only'}
    const fingerprint=await connect(config,true);assert.match(fingerprint,/^[a-f0-9]{64}$/)
    await assert.rejects(connect({...config,fingerprint:'0'.repeat(64)}),/指纹/)
    const client=await connect({...config,fingerprint});assert.equal(await remote(client,'ok'),'connected');await assert.rejects(remote(client,'fail'),/退出码 7/);client.end()
    const keyPath=path.join(dir,'key.pem');await writeFile(keyPath,privateKey)
    const byKey=await connect({...config,auth:'key',keyPath,fingerprint});assert.equal(await remote(byKey,'ok'),'connected');byKey.end()
  }finally{await rm(dir,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve))}
})
