/* Published Google Sheets CSV adapter; never writes to Google Sheets. */
var CsvSource = (function(){
  'use strict';
  const names=['exams','notices','reminders','settings'];
  const required={exams:['考試ID','學期','考試類型','考試科目','考試日期','開始時間','結束時間','考前提醒版本','考試注意事項版本','啟用','座位表 JPG 連結1','座位表 JPG 連結2'],notices:['版本代碼','版本名稱','順序','提醒內容'],reminders:['版本代碼','版本名稱','順序','提醒內容'],settings:['設定項目','設定值']};
  function parse(text){
    if(typeof text!=='string')throw Error('CSV 必須是文字');if(/^\s*</.test(text))throw Error('收到 HTML，請確認工作表已發布為 CSV');
    text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false,closed=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
      if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw Error('CSV 引號後有多餘字元');
      if(c==='"'){if(field)throw Error('CSV 欄位引號格式不正確');quoted=true;}
      else if(c===','){row.push(field);field='';closed=false;}
      else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';closed=false;}
      else field+=c;
    }
    if(quoted)throw Error('CSV 引號未關閉');if(row.length||field||closed){row.push(field);rows.push(row);}return rows;
  }
  function objects(text,kind){const rows=parse(text),rawHeader=rows.shift(),header=rawHeader?.map(h=>kind==='exams'?h.replace(/^座位表 PDF 連結([12])$/,'座位表 JPG 連結$1'):h);if(!header)throw Error(kind+' 沒有標題列');const seen=new Set();for(const h of header){const k=h.trim();if(k&&seen.has(k))throw Error(kind+' 欄名重複：'+k);seen.add(k);}for(const h of required[kind])if(!seen.has(h))throw Error(kind+' 缺少欄位：'+h);
    return rows.filter(row=>row.some(v=>v.trim())).map(row=>Object.fromEntries(header.map((key,i)=>[key.trim(),(row[i]||'').trim()])));
  }
  function date(value){const m=String(value).trim().match(/^(\d{2}|\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);if(!m)return '';let y=Number(m[1]);if(m[1].length===2)y+=2000;const out=String(y)+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');const n=Date.parse(out+'T00:00:00+08:00');return Number.isFinite(n)&&new Date(n+8*3600000).toISOString().slice(0,10)===out?out:'';}
  function time(value){const m=String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);if(!m||+m[1]>23||+m[2]>59||(m[3]&&+m[3]!==0))return '';return m[1].padStart(2,'0')+':'+m[2];}
  function link(value){if(!value)return '';try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
  function driveImage(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='drive.google.com'||u.username||u.password)return '';const m=u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/(?:view|preview))?\/?$/);if(!m)return '';return 'https://drive.google.com/thumbnail?id='+encodeURIComponent(m[1])+'&sz=w2000';}catch{return '';}}
  function room(url,index){try{const name=decodeURIComponent(new URL(url).pathname.split('/').pop()),m=name.match(/_([^_\/]+)\.pdf$/i);return m?m[1]:'座位表 '+(index+1);}catch{return '座位表 '+(index+1);}}
  function decode(tables){
    const fields=['考試ID','學期','考試類型','考試科目','考試日期','開始時間','結束時間','考前提醒版本','考試注意事項版本','座位表 JPG 連結1','座位表 JPG 連結2'];
    const exams=objects(tables.exams,'exams').filter(r=>fields.some(k=>r[k])||r['啟用'].toUpperCase()==='TRUE').map(r=>({id:r['考試ID'],semester:r['學期'],type:r['考試類型'],course:r['考試科目'],date:date(r['考試日期']),start:time(r['開始時間']),end:time(r['結束時間']),reminder:r['考前提醒版本'],noticeVersion:r['考試注意事項版本'],enabled:r['啟用'].toUpperCase()==='TRUE',pdfUrls:[r['座位表 JPG 連結1'],r['座位表 JPG 連結2']]}));
    const map=r=>({version:r['版本代碼'],name:r['版本名稱'],order:Number(r['順序']),text:r['提醒內容']});
    const notices=objects(tables.notices,'notices').map(map),reminders=objects(tables.reminders,'reminders').map(map);
    const settingsRows=objects(tables.settings,'settings'),d=Object.fromEntries(settingsRows.map(r=>[r['設定項目'],r['設定值']]));
    const settings={seatingMinutes:d['座位表提前顯示（分鐘）'],reminderMinutes:d['考前提醒提前顯示（分鐘）'],endMinutes:d['考試結束畫面保留（分鐘）'],refreshSeconds:d['考試資料更新間隔（秒）'],maxPdfs:d['座位表最大顯示份數'],sound:d['考前倒數音效']};
    const seats={},warnings=[];for(const e of exams){const files=[];for(let i=0;i<e.pdfUrls.length;i++){const raw=e.pdfUrls[i];if(!raw)continue;const url=link(raw);if(!url){warnings.push((e.id||'未編號')+'：座位表連結 '+(i+1)+' 不是有效的 HTTPS 網址');continue;}files.push({id:url,rev:url,url,room:room(url,i),name:'座位表 '+(i+1),size:0});}seats[e.id]={status:'ok',files};if(e.pdfUrls.some(v=>v&&!link(v)))seats[e.id]={status:'error',message:'座位表連結格式錯誤，請使用紙本'};delete e.pdfUrls;}
    return {exams,notices,reminders,settings,seats,serverWarnings:warnings};
  }
  function sourceUrl(value){try{const u=new URL(value),allowed=new Set(['gid','single','output']);return u.protocol==='https:'&&u.hostname==='docs.google.com'&&/^\/spreadsheets\/d\/e\/[^/]+\/pub$/.test(u.pathname)&&u.searchParams.get('output')==='csv'&&[...u.searchParams.keys()].every(k=>allowed.has(k))&&!u.username&&!u.password?u.href:'';}catch{return '';}}
  function derive(value){const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||!/^\/spreadsheets\/d\/e\/[^/]+\/pub(?:html)?$/.test(u.pathname)||u.username||u.password)throw Error('請貼上試算表「發布到網路」取得的網址');u.pathname=u.pathname.replace(/pubhtml$/,'pub');u.search='';return Object.fromEntries(names.map((name,i)=>{const v=new URL(u.href);v.searchParams.set('gid',String(101+i));v.searchParams.set('single','true');v.searchParams.set('output','csv');return [name,v.href];}));}
  async function load(sources,fetcher=fetch){const out={};await Promise.all(names.map(async name=>{const url=sourceUrl(sources?.[name]);if(!url)throw Error('請設定有效的已發布 Google Sheets CSV：'+name);const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('CSV 讀取失敗：'+name+'（'+response.status+'）');out[name]=await response.text();}));return decode(out);}
  return {names,required,parse,objects,date,time,link,driveImage,room,decode,sourceUrl,derive,load};
})();
if(typeof module!=='undefined')module.exports=CsvSource;
