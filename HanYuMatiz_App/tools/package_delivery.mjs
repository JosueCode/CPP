/** Package the already-built HTML and the public source without private runtime files. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_FOLDER='/workspace/shared/downloads/HanYuMatiz_PDF_Corregido';
const HTML_NAME='HanYuMatiz_PDF_Corregido.html';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

// ZIP32, UTF-8 names, fixed timestamps and no platform attributes: reproducible bytes.
const crcTable=Array.from({length:256},(_,number)=>{
  let value=number;
  for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function zip(entries){
  if(entries.length>65535)throw Error('Demasiadas entradas para ZIP32.');
  const locals=[],central=[];let offset=0;
  for(const {name,data} of entries){
    if(!name||name.startsWith('/')||name.split('/').includes('..')||name.includes('\\'))throw Error('Ruta ZIP inválida.');
    const label=Buffer.from(name,'utf8'),packed=deflateRawSync(data,{level:9}),crc=crc32(data);
    if(Math.max(data.length,packed.length,offset)>0xffffffff)throw Error('El paquete supera ZIP32.');
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
    local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(label.length,26);
    locals.push(local,label,packed);
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);
    record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(33,14);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(packed.length,20);record.writeUInt32LE(data.length,24);
    record.writeUInt16LE(label.length,28);record.writeUInt32LE(offset,42);central.push(record,label);
    offset+=local.length+label.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}

function readPublic(relative){
  const full=path.join(ROOT,relative),stat=fs.lstatSync(full);
  if(stat.isSymbolicLink()||!stat.isFile())throw Error('La entrega solo admite archivos públicos regulares: '+relative);
  return {name:'HanYuMatiz_App/'+relative,data:fs.readFileSync(full)};
}
function publicTree(relative){
  const entries=[];
  for(const child of fs.readdirSync(path.join(ROOT,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(child.name.startsWith('.')||child.isSymbolicLink())throw Error('Entrada no permitida en carpeta pública: '+relative+'/'+child.name);
    const target=relative+'/'+child.name;
    if(child.isDirectory())entries.push(...publicTree(target));else entries.push(readPublic(target));
  }
  return entries;
}
function sourceEntries(){
  const files=['.gitignore','README.md','package.json','package-lock.json','server.mjs',
    'data/catalog.json','data/hsk/recommendations.json','data/hsk/reference.json','data/hsk/ATTRIBUTION.md','data/hsk/CC-BY-SA-4.0.txt',
    'docs/BASE_DATOS_REPORTES.md','docs/DEPLOY.md','docs/DEPLOY_GRATIS_RENDER_NEON.md','docs/DICTADO.md','docs/DICTATION_AUDIO.md',
    'docs/HSK.md','docs/UX_PASADA_ACTUAL.md','docs/research/HSK_SELECTION_SOURCE_REVIEW.json'];
  for(let level=1;level<=6;level++)files.push(`data/hsk/sources/HSK_Level_${level}_words.tsv`);
  for(const folder of ['tools','tests'])for(const filename of fs.readdirSync(path.join(ROOT,folder)).sort()){
    if(/^[A-Za-z0-9_]+\.(mjs|py)$/.test(filename))files.push(folder+'/'+filename);
  }
  // The optional regression corpus is original synthetic material. Include only
  // manifest-listed files whose bytes still match, never arbitrary local PDFs.
  const fixtureFiles=[],fixtureManifest='tests/fixtures/pdf/manifest.json';
  if(fs.existsSync(path.join(ROOT,fixtureManifest))){
    const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,fixtureManifest),'utf8'));
    if(!String(manifest.provenance).startsWith('Original synthetic Chinese fixture pages'))throw Error('Procedencia de muestras PDF no reconocida.');
    fixtureFiles.push(readPublic(fixtureManifest));
    for(const [name,expected] of Object.entries(manifest.files||{})){
      if(!/^[a-z0-9-]+\.(pdf|png|jpg)$/.test(name))throw Error('Nombre de muestra PDF inválido.');
      const entry=readPublic('tests/fixtures/pdf/'+name);
      if(entry.data.length!==expected.bytes||sha(entry.data)!==expected.sha256)throw Error('Muestra PDF modificada: '+name);
      fixtureFiles.push(entry);
    }
  }
  const blueprint=[],blueprintPath=path.join(ROOT,'../render.yaml');
  if(fs.existsSync(blueprintPath)){
    const stat=fs.lstatSync(blueprintPath);
    if(stat.isSymbolicLink()||!stat.isFile())throw Error('Blueprint de despliegue inválido.');
    blueprint.push({name:'render.yaml',data:fs.readFileSync(blueprintPath)});
  }
  // Only public application assets and schema are recursive. Runtime folders
  // and reports are deliberately outside this list.
  return [...files.map(readPublic),...publicTree('web'),...publicTree('sql'),...fixtureFiles,...blueprint].sort((a,b)=>a.name.localeCompare(b.name,'en'));
}

export function packageDelivery({html,outputDir=DEFAULT_FOLDER}={}){
  const input=path.resolve(html||path.join(outputDir,HTML_NAME)),folder=path.resolve(outputDir);
  const bytes=fs.readFileSync(input),text=bytes.toString('utf8');
  if(!text.includes('id="previewData"')||!text.includes('data-ocr-asset="pdf.min.mjs"')||!text.includes('data-third-party-notice="LICENSE-PDFJS.txt"'))throw Error('Se requiere el HTML autónomo completo, con OCR y licencias.');
  fs.mkdirSync(folder,{recursive:true});
  const htmlTarget=path.join(folder,HTML_NAME);if(input!==htmlTarget)fs.writeFileSync(htmlTarget,bytes);
  const readme=Buffer.from(`HANYUMATIZ · PDF Y DICTADO\n\n1. Descomprime este ZIP y abre ${HTML_NAME} en un navegador actualizado.\n2. Ve a Dictado → Crear un dictado → Subir PDF. Selecciona un documento y sus páginas.\n3. Pulsa Extraer texto, corrige el reconocimiento y confirma el texto revisado.\n4. Pulsa Revisar frases para preparar la práctica.\n\nNo instales Node.js ni Python para estudiar. El HTML incorpora el catálogo, las fuentes y los motores OCR.\nPDF: hasta 25 MB, 100 páginas por documento y 10 páginas por extracción. Los documentos con contraseña deben abrirse primero en otra aplicación y guardarse sin ella.\nLos PDF e imágenes se procesan en este navegador. Revisa siempre los caracteres: el reconocimiento puede equivocarse. Solo se guarda el texto que confirmes.\nLa escucha necesita una voz real de mandarín del navegador/sistema; las voces remotas requieren tu consentimiento.\nSi el navegador bloquea archivos locales, prueba un navegador actualizado o una copia del mismo HTML publicada por HTTPS. No es necesario convertir el producto a Python.\n\nLas licencias de bibliotecas, modelos, fuentes y referencia HSK están incorporadas en el HTML. Los reportes de esta edición descargable se guardan como borradores para exportar.\nEl ZIP Fuente contiene el proyecto para desarrollo; no es necesario para estudiar ni implica que exista una web publicada.\n`,'utf8');
  const source=sourceEntries();
  const outputs=[
    {name:'HanYuMatiz_PDF_Corregido.zip',data:zip([{name:HTML_NAME,data:bytes},{name:'LEEME.txt',data:readme}])},
    {name:'HanYuMatiz_PDF_Corregido_Fuente.zip',data:zip(source)},
  ];
  for(const output of outputs)fs.writeFileSync(path.join(folder,output.name),output.data);
  fs.writeFileSync(path.join(folder,'LEEME.txt'),readme);
  const manifest={schemaVersion:1,html:{name:HTML_NAME,bytes:bytes.length,sha256:sha(bytes)},
    archives:outputs.map(({name,data})=>({name,bytes:data.length,sha256:sha(data)})),
    sourceFiles:source.map(({name,data})=>({name,bytes:data.length,sha256:sha(data)})),
    exclusions:['.local','node_modules','dist','reports','.env','private credentials','database volumes','personal PDFs/images','unlisted test fixtures']};
  fs.writeFileSync(path.join(folder,'SHA256SUMS.txt'),[manifest.html,...manifest.archives].map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
  fs.writeFileSync(path.join(folder,'DELIVERY_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  return {folder,html:manifest.html,archives:manifest.archives,sourceFileCount:source.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  while(args.length){const flag=args.shift(),value=args.shift();if(!value||!['--html','--output-dir'].includes(flag))throw Error('Uso: node tools/package_delivery.mjs [--html archivo.html] [--output-dir carpeta]');options[flag==='--html'?'html':'outputDir']=value;}
  console.log(JSON.stringify(packageDelivery(options),null,2));
}
