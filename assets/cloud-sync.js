/* BN Warrior V15 — Google Drive private encrypted sync */
(function(){
"use strict";

const FILE_NAME="bn-warrior-v15-private-sync.json";
const SCOPE="https://www.googleapis.com/auth/drive.appdata";
const bridge=()=>window.BNWarriorBridge;
let tokenClient=null;
let accessToken="";
let tokenExpiresAt=0;
let syncTimer=null;
let pollTimer=null;
let busy=false;
let status={type:"idle",message:"ยังไม่ได้เชื่อม Google Drive"};

const enc=new TextEncoder();
const dec=new TextDecoder();

function cloud(){
 return bridge()?.getCloud?.()||{};
}
function setStatus(type,message){
 status={type,message};
 renderPanel();
}
function tokenValid(){
 return !!accessToken && Date.now()<tokenExpiresAt-30000;
}
function requireBridge(){
 if(!bridge())throw new Error("BN Warrior ยังไม่พร้อม");
}
function clientIdValid(id){
 return /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test((id||"").trim());
}
function rememberKey(){return "bnw-cloud-passphrase-device"}
function getPassphrase(){return sessionStorage.getItem("bnw-cloud-passphrase")||localStorage.getItem(rememberKey())||""}
function setPassphrase(value,remember=false){
 if(value)sessionStorage.setItem("bnw-cloud-passphrase",value);else sessionStorage.removeItem("bnw-cloud-passphrase");
 if(remember&&value)localStorage.setItem(rememberKey(),value);else if(!remember)localStorage.removeItem(rememberKey());
}
function bytesToBase64(bytes){
 let binary="";const chunk=0x8000;
 for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
 return btoa(binary);
}
function base64ToBytes(value){
 const binary=atob(value),out=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
 return out;
}
async function deriveKey(passphrase,salt){
 const material=await crypto.subtle.importKey("raw",enc.encode(passphrase),"PBKDF2",false,["deriveKey"]);
 return crypto.subtle.deriveKey(
  {name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},
  material,
  {name:"AES-GCM",length:256},
  false,
  ["encrypt","decrypt"]
 );
}
async function encryptPayload(payload,passphrase){
 if(!passphrase)throw new Error("กรุณาตั้งรหัสเข้ารหัสก่อน Sync");
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await deriveKey(passphrase,salt);
 const plain=enc.encode(JSON.stringify(payload));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain));
 return {
  format:"bn-warrior-encrypted-sync",
  version:1,
  algorithm:"AES-GCM",
  kdf:{name:"PBKDF2",hash:"SHA-256",iterations:250000},
  salt:bytesToBase64(salt),
  iv:bytesToBase64(iv),
  ciphertext:bytesToBase64(cipher),
  updatedAt:payload?.meta?.updatedAt||new Date().toISOString()
 };
}
async function decryptEnvelope(envelope,passphrase){
 if(!passphrase)throw new Error("กรุณาใส่รหัสเข้ารหัส");
 if(envelope?.format!=="bn-warrior-encrypted-sync")throw new Error("รูปแบบ Cloud Backup ไม่ถูกต้อง");
 const salt=base64ToBytes(envelope.salt);
 const iv=base64ToBytes(envelope.iv);
 const cipher=base64ToBytes(envelope.ciphertext);
 const key=await deriveKey(passphrase,salt);
 try{
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher);
  return JSON.parse(dec.decode(plain));
 }catch(e){
  throw new Error("รหัสเข้ารหัสไม่ถูกต้อง หรือไฟล์เสียหาย");
 }
}
async function api(url,options={}){
 if(!tokenValid())throw new Error("Google session หมดอายุ กรุณากดเชื่อมใหม่");
 const headers=new Headers(options.headers||{});
 headers.set("Authorization","Bearer "+accessToken);
 const response=await fetch(url,Object.assign({},options,{headers}));
 if(response.status===401){
  accessToken="";tokenExpiresAt=0;
  throw new Error("Google session หมดอายุ กรุณากดเชื่อมใหม่");
 }
 if(!response.ok){
  const text=await response.text();
  throw new Error("Google Drive error "+response.status+": "+text.slice(0,180));
 }
 return response;
}
async function listRemote(){
 const q=encodeURIComponent("name='"+FILE_NAME.replace(/'/g,"\\'")+"' and trashed=false");
 const url="https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q="+q+"&fields=files(id,name,modifiedTime,appProperties)&orderBy=modifiedTime desc&pageSize=10";
 const data=await (await api(url)).json();
 return data.files?.[0]||null;
}
async function downloadRemote(fileId){
 const response=await api("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(fileId)+"?alt=media");
 return response.json();
}
function multipartBody(metadata,content){
 const boundary="bnwarrior_"+Math.random().toString(36).slice(2);
 const body=[
  "--"+boundary,
  "Content-Type: application/json; charset=UTF-8",
  "",
  JSON.stringify(metadata),
  "--"+boundary,
  "Content-Type: application/json",
  "",
  JSON.stringify(content),
  "--"+boundary+"--"
 ].join("\r\n");
 return {body,boundary};
}
async function uploadRemote(envelope,existingId=null){
 const payload=bridge().getSyncPayload();
 const metadata={
  name:FILE_NAME,
  mimeType:"application/json",
  appProperties:{
   updatedAt:payload?.meta?.updatedAt||new Date().toISOString(),
   schemaVersion:String(bridge().version||15),
   encrypted:"true"
  }
 };
 if(!existingId)metadata.parents=["appDataFolder"];
 const mp=multipartBody(metadata,envelope);
 const method=existingId?"PATCH":"POST";
 const url=existingId
  ?"https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(existingId)+"?uploadType=multipart&fields=id,name,modifiedTime,appProperties"
  :"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,appProperties";
 const response=await api(url,{method,headers:{"Content-Type":"multipart/related; boundary="+mp.boundary},body:mp.body});
 return response.json();
}
function compareIso(a,b){
 const ta=Date.parse(a||0)||0,tb=Date.parse(b||0)||0;
 return ta===tb?0:(ta>tb?1:-1);
}
async function push(){
 requireBridge();
 const passphrase=getPassphrase();
 const payload=bridge().getSyncPayload();
 const envelope=await encryptPayload(payload,passphrase);
 const remote=await listRemote();
 const uploaded=await uploadRemote(envelope,remote?.id||null);
 bridge().updateCloud({
  fileId:uploaded.id,
  lastSyncAt:new Date().toISOString(),
  lastCloudModifiedAt:uploaded.modifiedTime||new Date().toISOString()
 });
 return uploaded;
}
async function pull(remoteFile=null){
 requireBridge();
 const remote=remoteFile||await listRemote();
 if(!remote)throw new Error("ยังไม่มีข้อมูลบน Google Drive");
 const envelope=await downloadRemote(remote.id);
 const payload=await decryptEnvelope(envelope,getPassphrase());
 bridge().applySyncPayload(payload);
 bridge().updateCloud({
  fileId:remote.id,
  lastSyncAt:new Date().toISOString(),
  lastCloudModifiedAt:remote.modifiedTime||envelope.updatedAt||new Date().toISOString()
 });
 return payload;
}
async function smartSync({manual=false}={}){
 if(busy)return;
 busy=true;setStatus("syncing","กำลังตรวจสอบข้อมูล...");
 try{
  const remote=await listRemote();
  const local=bridge().getSyncPayload();
  const localAt=local?.meta?.updatedAt||"";
  const remoteAt=remote?.appProperties?.updatedAt||remote?.modifiedTime||"";
  if(!remote){
   await push();
   setStatus("connected","อัปโหลดข้อมูลครั้งแรกแล้ว");
  }else{
   const cmp=compareIso(localAt,remoteAt);
   if(cmp>0){
    await push();
    setStatus("connected","ส่งข้อมูลล่าสุดขึ้น Google Drive แล้ว");
   }else if(cmp<0){
    if(manual){
     const choice=await conflictDialog(localAt,remoteAt);
     if(choice==="remote")await pull(remote);
     else if(choice==="local")await push();
     else{setStatus("connected","ยกเลิกการ Sync");return;}
    }else{
     await pull(remote);
    }
    setStatus("connected","ข้อมูลตรงกันแล้ว");
   }else{
    bridge().updateCloud({lastSyncAt:new Date().toISOString(),fileId:remote.id,lastCloudModifiedAt:remote.modifiedTime});
    setStatus("connected","ข้อมูลตรงกันแล้ว");
   }
  }
 }catch(e){
  console.error(e);
  setStatus("error",e.message||"Sync ไม่สำเร็จ");
  if(manual)alert(e.message||"Sync ไม่สำเร็จ");
 }finally{
  busy=false;
 }
}
function conflictDialog(localAt,remoteAt){
 return new Promise(resolve=>{
  const root=document.createElement("div");
  root.className="modal show";
  root.innerHTML='<div class="modal-card cloud-conflict"><span class="eyebrow">SYNC CONFLICT</span><h2>ข้อมูลบน Google Drive ใหม่กว่า</h2><p class="muted">มือถือ/คอมเครื่องอื่นอาจมีข้อมูลล่าสุด</p><small>เครื่องนี้: '+(localAt||"-")+'</small><small>Google Drive: '+(remoteAt||"-")+'</small><button class="btn primary" data-choice="remote">ใช้ข้อมูลจาก Google Drive</button><button class="btn ghost" data-choice="local">ใช้ข้อมูลจากเครื่องนี้แทน</button><button class="btn danger" data-choice="cancel">ยกเลิก</button></div>';
  document.body.appendChild(root);
  root.querySelectorAll("[data-choice]").forEach(b=>b.onclick=()=>{const value=b.dataset.choice;root.remove();resolve(value)});
 });
}
function initTokenClient(){
 const id=cloud().clientId?.trim();
 if(!clientIdValid(id))throw new Error("กรุณาใส่ Google OAuth Client ID ให้ถูกต้อง");
 if(!window.google?.accounts?.oauth2)throw new Error("Google Identity Services ยังโหลดไม่เสร็จ กรุณาลองใหม่");
 tokenClient=google.accounts.oauth2.initTokenClient({
  client_id:id,
  scope:SCOPE,
  callback:response=>{
   if(response.error){
    setStatus("error",response.error_description||response.error);
    return;
   }
   accessToken=response.access_token;
   tokenExpiresAt=Date.now()+(+(response.expires_in||3600)*1000);
   setStatus("connected","เชื่อม Google Drive แล้ว");
   startPolling();
   smartSync({manual:true});
  },
  error_callback:error=>setStatus("error",error?.message||error?.type||"เปิดหน้าต่าง Google ไม่สำเร็จ")
 });
}
function connect(){
 try{
  initTokenClient();
  setStatus("syncing","กำลังเปิด Google...");
  tokenClient.requestAccessToken({prompt:accessToken?"":"consent"});
 }catch(e){
  setStatus("error",e.message);
  alert(e.message);
 }
}
function disconnect(){
 if(accessToken && window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(accessToken,()=>{});
 accessToken="";tokenExpiresAt=0;stopPolling();
 setStatus("idle","ตัดการเชื่อมต่อแล้ว ข้อมูลในเครื่องยังอยู่ครบ");
}
function startPolling(){
 stopPolling();
 pollTimer=setInterval(()=>{
  if(tokenValid() && cloud().autoSync && !document.hidden)smartSync({manual:false});
 },60000);
}
function stopPolling(){
 if(pollTimer)clearInterval(pollTimer);
 pollTimer=null;
}
function scheduleAutoPush(){
 if(!tokenValid()||!cloud().autoSync||busy)return;
 clearTimeout(syncTimer);
 syncTimer=setTimeout(()=>smartSync({manual:false}),2200);
}
function renderPanel(){
 const host=document.getElementById("cloudSyncPanel");
 if(!host)return;
 const c=cloud(),connected=tokenValid();
 const statusClass=busy?"syncing":status.type;
 host.innerHTML=`
 <div class="cloud-card">
  <div class="space"><div><span class="eyebrow">PRIVATE CLOUD SYNC</span><h2>Google Drive</h2></div><span class="phase-badge">AES-256 Encrypted</span></div>
  <div class="cloud-status ${connected?"connected":statusClass}"><i class="cloud-status-dot"></i><div><strong>${connected?"เชื่อมต่อแล้ว":status.message}</strong><small>${c.lastSyncAt?"Sync ล่าสุด: "+new Date(c.lastSyncAt).toLocaleString("th-TH"):"ยังไม่เคย Sync"}</small></div></div>
  <div class="cloud-grid" style="margin-top:10px">
   <label>Google OAuth Client ID<input id="cloudClientId" placeholder="123...apps.googleusercontent.com" value="${c.clientId||""}"></label>
   <label>รหัสเข้ารหัสส่วนตัว<input id="cloudPassphrase" type="password" placeholder="อย่างน้อย 8 ตัวอักษร" value="${getPassphrase()}"></label><label class="remember-pass"><input id="rememberPassphrase" type="checkbox" style="width:auto" ${localStorage.getItem(rememberKey())?"checked":""}> จำรหัสบนอุปกรณ์นี้</label>
  </div>
  <label><input id="cloudAutoSync" type="checkbox" style="width:auto" ${c.autoSync!==false?"checked":""}> Auto Sync ขณะเปิดแอปและเชื่อม Google อยู่</label>
  <p class="cloud-passphrase-note">รหัสเข้ารหัสเก็บเฉพาะใน session ของเบราว์เซอร์ ไม่ส่งขึ้น Google และต้องใช้รหัสเดียวกันทุกเครื่อง หากลืมรหัสจะเปิด Cloud Backup ไม่ได้</p>
  <div class="cloud-actions">
   <button id="cloudSaveConfig" class="btn ghost">บันทึกการตั้งค่า</button>
   <button id="cloudConnect" class="btn primary">${connected?"เชื่อมใหม่":"เชื่อม Google Drive"}</button>
   <button id="cloudSyncNow" class="btn ghost" ${connected?"":"disabled"}>Sync ตอนนี้</button>
   <button id="cloudUpload" class="btn ghost" ${connected?"":"disabled"}>อัปโหลดเครื่องนี้</button>
   <button id="cloudDownload" class="btn ghost" ${connected?"":"disabled"}>ดึงจาก Drive</button>
   <button id="cloudDisconnect" class="btn danger" ${connected?"":"disabled"}>ตัดการเชื่อมต่อ</button>
  </div>
  <div class="cloud-help"><strong>ความเป็นส่วนตัว:</strong> ไฟล์อยู่ใน Google Drive App Data ซึ่งซ่อนจากหน้า My Drive และแอปอื่นเข้าถึงไม่ได้ ข้อมูลถูกเข้ารหัสด้วยรหัสของคุณก่อนอัปโหลด<br><strong>ข้อจำกัด:</strong> เว็บแบบไม่มีเซิร์ฟเวอร์ไม่สามารถเก็บ Google refresh token ได้อย่างปลอดภัย จึงต้องกดเชื่อม Google ใหม่เมื่อ access token หมดอายุหรือเปิดแอปใหม่</div>
 </div>`;
 const q=id=>document.getElementById(id);
 q("cloudSaveConfig").onclick=()=>{
  const id=q("cloudClientId").value.trim(),pass=q("cloudPassphrase").value;
  if(id && !clientIdValid(id))return alert("รูปแบบ Client ID ไม่ถูกต้อง");
  if(pass && pass.length<8)return alert("รหัสเข้ารหัสควรมีอย่างน้อย 8 ตัวอักษร");
  setPassphrase(pass,q("rememberPassphrase").checked);
  bridge().updateCloud({clientId:id,autoSync:q("cloudAutoSync").checked,encrypted:true});
  setStatus("idle","บันทึกการตั้งค่าแล้ว");
 };
 q("cloudConnect").onclick=()=>{
  const id=q("cloudClientId").value.trim(),pass=q("cloudPassphrase").value;
  if(!clientIdValid(id))return alert("กรุณาใส่ Google OAuth Client ID");
  if(pass.length<8)return alert("กรุณาตั้งรหัสเข้ารหัสอย่างน้อย 8 ตัวอักษร");
  setPassphrase(pass,q("rememberPassphrase").checked);
  bridge().updateCloud({clientId:id,autoSync:q("cloudAutoSync").checked,encrypted:true});
  connect();
 };
 q("cloudSyncNow").onclick=()=>smartSync({manual:true});
 q("cloudUpload").onclick=async()=>{if(confirm("อัปโหลดข้อมูลจากเครื่องนี้ทับข้อมูลบน Google Drive หรือไม่?")){busy=true;setStatus("syncing","กำลังอัปโหลด...");try{await push();setStatus("connected","อัปโหลดแล้ว")}catch(e){setStatus("error",e.message);alert(e.message)}finally{busy=false}}};
 q("cloudDownload").onclick=async()=>{if(confirm("ดึงข้อมูลจาก Google Drive มาแทนข้อมูลในเครื่องนี้หรือไม่?")){busy=true;setStatus("syncing","กำลังดาวน์โหลด...");try{await pull();setStatus("connected","ดาวน์โหลดแล้ว")}catch(e){setStatus("error",e.message);alert(e.message)}finally{busy=false}}};
 q("cloudDisconnect").onclick=disconnect;
}
window.BNCloud={renderPanel,connect,disconnect,sync:()=>smartSync({manual:true})};
window.addEventListener("bn-warrior:settings-rendered",renderPanel);
window.addEventListener("bn-warrior:state-saved",event=>{
 if(event.detail?.source==="local")scheduleAutoPush();
});
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden && tokenValid() && cloud().autoSync)smartSync({manual:false});
});
window.addEventListener("load",()=>setTimeout(renderPanel,300));
})();