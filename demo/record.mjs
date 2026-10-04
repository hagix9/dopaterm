import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
const PORT='9223';
const OUT=process.env.DEMO_OUT||'./demo-recording';
fs.mkdirSync(OUT+'/frames',{recursive:true});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const getJson=(u)=>new Promise((res,rej)=>http.get(u,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(JSON.parse(b)))}).on('error',rej));
const t=(await getJson(`http://127.0.0.1:${PORT}/json`)).find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{maxPayload:256*1024*1024});
await new Promise(r=>ws.once('open',r));
let id=0;const p=new Map();const frames=[];
ws.on('message',m=>{m=JSON.parse(m);
  if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}
  else if(m.method==='Page.screencastFrame'){frames.push({data:m.params.data,ts:m.params.metadata.timestamp});
    ws.send(JSON.stringify({id:++id,method:'Page.screencastFrameAck',params:{sessionId:m.params.sessionId}}));}
});
const cdp=(method,params={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
const ev=async(e)=>(await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true})).result?.result?.value;
await cdp('Page.enable');await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});

// audio tap injection for next navigation
await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  const AC=window.AudioContext;
  window.__dopaAudio={ctx:null,tap:null};
  window.AudioContext=function(...a){const c=new AC(...a);
    if(!window.__dopaAudio.ctx){window.__dopaAudio.ctx=c;window.__dopaAudio.tap=c.createMediaStreamDestination();}
    return c;};
  window.AudioContext.prototype=AC.prototype;
  const oc=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(d,...r){const out=oc.call(this,d,...r);
    try{const a=window.__dopaAudio;if(a.tap&&this.context===a.ctx&&d===this.context.destination)oc.call(this,a.tap);}catch(e){}
    return out;};
})();`});
const url=t.url;
await cdp('Page.navigate',{url});
await sleep(3500);

// setup: local session + slot mode
await ev(`document.getElementById('launcher-local').click()`);await sleep(2500);
await ev(`document.getElementById('btn-slot-mode').click()`);await sleep(1300);
await ev(`document.querySelector('.cab-window-row textarea')?.focus()`);
console.log('cab-photo:',await ev(`document.getElementById('app').classList.contains('cab-photo')`));

// start screencast + audio recorder
await cdp('Page.startScreencast',{format:'jpeg',quality:82,maxWidth:1280,maxHeight:800,everyNthFrame:1});
await ev(`(()=>{const a=window.__dopaAudio;if(!a.tap)return 'NO TAP';
  window.__recChunks=[];const r=new MediaRecorder(a.tap.stream,{mimeType:'audio/webm;codecs=opus'});
  r.ondataavailable=e=>e.data.size&&__recChunks.push(e.data);r.start(250);window.__rec=r;return 'REC '+a.ctx.state})()`)
  .then(v=>console.log('audio:',v));

const type=async(s)=>{await ev(`document.querySelector('.cab-window-row textarea')?.focus()`);
  await cdp('Input.insertText',{text:s});
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});};

const T0=Date.now();
// Scene 1: successes (~7s)
await type('ls');await sleep(2200);
await type('echo DOPATERM');await sleep(2400);
await type('date');await sleep(2000);
// Scene 2: failure (~5s)
await type('cpx src dst');await sleep(4600);
// Scene 3: slot (~15s)
for(let attempt=0;attempt<2;attempt++){
  await ev(`document.getElementById('slot-lever').click()`);await sleep(1300);
  for(const i of[0,1,2]){await ev(`document.querySelectorAll('.stop-btn')[${i}].click()`);await sleep(800);}
  await sleep(2200);
  const trip=await ev(`document.querySelector('.slot-cabinet').className`);
  console.log('pull'+(attempt+1)+':',trip);
  if(/cab-triple|cab-jackpot/.test(trip)){await sleep(2600);break;}
  if(attempt===0){await sleep(400);}
}
// bonus celebration via demo rig (declared usage)
await ev(`(()=>{const s=document.getElementById('demo-combo-slider')||document.querySelector('[id*="combo"]');
  if(s){s.value='120';s.dispatchEvent(new Event('input',{bubbles:true}))}
  document.getElementById('btn-demo-success')?.click()})()`);
await sleep(3200);
// Scene 4: hold (~3s)
await sleep(2800);

await cdp('Page.stopScreencast');
const audioB64=await ev(`(async()=>{const r=window.__rec;if(!r)return null;
  await new Promise(res=>{r.onstop=res;r.stop()});
  const b=new Blob(window.__recChunks);const ab=await b.arrayBuffer();
  const u8=new Uint8Array(ab);let s='';for(let i=0;i<u8.length;i+=8192)s+=String.fromCharCode(...u8.subarray(i,i+8192));
  return btoa(s)})()`);
fs.writeFileSync(OUT+'/frames.json',
  JSON.stringify(frames.map(f=>({ts:f.ts}))));
const dir=OUT+'/frames/';
frames.forEach((f,i)=>fs.writeFileSync(dir+String(i).padStart(5,'0')+'.jpg',Buffer.from(f.data,'base64')));
if(audioB64)fs.writeFileSync(OUT+'/audio.webm',Buffer.from(audioB64,'base64'));
console.log('frames:',frames.length,'audio bytes:',audioB64?Buffer.from(audioB64,'base64').length:0,
  'span:',frames.length?((frames.at(-1).ts-frames[0].ts).toFixed(1)+'s'):0);
ws.close();
