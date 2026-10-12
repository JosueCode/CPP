/** Build one HTML with its content, styles, fonts and JavaScript included. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCatalog, ROOT } from './catalog.mjs';

const WEB=path.join(ROOT,'web');
const sha=value=>crypto.createHash('sha256').update(value).digest('base64');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const htmlText=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

/** Read only the pinned, public OCR distribution and verify every delivered byte. */
export function readOCRDistribution() {
  const folder=path.join(WEB,'vendor/ocr');
  const manifestBytes=fs.readFileSync(path.join(folder,'manifest.json'));
  const manifest=JSON.parse(manifestBytes);
  if(manifest.schemaVersion!==1 || !Array.isArray(manifest.assets) || !Array.isArray(manifest.licenses))
    throw Error('Manifiesto OCR inválido');
  const readVerified=(entry)=>{
    if(!entry || !/^[A-Za-z0-9_./-]+$/.test(entry.name) || entry.name.startsWith('/') || entry.name.split('/').includes('..'))
      throw Error('Ruta OCR inválida');
    const target=path.join(folder,entry.name);
    if(!fs.realpathSync(target).startsWith(fs.realpathSync(folder)+path.sep))throw Error('Recurso OCR fuera de su carpeta');
    const data=fs.readFileSync(target);
    if(data.length!==entry.bytes || digest(data)!==entry.sha256)throw Error('Recurso OCR modificado: '+entry.name);
    return {...entry,data};
  };
  const assets=manifest.assets.map(readVerified),licenses=manifest.licenses.map(readVerified);
  const names=[...assets,...licenses].map(entry=>entry.name);
  if(new Set(names).size!==names.length)throw Error('Recurso OCR duplicado');
  const additional=['NOTICE.txt','npm-lock.json'].map(name=>({name,data:fs.readFileSync(path.join(folder,name))}));
  return {manifest,manifestBytes,assets,licenses,additional};
}

