const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','favicon.png','style.css','core.js','csv-source.js','seat-index.js','csv-config.js','app.js'])fs.copyFileSync(path.join(root,'src',file),path.join(out,file));
const dependency=process.env.PDFJS_DIR||path.join(process.env.USERPROFILE||'', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist');
const vendored=path.join(root,'vendor','pdfjs');const source=fs.existsSync(path.join(vendored,'build','pdf.mjs'))?vendored:dependency;
if(!fs.existsSync(path.join(source,'build','pdf.mjs')))throw Error('找不到 PDF.js；請設定 PDFJS_DIR 或使用 vendor/pdfjs');
const target=path.join(out,'vendor','pdfjs','build');fs.mkdirSync(target,{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.mjs'])fs.copyFileSync(path.join(source,'build',file),path.join(target,file));
for(const folder of ['cmaps','standard_fonts','wasm']){const from=path.join(source,folder);if(!fs.existsSync(from))throw Error('找不到 PDF.js 資源：'+folder);fs.cpSync(from,path.join(out,'vendor','pdfjs',folder),{recursive:true});}
fs.copyFileSync(path.join(source,'LICENSE'),path.join(out,'vendor','pdfjs','LICENSE'));fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Built GitHub Pages static site in dist/.');
