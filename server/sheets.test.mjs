import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { loadSheet, writePorts } from './sheets.mjs'
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
test('Sheets locates header after notes, writes only matched Port and reads back',async()=>{
  const original=globalThis.fetch;let port='';let write
  globalThis.fetch=async(url,opts)=>{
    if(String(url).includes('oauth2'))return Response.json({access_token:'test-token'})
    if(String(url).includes('values:batchUpdate')){write=JSON.parse(opts.body);port=write.data[0].values[0][0];return Response.json({})}
    if(String(url).includes('/values/'))return Response.json({values:[['notes'],['序号','域名','siteKey','Port'],['11','example.com','site-a',port]]})
    return Response.json({sheets:[{properties:{title:'站点'}}]})
  }
  try{const source={id:'sheet-id',tab:'站点',account:{client_email:'test@example.com',private_key:privateKey}};const data=await loadSheet(source);assert.equal(data.sites[0].sourceRow,3);assert.equal(await writePorts(source,[{domain:'example.com',siteKey:'site-a',status:'deployed',port:3021}]),1);assert.equal(write.data[0].range,"'站点'!D3");assert.equal(write.valueInputOption,'RAW');await assert.rejects(writePorts(source,[{domain:'example.com',siteKey:'site-a',status:'deployed',port:4000}]),/已被修改/)}finally{globalThis.fetch=original}
})