function transformModule(name) {
  let code=fs.readFileSync(path.join(WEB,name+'.js'),'utf8');
  code=code.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([a-z]+)\.js['"];?\s*$/gm,
    (_,names,dependency)=>`const {${names}}=modules.${dependency};`);
  if (/^import\s/m.test(code)) throw Error('Importación no soportada en el HTML: '+name);
  // The offline bundle is a classic script. OCR always finds the embedded assets;
  // this base is only a safe fallback if that module is reused without its bundle.
  if(name==='dictationocr')code=code.replaceAll('import.meta.url','document.baseURI');
  if(/\bimport\.meta\b/.test(code))throw Error('import.meta no adaptado en el HTML: '+name);
  const exports=[...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(match=>match[1]);
  code=code.replace(/^export\s+/gm,'');
  if (name==='main') {
    const old="  const response = await fetch('/api/bootstrap', { credentials: 'same-origin', cache: 'no-store' });\n  if (!response.ok) throw new Error('No se pudo cargar el banco autorizado.');\n  bootstrap = await response.json();";
    if(!code.includes(old)) throw Error('Ha cambiado la carga del catálogo; actualizar el adaptador HTML');
    code=code.replace(old,"  bootstrap = JSON.parse(document.querySelector('#previewData').textContent);");
    code=code.replace('Comprueba que has iniciado el servidor y que tu acceso al entorno privado está autorizado.',
      'Vuelve a descargar el HTML completo y ábrelo en un navegador actualizado.');
    code=code.replace('Sin conexión con el servidor','No se pudo abrir la vista');
    return `(async()=>{\n${code}\n})().catch(error=>console.error(error));\n`;
  }
  return `modules.${name}=(()=>{\n${code}\nreturn {${exports.join(',')}};\n})();\n`;
}

export function buildPreview({outputDir, filename='HanYuMatiz_HSK_y_Dictado.html'} = {}) {
  if(path.basename(filename)!==filename || !filename.endsWith('.html')) throw Error('Nombre HTML inválido');
  const catalog=buildCatalog({mode:'public'});
  catalog.delivery='standalone';
  const payload=JSON.stringify(catalog).replaceAll('<','\\u003c');
  const ocr=readOCRDistribution();
  let css=fs.readFileSync(path.join(WEB,'styles.css'),'utf8')+'\n'+fs.readFileSync(path.join(WEB,'dictation.css'),'utf8');
  css=css.replace("@import url('/v9-base.css');",fs.readFileSync(path.join(WEB,'v9-base.css'),'utf8'));
  for(const filename of ['AtelierUI-Regular.woff2','AtelierUI-Bold.woff2','AtelierHanzi.woff2']) {
    const url='data:font/woff2;base64,'+fs.readFileSync(path.join(WEB,'fonts',filename)).toString('base64');
    css=css.replaceAll(`url('/fonts/${filename}')`,`url('${url}')`);
  }
  if(/@import\b/.test(css)) throw Error('El HTML no puede depender de CSS externo');
  const script="(()=>{\n'use strict';\nconst modules=Object.create(null);\n"+
    ['scheduler','engine','progress','reports','dictationcore','dictationaudio','dictationstore','dictationocr','dictation','practice','main'].map(transformModule).join('\n')+'\n})();';
  if(/<\/script/i.test(script)||/<\/style/i.test(css)) throw Error('Cierre de etiqueta inesperado');
  const policy=`default-src 'none'; script-src 'sha256-${sha(script)}' 'sha256-${sha(payload)}' blob: 'wasm-unsafe-eval'; worker-src blob:; style-src 'sha256-${sha(css)}'; font-src data: blob:; img-src data: blob:; connect-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  let html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');
  html=html.replace('<link rel="stylesheet" href="/styles.css">',`<style>${css}</style>`)
    .replace('<link rel="stylesheet" href="/dictation.css">','')
    .replace('<script type="module" src="/main.js"></script>','')
    .replace('<meta name="color-scheme" content="light">',`<meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="${policy}">`);
  const notices=[
    ...['Lato-OFL.txt','NotoSansSC-OFL.txt'].map(name=>({name,data:fs.readFileSync(path.join(WEB,'fonts',name))})),
    ...['ATTRIBUTION.md','CC-BY-SA-4.0.txt'].map(name=>({name:'HSK/'+name,data:fs.readFileSync(path.join(ROOT,'data/hsk',name))})),
    ...ocr.licenses,...ocr.additional.filter(entry=>entry.name==='NOTICE.txt'),
  ];
  const licenseMarkup=notices.map(entry=>`<template data-third-party-notice="${htmlText(entry.name)}">${htmlText(entry.data.toString('utf8'))}</template>`).join('\n');
  const assetMarkup=ocr.assets.map(entry=>`<script type="application/octet-stream" data-ocr-asset="${htmlText(entry.name)}">${entry.data.toString('base64')}</script>`).join('\n');
  html=html.replace('</body>',`${licenseMarkup}\n${assetMarkup}\n<script type="application/json" id="previewData">${payload}</script>\n<script>${script}</script>\n</body>`);
  if(/<(?:script|link)\b[^>]*(?:src|href)=["']\//i.test(html))throw Error('Recurso externo en el HTML autónomo');
  const folder=outputDir ? path.resolve(outputDir) : path.resolve(ROOT,'../shared/downloads',filename.slice(0,-5));
  fs.mkdirSync(folder,{recursive:true});
  const target=path.join(folder,filename);
  fs.writeFileSync(target,html);
  const report={file:target,bytes:Buffer.byteLength(html),sha256:crypto.createHash('sha256').update(html).digest('hex'),
    dataVersion:catalog.dataVersion,...catalog.editorial.counts,requiresPython:false,requiresServer:false,
    reportDelivery:'local_draft_and_export',expertReviewRequired:false,
    ocrAssets:ocr.assets.length,ocrAssetBytes:ocr.assets.reduce((total,entry)=>total+entry.bytes,0),
    ocrDocumentProcessing:'browser_local_review_required',speech:'native_mandarin_voice_required'};
  fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'reports/PASS_01_HTML_BUILD.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),options={};
  while(args.length){
    const option=args.shift(),value=args.shift();
    if(!value || !['--output-dir','--filename'].includes(option))throw Error('Uso: node tools/build_preview.mjs [--output-dir carpeta] [--filename archivo.html]');
    options[option==='--output-dir'?'outputDir':'filename']=value;
  }
  console.log(JSON.stringify(buildPreview(options),null,2));
}
