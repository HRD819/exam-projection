(function(){
  'use strict';
  const C=ExamCore, $=id=>document.getElementById(id), S=CsvSource;
  const configKey='exam-projection-csv-sources-v1';let sources={...globalThis.CSV_CONFIG};
  try {const query=new URLSearchParams(location.search).get('sources');if(query){const raw=decodeURIComponent(atob(query.replace(/-/g,'+').replace(/_/g,'/')));const x=JSON.parse(raw);if(S.names.every(k=>S.sourceUrl(x[k])))sources=x;}else{const x=JSON.parse(localStorage.getItem(configKey)||'null');if(x&&S.names.every(k=>S.sourceUrl(x[k])))sources=x;}}catch{}
  const cacheKey=()=> 'exam-projection-csv-cache-v1:'+JSON.stringify(sources);
  let data=C.validate({exams:[],notices:[],reminders:[]}),liveData=data,override=null,sim=null,offset=0,lastSync=0,lastCalibration=0;
  let seatIndex=null,seatIndexError='座位表清單尚未讀取';
  try{seatIndex=SeatIndex.validate(JSON.parse(localStorage.getItem('seat-index-v1')||'null'));seatIndexError='使用座位表清單快取';}catch{}
  let pdfKey='',pdfPromise=null,pdfToken=0,pdfModule=null,pdfWorkerUrl=null,pdfMemory=new Map(),renderedKey='',currentView=null,syncing=false;
  let calibrationText='時間未校正：使用裝置時間',pdfText='座位表尚未讀取',syncText='正在讀取資料…',lastBeep='',refreshTimer=null,pdfRetryAt=0;
  const now=()=>sim?sim.time+(sim.running?Date.now()-sim.anchor:0):Date.now()+offset;
  function demo(){return C.validate({settings:C.DEFAULTS,exams:[{id:'E0001',semester:'1151',type:'期中考',course:'資訊組織',date:'2026-11-06',start:'10:10',end:'12:00',reminder:'DEMO',noticeVersion:'NOTICE_DEMO',enabled:true}],notices:[{version:'NOTICE_DEMO',order:1,text:'請保持安靜，獨立作答（模擬示例）'},{version:'NOTICE_DEMO',order:2,text:'如有問題請舉手（模擬示例）'}],reminders:[{version:'DEMO',order:1,text:'請將課本、講義及筆記收妥（模擬示例）'},{version:'DEMO',order:2,text:'請將手機關機（模擬示例）'}],seats:{}});}
  function list(el,items){el.replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
  function warningItems(){const result=(data.warnings||[]).slice();if(currentView?.conflict)result.unshift('同時有多場考試符合：保持等待畫面，請修正排程。');if(pdfText.includes('失敗')||pdfText.includes('上限')||pdfText.includes('快取'))result.push(pdfText);if(seatIndexError)result.push(seatIndexError);return result;}
  function tick(){
    const t=now(),v=C.view(data,t,override);if(!v.manual)override=null;
    currentView=v;
    const key=[v.phase,v.exam?.id,v.exam?.course,v.exam?.type,v.exam?.noticeVersion,v.exam?.reminder,JSON.stringify(data.notices),JSON.stringify(data.reminders),!!sim].join('|');
    if(renderedKey!==key){renderedKey=key;render(v);}
    $('clock').textContent=C.clock(t);
    if(v.phase==='reminder'&&v.exam){$('countdown').textContent=C.countdown(v.exam.startMs,t);beep(v.exam,t);}
    $('modeStatus').textContent=v.manual?'手動模式':'自動模式';
    $('nextStatus').textContent=v.until?(v.manual?'將於 ':'下次切換 ')+C.clock(v.until)+(v.manual?' 恢復自動':''):(v.manual?'今日無後續切換點；維持手動直到恢復自動或重新整理':'今日無後續切換點');
    $('nextPhase').disabled=v.phase==='ended';
    document.querySelectorAll('[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.phase===v.phase)));
    $('sourceStatus').textContent=sim?'模擬資料（不會寫入試算表）':syncText+(lastSync?' · 最後成功 '+C.clock(lastSync):'');
    $('timeStatus').textContent=sim?'模擬時間（可暫停於邊界）':calibrationText+(lastCalibration&&Date.now()-lastCalibration>180000?'；校正已逾 3 分鐘':'');
    $('pdfStatus').textContent=pdfText;
    const warnings=warningItems();$('warningCount').textContent='（'+warnings.length+'）';list($('warnings'),warnings);
    preload(v.exam||C.context(data,t));
  }
  function render(v){
    $('projection').className=v.phase;
    $('examHeader').hidden=v.phase==='waiting';$('clockLabel').hidden=v.phase==='waiting';
    $('course').textContent=v.exam?.course||'尚無考試資料';$('examType').textContent=v.exam?.type||'';
    $('phaseLabel').textContent=C.LABELS[C.PHASES.indexOf(v.phase)];
    ['seating','reminder','ended'].forEach(p=>$(p+'Section').hidden=v.phase!==p);
    $('noticeSection').hidden=v.phase!=='exam';
    $('noContext').hidden=v.phase==='waiting'||!!v.exam;
    $('countdown').textContent='';
    list($('notices'),C.noticeItems(data,v.exam).map(r=>r.text));
    list($('reminders'),C.ordered((data.reminders||[]).filter(r=>r.version&&r.version===v.exam?.reminder)).map(r=>r.text));
    if(v.phase==='seating'&&!v.exam){$('pdfGrid').replaceChildren();$('paperMessage').hidden=false;}
  }
  function descriptor(e){
    if(sim){const scenario=$('pdfScenario').value;const make=(id,room,pages)=>({id,room,name:id+'.pdf',rev:scenario,size:10000,demoPages:pages});
      return scenario==='error'?{status:'error',message:'座位表連線失敗（模擬）'}:{status:'ok',files:scenario==='single'?[make('demo-one','LE205',1)]:scenario==='multi'?[make('demo-multi','LE205',3)]:scenario==='two'?[make('demo-multi','LE205',3),make('demo-second','LE206',2)]:scenario==='overflow'?[make('a','A',1),make('b','B',1),make('c','C',1)]:[]};}
    if(seatIndex){const files=SeatIndex.match(e,seatIndex);if(new Set(files.map(f=>f.room.toUpperCase())).size!==files.length)return {status:'error',message:'同一教室有多張座位表，請檢查檔名'};return {status:'ok',files};}
    const manual=data.seats?.[e.id];return manual?.files?.length?manual:{status:'error',message:'座位表清單讀取失敗，請使用紙本'};
  }
  async function library(){
    if(!pdfModule){const base='./vendor/pdfjs/';pdfModule=import(base+'build/pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=base+'build/pdf.worker.mjs';return lib;}).catch(e=>{pdfModule=null;throw e;});}return pdfModule;
  }
  async function bytes(e,f){const key=(sim?'demo:':'live:')+e.id+':'+f.id+':'+f.rev;if(pdfMemory.has(key))return pdfMemory.get(key).slice();
    let bytes;if(sim){bytes=makeDemoPdf(f.demoPages,f.room);}else {const response=await fetch(f.url,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('檔案 HTTP '+response.status);const max=12*1024*1024;if(Number(response.headers.get('content-length'))>max)throw Error('PDF 超過 12 MB');const reader=response.body.getReader(),parts=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){await reader.cancel();throw Error('PDF 超過 12 MB');}parts.push(part.value);}bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('連結沒有回傳 PDF 檔案');}
    if(pdfMemory.size>5)pdfMemory.clear();pdfMemory.set(key,bytes);return bytes.slice();
  }
  async function preload(e){
    if(!e)return;
    const desc=descriptor(e), key=(sim?'demo:':'live:')+e.id+JSON.stringify(desc);
    if(key===pdfKey&&(!pdfRetryAt||Date.now()<pdfRetryAt))return;
    pdfRetryAt=0;
    pdfKey=key;const token=++pdfToken;
    if(desc.status!=='ok'){
      pdfText=desc.message||'座位表讀取失敗';
      // Keep already rendered pages only for the same exam when a refresh fails.
      if(!sim&&$('pdfGrid').dataset.scope==='live'&&$('pdfGrid').dataset.exam===e.id&&$('pdfGrid').children.length){pdfText+='；顯示本次開啟頁面的座位表快取';return;}
      $('pdfGrid').replaceChildren();$('paperMessage').hidden=false;return;
    }
    const plan=C.pdfPlan(desc.files||[],data.settings.maxPdfs);
    $('pdfGrid').replaceChildren();$('pdfGrid').dataset.exam=e.id;$('pdfGrid').dataset.scope=sim?'demo':'live';$('paperMessage').hidden=false;
    if(plan.kind!=='pdf'){pdfText=plan.kind==='paper'?'使用紙本座位表（已成功查詢，0 份 PDF）':plan.message;return;}
    pdfText='正在預載座位表…';
    pdfPromise=(async()=>{
      const cards=[];let count=0,hasDriveImage=false;
      for(const f of plan.files){
        const imageUrl=!sim&&S.driveImage(f.url);
        if(imageUrl){
          const card=document.createElement('article');card.className='pdf-file';
          const title=document.createElement('h2');title.textContent=f.room;card.append(title);
          const area=document.createElement('div');area.className='pdf-pages';
          const image=document.createElement('img');image.alt=f.room+' 座位表';
          await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Google Drive 圖片載入逾時')),25000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(Error('Google Drive 圖片載入失敗，請檢查分享權限'));};image.src=imageUrl;});
          area.append(image);card.append(area);cards.push(card);count++;hasDriveImage=true;continue;
        }
        if(f.size>12*1024*1024)throw new Error('PDF 超過 12 MB 性能上限');
        const lib=await library();const doc=await lib.getDocument({data:await bytes(e,f),isEvalSupported:false,useSystemFonts:true,stopAtErrors:true,cMapUrl:'./vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'./vendor/pdfjs/standard_fonts/',wasmUrl:'./vendor/pdfjs/wasm/'}).promise;
        try {
          if(plan.allPages&&doc.numPages>12)throw new Error('單份 PDF 超過 12 頁；請先精簡或使用紙本（不省略頁面）');
          const pages=plan.allPages?doc.numPages:1,card=document.createElement('article');card.className='pdf-file';
          const title=document.createElement('h2');title.textContent=f.room;card.append(title);
          const area=document.createElement('div');area.className='pdf-pages';const columns=pages<=3?pages:Math.ceil(Math.sqrt(pages));area.style.setProperty('--pages',columns);area.style.gridTemplateRows='repeat('+Math.ceil(pages/columns)+', minmax(0, 1fr))';card.append(area);
          for(let n=1;n<=pages;n++){const page=await doc.getPage(n),v=page.getViewport({scale:1}),scale=Math.min(2,1600/v.width,1800/v.height,Math.sqrt(2200000/pages/(v.width*v.height))),viewport=page.getViewport({scale});
            const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label',f.room+' 座位表第 '+n+' 頁');canvas.setAttribute('role','img');
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;area.append(canvas);count++;
          }
          if(doc.numPages>1){const note=document.createElement('small');note.textContent=plan.allPages?'共 '+doc.numPages+' 頁，同時顯示；請確認後排可讀性':'此份共 '+doc.numPages+' 頁，依規格僅顯示第 1 頁';card.append(note);}cards.push(card);
        }finally{await doc.destroy();}
      }
      if(token!==pdfToken)return;
      $('pdfGrid').style.setProperty('--files',plan.files.length);$('pdfGrid').replaceChildren(...cards);$('paperMessage').hidden=true;
      pdfText='已載入 '+plan.files.length+' 份座位表／顯示 '+count+' 頁'+(hasDriveImage?'（Google Drive 圖片；請確認清晰度）':'（僅本次頁面記憶體快取）');
    })().catch(error=>{if(token!==pdfToken)return;pdfText='PDF 載入失敗：'+error.message;pdfRetryAt=Date.now()+60000;$('pdfGrid').replaceChildren();$('paperMessage').hidden=false;});
    await pdfPromise;
  }
  async function sync(){
    if(syncing)return;clearTimeout(refreshTimer);syncing=true;const sent=Date.now();$('refresh').disabled=true;
    try{const response=await fetch('./seat-index.json',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('HTTP '+response.status);const next=SeatIndex.validate(await response.json());seatIndex=next;seatIndexError=Date.now()-Date.parse(next.generatedAt)>3600000?'座位表清單超過 1 小時未更新；請確認發布狀態':'';try{localStorage.setItem('seat-index-v1',JSON.stringify(next));}catch{} }catch(error){seatIndexError=seatIndex?'座位表清單同步失敗，使用快取（請確認清單更新時間）':'座位表清單讀取失敗；可用手動連結或紙本';}
    try{const r=await S.load(sources);
      if(!Array.isArray(r.exams)||!Array.isArray(r.notices)||!Array.isArray(r.reminders))throw new Error('資料格式無效');
      liveData=C.validate(r);lastSync=Date.now();if(!sim)data=liveData;
      calibrationText='時間未校正：使用本機時鐘，請確認 Windows 已自動校時';
      syncText='Google Sheets CSV 讀取成功（發布內容可能有延遲）';
      try{localStorage.setItem(cacheKey(),JSON.stringify({data:r,at:lastSync}));}catch{}
    }catch(error){syncText=(lastSync?'CSV 同步失敗，使用上次快取':'尚無可用排程：'+error.message);calibrationText='時間未校正：使用本機時鐘';}
    finally{syncing=false;$('refresh').disabled=false;tick();refreshTimer=setTimeout(sync,liveData.settings.refreshSeconds*1000);}
  }
  function openPanel(open){$('controls').hidden=!open;$('openControls').hidden=open;$('openControls').setAttribute('aria-expanded',String(open));if(open)$('closeControls').focus();else $('openControls').focus();}
  function setPhase(phase){override=C.manual(data,now(),phase);tick();}
  C.PHASES.forEach((phase,i)=>{const b=document.createElement('button');b.textContent=C.LABELS[i];b.dataset.phase=phase;b.onclick=()=>setPhase(phase);$('phaseButtons').append(b);});
  $('openControls').onclick=()=>openPanel(true);$('closeControls').onclick=()=>openPanel(false);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('controls').hidden)openPanel(false);});
  $('nextPhase').onclick=()=>setPhase(C.PHASES[Math.min(4,C.PHASES.indexOf(currentView.phase)+1)]);$('auto').onclick=()=>{override=null;tick();};$('refresh').onclick=()=>{pdfKey='';sync();};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='請按 F11 全螢幕';}};
  function simulate(value){const ms=Date.parse(value+'+08:00');if(!Number.isFinite(ms))return;sim={time:ms,anchor:Date.now(),running:false};data=demo();override=null;pdfKey='';$('simulationBadge').hidden=false;document.body.classList.add('simulating');tick();}
  $('startSimulation').onclick=()=>simulate($('simTime').value.length===16?$('simTime').value+':00':$('simTime').value);
  $('stopSimulation').onclick=()=>{sim=null;data=liveData;override=null;pdfKey='';$('simulationBadge').hidden=true;document.body.classList.remove('simulating');tick();};
  $('pdfScenario').onchange=()=>{if(sim){pdfKey='';tick();}};
  ['09:49:59','09:50:00','10:08:00','10:09:59','10:10:00','12:00:00','12:05:00'].forEach(time=>{const b=document.createElement('button');b.textContent=time;b.onclick=()=>{$('simTime').value='2026-11-06T'+time;simulate('2026-11-06T'+time);};$('boundaryButtons').append(b);});
  function beep(e,t){if(!data.settings.sound||sim)return;const seconds=Math.ceil((e.startMs-t)/1000),key=e.id+':'+seconds;if(seconds<1||seconds>5||key===lastBeep)return;lastBeep=key;try{const audio=new AudioContext(),o=audio.createOscillator(),g=audio.createGain();g.gain.value=.06;o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.15);o.onended=()=>audio.close();}catch{}}
  function makeDemoPdf(pages,room){
    // ASCII-only synthetic fixture: no real student data. Construct a valid multipage PDF.
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const kids=[];
    for(let n=1;n<=pages;n++){const pageId=objects.length+1,contentId=pageId+1;kids.push(pageId+' 0 R');objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+contentId+' 0 R >>');let body='BT /F1 28 Tf 45 780 Td (DEMO - '+room+') Tj 0 -40 Td /F1 15 Tf (Page '+n+' / '+pages+' - No real student data) Tj ET\n';for(let row=0;row<6;row++)for(let col=0;col<4;col++){const x=45+col*130,y=640-row*85;body+=x+' '+y+' 110 65 re S BT /F1 14 Tf '+(x+17)+' '+(y+28)+' Td (Seat '+(row*4+col+1)+') Tj ET\n';}objects.push('<< /Length '+body.length+' >>\nstream\n'+body+'endstream');}
    objects[1]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages+' >>';let result='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(result.length);result+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const xref=result.length;result+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return new TextEncoder().encode(result);
  }
  function restoreCache(){try{const saved=JSON.parse(localStorage.getItem(cacheKey())||'null');if(saved?.data&&Array.isArray(saved.data.exams)){liveData=data=C.validate(saved.data);lastSync=saved.at;syncText='已載入上次快取，等待同步';return;}}catch{}lastSync=0;liveData=data=C.validate({exams:[],notices:[],reminders:[]});}
  const fields={exams:$('csvExams'),notices:$('csvNotices'),reminders:$('csvReminders'),settings:$('csvSettings')};Object.entries(fields).forEach(([k,input])=>input.value=sources[k]||'');
  $('deriveCsv').onclick=()=>{try{const next=S.derive($('csvShared').value.trim());Object.entries(fields).forEach(([k,input])=>input.value=next[k]);$('csvStatus').textContent='已帶入四張工作表，請按「儲存並同步」。';}catch(error){$('csvStatus').textContent=error.message;}};
  $('saveCsv').onclick=()=>{if(syncing){$('csvStatus').textContent='資料同步中，請稍後再儲存。';return;}const next=Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value.trim()]));if(!S.names.every(k=>S.sourceUrl(next[k]))){$('csvStatus').textContent='請填入四個已發布的 Google Sheets CSV 網址。';return;}sources=next;try{localStorage.setItem(configKey,JSON.stringify(sources));}catch{}$('csvStatus').textContent='已儲存在此瀏覽器，正在同步；其他電腦請使用含設定的投影網址。';restoreCache();override=null;pdfKey='';renderedKey='';sync();};
  $('copyCsvLink').onclick=async()=>{if(!S.names.every(k=>S.sourceUrl(sources[k]))){$('csvStatus').textContent='請先儲存四個公開 CSV 網址。';return;}const u=new URL(location.href);u.search='';u.searchParams.set('sources',btoa(encodeURIComponent(JSON.stringify(sources))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));try{await navigator.clipboard.writeText(u.href);$('csvStatus').textContent='已複製投影網址；持有網址的人能取得發布的 CSV。';}catch{$('csvStatus').textContent='請手動複製以下網址： '+u.href;}};
  restoreCache();
  if(new URLSearchParams(location.search).get('demo')==='1')simulate('2026-11-06T10:10:00');
  if(!sim&&!S.names.every(k=>S.sourceUrl(sources[k]))){openPanel(true);$('sourceControls').open=true;}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();if(Date.now()-lastSync>30000)sync();}});window.addEventListener('online',()=>sync());
  tick();setInterval(tick,1000);sync();
})();
