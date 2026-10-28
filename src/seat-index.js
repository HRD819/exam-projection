/* Match date, exact course and ASCII classroom from a published index. */
var SeatIndex=(function(){
  'use strict';
  function validate(data){if(!data||!Array.isArray(data.files)||typeof data.generatedAt!=='string'||!Number.isFinite(Date.parse(data.generatedAt)))throw Error('座位表清單格式錯誤');return data;}
  function match(exam,data){validate(data);const prefix=String(exam.date||'').slice(2).replace(/-/g,'')+String(exam.course||'');if(!/^\d{6}/.test(prefix)||!exam.course)return [];return data.files.filter(f=>typeof f.name==='string'&&typeof f.id==='string'&&/^[\w-]+$/.test(f.id)&&f.name.startsWith(prefix)&&/^[A-Za-z][A-Za-z0-9-]*\.jpe?g$/i.test(f.name.slice(prefix.length))).map(f=>{const room=f.name.slice(prefix.length).replace(/\.jpe?g$/i,'');const url='https://drive.google.com/file/d/'+f.id+'/view';return {id:f.id,rev:f.modifiedTime||f.id,url,room,name:f.name,size:0};}).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));}
  function select(exam,manual,index){
    if(manual?.status==='error')return manual;
    if(manual?.files?.length)return manual;
    if(index){const files=match(exam,index);if(new Set(files.map(f=>f.room.toUpperCase())).size!==files.length)return {status:'error',message:'同一教室有多張座位表，請檢查檔名'};return {status:'ok',files};}
    return {status:'error',message:'座位表清單讀取失敗，請使用紙本'};
  }
  return {validate,match,select};
})();
if(typeof module!=='undefined')module.exports=SeatIndex;
