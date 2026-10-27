const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../dist');
if(!fs.existsSync(path.join(root,'index.html')))throw new Error('請先執行 npm run build');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.pdf':'application/pdf','.wasm':'application/wasm','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const url=new URL(req.url,'http://localhost');
  let requested;try{requested=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  const file=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(bytes);});
});
const port=Number(process.env.PORT||4173);server.listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port+'\n模擬驗收: http://127.0.0.1:'+port+'/?demo=1'));
module.exports=server;
