const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../src/seat-index.js');
const d={generatedAt:'2026-10-28T00:00:00Z',files:[{id:'a',name:'261104資訊組織LE5A.jpg'},{id:'b',name:'261104資訊組織LE205.jpg'},{id:'c',name:'261104資訊組織論LE6.jpg'},{id:'d',name:'261105資訊組織LE7.jpg'},{id:'e',name:'261104資訊組織LE8.pdf'}]};
test('selects date and course images and reports classroom',()=>{const r=S.match({date:'2026-11-04',course:'資訊組織'},d);assert.deepEqual(r.map(x=>x.room),['LE205','LE5A']);});
test('different dates and invalid index do not invent images',()=>{assert.equal(S.match({date:'2026-11-03',course:'資訊組織'},d).length,0);assert.throws(()=>S.match({date:'2026-11-04',course:'資訊組織'},{}));});

test('manual links take precedence; empty manual links use automatic matches',()=>{const exam={date:'2026-11-04',course:'資訊組織'},manual={status:'ok',files:[{id:'manual'}]};assert.deepEqual(S.select(exam,manual,d),manual);assert.deepEqual(S.select(exam,{status:'ok',files:[]},d).files.map(f=>f.room),['LE205','LE5A']);assert.equal(S.select(exam,{status:'error',message:'壞網址'},d).status,'error');});
