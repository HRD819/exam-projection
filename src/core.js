/* Shared deterministic rules for the browser and Node tests. */
var ExamCore = (function () {
  'use strict';
  const COURSES = ['資訊組織','參考資源','專利資訊','圖書資訊議題研討','資訊檢索與應用'];
  const PHASES = ['waiting','seating','reminder','exam','ended'];
  const LABELS = ['等待畫面','座位表','考前提醒','正式考試','考試結束'];
  const DEFAULTS = {seatingMinutes:20,reminderMinutes:2,endMinutes:5,refreshSeconds:60,maxPdfs:2,sound:false};
  function settings(input) {
    const s = Object.assign({}, DEFAULTS), warnings=[];
    for (const k of ['seatingMinutes','reminderMinutes','endMinutes','refreshSeconds','maxPdfs']) {
      if (input && input[k] !== undefined) {
        const n=Number(input[k]);
        if (Number.isFinite(n) && n>0 && (k!=='maxPdfs'||Number.isInteger(n)&&n<=2) && (k!=='refreshSeconds'||n>=15)) s[k]=n;
        else warnings.push('系統設定無效：'+k+'；採用預設值');
      }
    }
    if(s.reminderMinutes>=s.seatingMinutes){s.reminderMinutes=2;s.seatingMinutes=20;warnings.push('座位表須早於考前提醒；採用 20／2 分鐘');}
    s.sound=input?.sound===true||input?.sound==='TRUE';
    return {settings:s,warnings};
  }
  function dateKey(now) {return new Date(now+8*3600000).toISOString().slice(0,10);}
  function clock(now) {return new Date(now+8*3600000).toISOString().slice(11,19);}
  function timestamp(date,time) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return NaN;
    const n=Date.parse(date+'T'+time+':00+08:00');
    return Number.isFinite(n)&&dateKey(n)===date?n:NaN;
  }
  function ordered(items) {return items.map((r,i)=>({...r,_i:i})).sort((a,b)=>(Number(a.order)||Infinity)-(Number(b.order)||Infinity)||a._i-b._i);}
  function validate(data) {
    const config=settings(data.settings), s=config.settings, warnings=config.warnings.concat(data.serverWarnings||[]), rows=[];
    const ids=new Map();
    (data.exams||[]).forEach(e=>ids.set(e.id,(ids.get(e.id)||0)+1));
    for(const e of data.exams||[]){
      const w=[],start=timestamp(e.date,e.start),end=timestamp(e.date,e.end);
      if(!/^E\d{4,}$/.test(e.id||'')||ids.get(e.id)>1)w.push('考試ID缺漏、格式錯誤或重複');
      if(!COURSES.includes(e.course))w.push('科目缺漏或不在課程清單');
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)w.push('日期／時間無效，或結束時間不晚於開始時間');
      const valid=w.length===0;
      if(!/^\d{4}$/.test(String(e.semester||'')))w.push('學期需為四位數');
      if(!['期中考','期末考','隨堂測驗','隨堂練習'].includes(e.type))w.push('考試類型不在清單');
      if(!e.reminder)w.push('提醒版本未設定');
      else if(!(data.reminders||[]).some(r=>r.version===e.reminder&&r.text&&Number.isInteger(+r.order)&&+r.order>0))w.push('提醒版本不存在或沒有有效條目');
      if(!e.noticeVersion)w.push('考試注意事項版本未設定');
      else if(!(data.notices||[]).some(r=>r.version===e.noticeVersion&&r.text&&Number.isInteger(+r.order)&&+r.order>0))w.push('考試注意事項版本不存在或沒有有效條目');
      for(const [items,label] of [[(data.notices||[]).filter(r=>r.version&&r.version===e.noticeVersion),'注意事項'],[(data.reminders||[]).filter(r=>r.version===e.reminder),'考前提醒']]){
        const orders=items.map(r=>+r.order);
        if(new Set(orders).size<orders.length)w.push(label+'順序重複');
        if(orders.some(n=>!Number.isInteger(n)||n<=0))w.push(label+'順序需為正整數');
      }
      rows.push({...e,startMs:start,endMs:end,valid,warnings:w});
    }
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      const a=rows[i],b=rows[j];
      if(a.enabled!==true||b.enabled!==true||!a.valid||!b.valid)continue;
      if(a.startMs-s.seatingMinutes*60000<b.endMs+s.endMinutes*60000&&b.startMs-s.seatingMinutes*60000<a.endMs+s.endMinutes*60000){a.warnings.push('考試投影時段重疊');b.warnings.push('考試投影時段重疊');}
    }
    rows.forEach(e=>e.warnings.forEach(w=>warnings.push(e.id+'：'+w)));
    return {...data,settings:s,exams:rows,warnings:[...new Set(warnings)]};
  }
  function boundaries(e,s){return [e.startMs-s.seatingMinutes*60000,e.startMs-s.reminderMinutes*60000,e.startMs,e.endMs,e.endMs+s.endMinutes*60000];}
  function today(data,now){return data.exams.filter(e=>e.valid&&e.enabled===true&&e.date===dateKey(now));}
  function automatic(data,now){
    const active=today(data,now).filter(e=>{const b=boundaries(e,data.settings);return now>=b[0]&&now<b[4];});
    if(active.length!==1)return {phase:'waiting',exam:null,conflict:active.length>1};
    const e=active[0], b=boundaries(e,data.settings);
    return {phase:now<b[1]?'seating':now<b[2]?'reminder':now<b[3]?'exam':'ended',exam:e,conflict:false};
  }
  function context(data,now){
    const auto=automatic(data,now);if(auto.conflict||auto.exam)return auto.exam;
    const list=today(data,now).sort((a,b)=>a.startMs-b.startMs);
    const future=list.filter(e=>e.startMs>now);
    const e=future[0]||list[list.length-1];
    if(!e||list.filter(x=>x.startMs===e.startMs).length!==1)return null;
    return e;
  }
  function nextBoundary(data,now){const b=today(data,now).flatMap(e=>boundaries(e,data.settings)).filter(t=>t>now);return b.length?Math.min(...b):null;}
  function manual(data,now,phase){return {phase,examId:context(data,now)?.id||null,startedAt:now,until:nextBoundary(data,now)};}
  function view(data,now,override){
    if(override){const next=nextBoundary(data,override.startedAt);const expiry=Math.min(override.until??Infinity,next??Infinity);
      if(now<expiry){const e=data.exams.find(e=>e.id===override.examId&&e.valid&&e.enabled===true)||null;return {phase:override.phase,exam:e,manual:true,until:Number.isFinite(expiry)?expiry:null,conflict:false};}}
    return {...automatic(data,now),manual:false,until:nextBoundary(data,now)};
  }
  function countdown(start,now){if(start<=now)return '已到預定開考時間';const n=Math.ceil((start-now)/1000);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
  function noticeItems(data,exam){return exam?.noticeVersion?ordered((data.notices||[]).filter(r=>r.version===exam.noticeVersion)):[];}
  function pdfPrefix(e){return e.date.slice(2).replace(/-/g,'')+'_'+e.course+'_';}
  function matchPdfs(e,files){const p=pdfPrefix(e);return files.filter(f=>f.name.startsWith(p)&&f.name.toLowerCase().endsWith('.pdf')&&f.name.length>p.length+4).map(f=>({...f,room:f.name.slice(p.length,-4)})).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));}
  function pdfPlan(files,max=2){if(files.length>max)return {kind:'overflow',files:[],message:'座位表超過顯示上限（'+max+'份），請教師確認'};return {kind:files.length?'pdf':'paper',files,allPages:files.length===1,message:files.length?'':'請參閱現場紙本座位表'};}
  return {COURSES,PHASES,LABELS,DEFAULTS,settings,dateKey,clock,timestamp,ordered,validate,boundaries,today,automatic,context,nextBoundary,manual,view,countdown,noticeItems,pdfPrefix,matchPdfs,pdfPlan};
})();
if(typeof module!=='undefined')module.exports=ExamCore;
