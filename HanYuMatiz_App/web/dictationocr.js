/** Chinese OCR and PDF import. Documents stay in this browser; only the pinned
 * self-hosted software assets are fetched. No file/text is uploaded or persisted.
 * The caller must show an editor and obtain confirmation before starting dictation.
 */
export const OCR_LIMITS = Object.freeze({maxFileBytes:25*1024*1024,maxImagePixels:4_000_000,maxSourcePixels:100_000_000,maxPdfPages:100,maxSelectedPages:10,maxExtractedCharacters:20_000});
const chinese = /\p{Script=Han}/u;
const imageMime = /^image\/(?:jpeg|png|webp)$/u;
const assetBytes = new Map();
const assetUrls = new Map();
let pdfModulePromise;
let nextJob = 0;
const aborted = () => new DOMException('Extracción cancelada.', 'AbortError');
const checkAbort = signal => {if(signal?.aborted) throw aborted();};
const fail = (message,code='OCR_ERROR') => Object.assign(new Error(message),{code});
function progress(options,status,value,page=1,pages=1) {
  checkAbort(options.signal);
  options.onProgress?.({status,message:status,progress:Math.max(0,Math.min(1,value)),page,pages});
}
function validateFile(file,kind) {
  if(!file || typeof file.arrayBuffer!=='function' || !Number.isFinite(file.size)) throw fail('Selecciona un archivo para extraer el texto.','FILE_REQUIRED');
  if(file.size===0) throw fail('El archivo está vacío. Selecciona otra imagen o PDF.','EMPTY_FILE');
  if(file.size>OCR_LIMITS.maxFileBytes) throw fail('El archivo supera 25 MB. Reduce su tamaño o selecciona unas pocas páginas.','FILE_TOO_LARGE');
  if(kind==='image' && ((file.type && file.type!=='application/octet-stream' && !imageMime.test(file.type)) || (!imageMime.test(file.type||'') && !/\.(?:jpe?g|png|webp)$/iu.test(file.name||'')))) throw fail('Usa una imagen JPG, PNG o WebP.','UNSUPPORTED_IMAGE');
  if(kind==='pdf' && file.type!=='application/pdf' && !/\.pdf$/iu.test(file.name||'')) throw fail('Usa un documento PDF.','UNSUPPORTED_PDF');
}
export function normalizeExtractedText(value) {
  return String(value||'').normalize('NFC').replaceAll('\r\n','\n').replaceAll('\r','\n').replaceAll('\u0000','').replace(/[\t\f\v ]+/gu,' ').replace(/(?<=\p{Script=Han}) (?=\p{Script=Han}|[，。！？、；：])/gu,'').replace(/(?<=[，。！？、；：]) (?=\p{Script=Han})/gu,'').split('\n').map(line=>line.trim()).join('\n').replace(/\n{3,}/gu,'\n\n').trim();
}
export function selectPdfPages(pages,pageCount) {
  if(!Array.isArray(pages)||!pages.length) throw fail('Selecciona al menos una página.','PAGES_REQUIRED');
  const selected=[...new Set(pages)].sort((a,b)=>a-b);
  if(selected.length>OCR_LIMITS.maxSelectedPages) throw fail('Selecciona como máximo 10 páginas cada vez.','TOO_MANY_PAGES');
  if(selected.some(number=>!Number.isInteger(number)||number<1||number>pageCount)) throw fail('Una página seleccionada no existe en este PDF.','INVALID_PAGE');
  return selected;
}
function decodeBase64(value) {
  const binary=atob(value.trim());
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
  return bytes;
}
async function getAsset(name,signal) {
  checkAbort(signal);
  if(assetBytes.has(name)) return assetBytes.get(name);
  const element=[...document.querySelectorAll('[data-ocr-asset]')].find(item=>item.dataset.ocrAsset===name);
  let bytes;
  if(element) bytes=decodeBase64(element.textContent);
  else {
    const response=await fetch(new URL(`./vendor/ocr/${name}`,import.meta.url),{signal,credentials:'same-origin'});
    if(!response.ok) throw fail('No se pudo cargar el motor de extracción. Comprueba que el hosting incluya la carpeta vendor/ocr.','ASSET_UNAVAILABLE');
    bytes=new Uint8Array(await response.arrayBuffer());
  }
  checkAbort(signal);
  assetBytes.set(name,bytes);
  return bytes;
}
async function getAssetUrl(name,type='application/javascript',signal) {
  if(assetUrls.has(name)) return assetUrls.get(name);
  const url=URL.createObjectURL(new Blob([await getAsset(name,signal)],{type}));
  assetUrls.set(name,url);
  return url;
}
function canvasBlob(canvas) {return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(fail('No se pudo preparar esta imagen.')),'image/png'));}
async function decodeImage(file,signal) {
  checkAbort(signal);
  // Decode only raster formats supported by the UI. A renamed SVG is never
  // passed to an image decoder, even if its extension or MIME claims to be PNG.
  const prefix=new Uint8Array(await file.slice(0,32).arrayBuffer());checkAbort(signal);
  const png=prefix.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>prefix[index]===value);
  const jpeg=prefix.length>=3&&prefix[0]===255&&prefix[1]===216&&prefix[2]===255;
  const webp=prefix.length>=12&&String.fromCharCode(...prefix.slice(0,4))==='RIFF'&&String.fromCharCode(...prefix.slice(8,12))==='WEBP';
  if(!png&&!jpeg&&!webp)throw fail('La imagen no se puede abrir. Usa un archivo JPG, PNG o WebP válido.','CORRUPT_IMAGE');
  if(png) {
    const header=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength);
    if(header.getUint32(16)*header.getUint32(20)>OCR_LIMITS.maxSourcePixels)throw fail('La resolución de esta imagen es demasiado grande. Reduce sus dimensiones antes de subirla.','IMAGE_TOO_LARGE');
  }
  let bitmap;
  try {bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});} catch {throw fail('La imagen no se puede abrir. Puede estar dañada o tener un formato distinto de JPG, PNG o WebP.','CORRUPT_IMAGE');}
  try {
    checkAbort(signal);
    if(bitmap.width*bitmap.height>OCR_LIMITS.maxSourcePixels) throw fail('La resolución de esta imagen es demasiado grande. Reduce sus dimensiones antes de subirla.','IMAGE_TOO_LARGE');
    const scale=Math.min(1,Math.sqrt(OCR_LIMITS.maxImagePixels/(bitmap.width*bitmap.height)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d',{alpha:false});
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return {canvas,scaled:scale<1};
  } finally {bitmap.close();}
}
/** Use the pinned Tesseract.js worker protocol directly so cancellation can
 * terminate the worker even during WASM/model initialization, not only after it.
 */
async function createOcrWorker(options,initialPage=1,totalPages=1,pageIndex=0) {
  progress(options,'Cargando el motor chino…',(pageIndex+0.03)/totalPages,initialPage,totalPages);
  const [workerUrl,coreUrl,languageData]=await Promise.all([
    getAssetUrl('tesseract-worker.min.js','application/javascript',options.signal),
    getAssetUrl('tesseract-core-lstm.wasm.js','application/javascript',options.signal),
    getAsset(options.script==='traditional'?'chi_tra.traineddata.gz':'chi_sim.traineddata.gz',options.signal),
  ]);
  checkAbort(options.signal);
  // The upstream 4.0.0 models contain retired configuration parameters. Preserve
  // their benign initialization diagnostics as warnings, rather than errors.
  const bootstrap=URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(coreUrl)});const factory=TesseractCore;TesseractCore=(options={})=>factory({...options,printErr:message=>{if(/^Warning: Parameter not found: (?:language_model_ngram_on|segsearch_max_char_wh_ratio|language_model_ngram_space_delimited_language|language_model_use_sigmoidal_certainty|language_model_ngram_nonmatch_score|classify_integer_matcher_multiplier|assume_fixed_pitch_char_segment|allow_blob_division)$/.test(message))console.warn(message);else console.error(message);}});importScripts(${JSON.stringify(workerUrl)});`],{type:'application/javascript'}));
  const worker=new Worker(bootstrap);
  const pending=new Map();
  let closed=false;
  const terminate=()=>{if(closed)return;closed=true;worker.terminate();URL.revokeObjectURL(bootstrap);options.signal?.removeEventListener('abort',onAbort);for(const callbacks of pending.values())callbacks.reject(aborted());pending.clear();};
  const onAbort=()=>terminate();
  options.signal?.addEventListener('abort',onAbort,{once:true});
  worker.onmessage=({data})=>{
    const callbacks=pending.get(data.jobId);
    if(!callbacks)return;
    if(data.status==='progress')callbacks.progress?.(data.data);
    else {pending.delete(data.jobId);if(data.status==='resolve')callbacks.resolve(data.data);else callbacks.reject(fail('El reconocimiento no pudo completarse. Prueba con una imagen más nítida o pega el texto manualmente.','OCR_RECOGNITION_FAILED'));}
  };
  worker.onerror=()=>{for(const callbacks of pending.values())callbacks.reject(fail('El navegador no pudo iniciar el motor OCR. Prueba un navegador actualizado y comprueba los recursos del hosting.','OCR_ENGINE_FAILED'));pending.clear();terminate();};
  const request=(action,payload,onProgress)=>new Promise((resolve,reject)=>{if(closed||options.signal?.aborted){reject(aborted());return;}const jobId=`hymy-ocr-${++nextJob}`;pending.set(jobId,{resolve,reject,progress:onProgress});worker.postMessage({workerId:'hymy-local',jobId,action,payload});});
  try {
    const code=options.script==='traditional'?'chi_tra':'chi_sim';
    await request('load',{options:{lstmOnly:true,logging:false}});
    await request('loadLanguage',{langs:[{code,data:languageData}],options:{cacheMethod:'none',gzip:true,lstmOnly:true}});
    await request('initialize',{langs:code,oem:1,config:{}});
    await request('setParameters',{params:{tessedit_pageseg_mode:'3',preserve_interword_spaces:'0',user_defined_dpi:'200'}});
    return {terminate,recognize:async(canvas,page,pages,index=0)=>{
      const blob=await canvasBlob(canvas);checkAbort(options.signal);
      const image=new Uint8Array(await blob.arrayBuffer());
      return request('recognize',{image,options:{},output:{text:true,blocks:true}},data=>progress(options,'Reconociendo caracteres chinos…',(index+0.15+0.8*(data.progress||0))/pages,page,pages));
    }};
  } catch(error) {terminate();throw error;}
}
function ocrLines(data) {
  const result=[];
  for(const block of data.blocks||[]) for(const paragraph of block.paragraphs||[]) for(const line of paragraph.lines||[]) {
    const words=(line.words||[]).map(word=>({text:normalizeExtractedText(word.text),confidence:Number(word.confidence)||0,bbox:word.bbox})).filter(word=>word.text);
    if(words.length)result.push({text:normalizeExtractedText(words.map(word=>word.text).join(' ')),confidence:Number(line.confidence)||0,bbox:line.bbox,words});
  }
  return result;
}
function confidenceFragments(lines) {return lines.flatMap(line=>line.words.filter(word=>word.confidence<70).map(word=>({text:word.text,confidence:Math.round(word.confidence)}))).slice(0,80);}
function extractionResult(pages,preview,extraWarnings=[]) {
  const text=normalizeExtractedText(pages.map(page=>page.text).filter(Boolean).join('\n\n'));
  if(!chinese.test(text)) throw fail('No se reconocieron caracteres chinos. Prueba con una imagen nítida, otro modelo de chino o introduce el texto manualmente.','NO_CHINESE_TEXT');
  if(Array.from(text).length>OCR_LIMITS.maxExtractedCharacters) throw fail('El texto supera 20.000 caracteres. Extrae menos páginas o usa un fragmento más corto.','TEXT_TOO_LONG');
  const measured=pages.filter(page=>Number.isFinite(page.confidence));
  const warnings=[...new Set([...extraWarnings,...pages.flatMap(page=>page.warnings||[])])];
  if(pages.some(page=>page.method!=='digital')) warnings.unshift('El OCR puede confundir caracteres y puntuación. Revisa y confirma el texto antes de generar el dictado.');
  return {text,pages,confidence:measured.length?Math.round(measured.reduce((sum,page)=>sum+page.confidence,0)/measured.length):null,warnings:[...new Set(warnings)],preview};
}
export async function extractImage(file,options={}) {
  validateFile(file,'image');checkAbort(options.signal);
  progress(options,'Preparando la imagen…',0);
  const {canvas,scaled}=await decodeImage(file,options.signal);
  const preview=canvas.toDataURL('image/png');
  let worker;
  try {
    worker=await createOcrWorker(options);
    const data=await worker.recognize(canvas,1,1);checkAbort(options.signal);
    const lines=ocrLines(data);
    const warnings=[];
    if(scaled)warnings.push('Se ha reducido una imagen grande para controlar la memoria. Comprueba especialmente los caracteres pequeños.');
    const lowConfidence=confidenceFragments(lines);
    if(Number(data.confidence)<70)warnings.push('La confianza del reconocimiento es baja. Revisa cuidadosamente el texto o vuelve a fotografiar la página.');
    else if(lowConfidence.length)warnings.push('Hay fragmentos con baja confianza. Comprueba los caracteres señalados aunque el resto del texto parezca correcto.');
    const result=extractionResult([{number:1,method:'ocr',text:normalizeExtractedText(data.text),confidence:Number(data.confidence),lowConfidence,warnings}],preview);
    progress(options,'Texto extraído. Revísalo antes de continuar.',1);
    return result;
  } finally {worker?.terminate();canvas.width=0;canvas.height=0;}
}
async function loadPdf(options) {
  checkAbort(options.signal);
  // Software initialization is shared; a user's cancelled document must never
  // cancel another document waiting for the same library. Private file reads and
  // page rendering still honor each consumer's AbortSignal independently.
  if(!pdfModulePromise)pdfModulePromise=(async()=>{
    const moduleUrl=await getAssetUrl('pdf.min.mjs','application/javascript');
    const module=await import(moduleUrl);
    module.GlobalWorkerOptions.workerSrc=await getAssetUrl('pdf.worker.min.mjs','application/javascript');
    return module;
  })().catch(error=>{pdfModulePromise=undefined;throw error;});
  const module=await pdfModulePromise;
  checkAbort(options.signal);
  return module;
}
const documents=new Map();
class LocalPdfBinaryDataFactory {
  async fetch({kind,filename}) {
    const directory={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'}[kind];
    if(!directory || !/^[a-zA-Z0-9_.-]+$/u.test(filename))throw fail('Este PDF solicita un recurso no admitido.');
    return (await getAsset(`${directory}/${filename}`)).slice();
  }
}
async function renderPage(page,{maxPixels=OCR_LIMITS.maxImagePixels,maxWidth=2500,signal}={}) {
  const base=page.getViewport({scale:1});
  const scale=Math.min(maxWidth/base.width,Math.sqrt(maxPixels/(base.width*base.height)),3);
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const context=canvas.getContext('2d',{alpha:false});
  const rendering=page.render({canvasContext:context,viewport,background:'#ffffff'});
  const onAbort=()=>rendering.cancel();signal?.addEventListener('abort',onAbort,{once:true});
  try {checkAbort(signal);await rendering.promise;checkAbort(signal);return {canvas,viewport,scale};}
  catch(error){canvas.width=0;canvas.height=0;if(signal?.aborted)throw aborted();throw error;}
  finally{signal?.removeEventListener('abort',onAbort);}
}
export async function inspectPdf(file,options={}) {
  validateFile(file,'pdf');checkAbort(options.signal);progress(options,'Abriendo el PDF…',0);
  const module=await loadPdf(options);
  const bytes=new Uint8Array(await file.arrayBuffer());checkAbort(options.signal);
  const task=module.getDocument({data:bytes,BinaryDataFactory:LocalPdfBinaryDataFactory,cMapPacked:true,useWorkerFetch:false,isEvalSupported:false,enableXfa:false,verbosity:0,stopAtErrors:true});
  const onAbort=()=>task.destroy();options.signal?.addEventListener('abort',onAbort,{once:true});
  let pdf;
  try {
    pdf=await task.promise;checkAbort(options.signal);
    if(pdf.numPages>OCR_LIMITS.maxPdfPages)throw fail('Este PDF supera 100 páginas. Divide el documento y carga una parte más pequeña.','PDF_TOO_MANY_PAGES');
    const id=`pdf-${Date.now()}-${++nextJob}`;
    let disposed=false;
    const handle={id,pageCount:pdf.numPages,pages:Array.from({length:pdf.numPages},(_,index)=>({number:index+1})),preview:'',previewPage:1,
      async previewPageImage(number,previewOptions={}) {
        if(disposed)throw fail('Vuelve a seleccionar el PDF.','PDF_DISPOSED');
        if(!Number.isInteger(number)||number<1||number>pdf.numPages)throw fail('Esta página no existe.','INVALID_PAGE');
        const page=await pdf.getPage(number);
        const {canvas}=await renderPage(page,{maxPixels:900_000,maxWidth:900,signal:previewOptions.signal});
        try {return canvas.toDataURL('image/png');}finally{canvas.width=0;canvas.height=0;page.cleanup();}
      },
      async dispose(){if(disposed)return;disposed=true;documents.delete(id);await task.destroy();},
    };
    documents.set(id,{pdf,task,handle});
    try {handle.preview=await handle.previewPageImage(1,options);} catch(error) {await handle.dispose();throw error;}
    progress(options,`PDF listo: ${pdf.numPages} páginas. Selecciona las que quieras usar.`,1);
    return handle;
  } catch(error) {
    await task.destroy().catch(()=>{});
    if(options.signal?.aborted)throw aborted();
    if(error.name==='PasswordException')throw fail('El PDF está protegido con contraseña. Carga una copia desbloqueada que tengas permiso para usar.','PDF_PASSWORD');
    if(typeof error.code==='string')throw error;
    throw fail('No se pudo abrir el PDF. Puede estar dañado o no ser un documento PDF válido.','CORRUPT_PDF');
  } finally {options.signal?.removeEventListener('abort',onAbort);}
}
function digitalLines(content,viewport) {
  const lines=[];
  for(const item of content.items||[]) {
    if(typeof item.str!=='string'||!item.str.trim())continue;
    const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
    const height=Math.max(3,Math.hypot(item.transform[2],item.transform[3])*viewport.scale);
    const box={x0:x,y0:y-height,x1:x+Math.abs(item.width*viewport.scale),y1:y+height*.25};
    const row=lines.find(line=>Math.abs(line.y-y)<Math.max(3,height*.35));
    const span={text:item.str,x,bbox:box,hasEOL:item.hasEOL};
    if(row)row.spans.push(span);else lines.push({y,spans:[span],bbox:box});
  }
  return lines.sort((a,b)=>a.y-b.y).map(line=>{
    line.spans.sort((a,b)=>a.x-b.x);
    return {text:normalizeExtractedText(line.spans.map(span=>span.text).join(' ')),bbox:{x0:Math.min(...line.spans.map(span=>span.bbox.x0)),y0:Math.min(...line.spans.map(span=>span.bbox.y0)),x1:Math.max(...line.spans.map(span=>span.bbox.x1)),y1:Math.max(...line.spans.map(span=>span.bbox.y1))},digitalBoxes:line.spans.map(span=>span.bbox)};
  });
}
function coveredByDigital(word,boxes) {
  if(!word.bbox)return false;
  const box=word.bbox;const area=Math.max(1,(box.x1-box.x0)*(box.y1-box.y0));
  return boxes.some(other=>Math.max(0,Math.min(box.x1,other.x1)-Math.max(box.x0,other.x0))*Math.max(0,Math.min(box.y1,other.y1)-Math.max(box.y0,other.y0))/area>0.3);
}
function hasSubstantialImage(operators,module,page) {
  let matrix=[1,0,0,1,0,0];const stack=[];
  const imageOps=new Set([module.OPS.paintImageXObject,module.OPS.paintInlineImageXObject,module.OPS.paintImageMaskXObject]);
  const specialImageOps=new Set([module.OPS.paintImageXObjectRepeat,module.OPS.paintInlineImageXObjectGroup,module.OPS.paintImageMaskXObjectGroup,module.OPS.paintImageMaskXObjectRepeat]);
  const view=page.view;const pageArea=Math.abs((view[2]-view[0])*(view[3]-view[1]));
  for(let index=0;index<operators.fnArray.length;index++) {
    const operator=operators.fnArray[index];const args=operators.argsArray[index];
    if(operator===module.OPS.save)stack.push(matrix.slice());
    else if(operator===module.OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(operator===module.OPS.transform) {
      const [a,b,c,d,e,f]=matrix;const [g,h,i,j,k,l]=args;
      matrix=[a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
    } else if(specialImageOps.has(operator))return true;
    else if(imageOps.has(operator)) {
      const width=Math.hypot(matrix[0],matrix[1]);const height=Math.hypot(matrix[2],matrix[3]);
      const area=Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]);
      if(width>=40&&height>=20&&area>=pageArea*.008)return true;
    }
  }
  return false;
}
export async function extractPdf(documentOrFile,options={}) {
  let handle=documentOrFile;let ownsDocument=false;
  if(typeof documentOrFile?.arrayBuffer==='function'){handle=await inspectPdf(documentOrFile,options);ownsDocument=true;}
  const entry=documents.get(handle?.id);
  if(!entry)throw fail('Selecciona otra vez el PDF para extraer su texto.','PDF_DISPOSED');
  const selected=selectPdfPages(options.pages||[1],handle.pageCount);
  let worker;let preview=handle.preview;
  const results=[];
  try {
    const module=await loadPdf(options);
    for(let index=0;index<selected.length;index++) {
      checkAbort(options.signal);const number=selected[index];
      progress(options,`Leyendo la página ${number}…`,index/selected.length,number,selected.length);
      const page=await entry.pdf.getPage(number);
      let canvas;
      try {
        const content=await page.getTextContent();checkAbort(options.signal);
        const operators=await page.getOperatorList();checkAbort(options.signal);
        const hasImages=hasSubstantialImage(operators,module,page);
        const digitalText=normalizeExtractedText(content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join(''));
        const hasChinese=chinese.test(digitalText);
        if(hasChinese&&!hasImages) {
          const lines=digitalLines(content,page.getViewport({scale:1}));
          results.push({number,method:'digital',text:normalizeExtractedText(lines.map(line=>line.text).join('\n')),confidence:null,lowConfidence:[],warnings:['El texto digital también puede tener encabezados o un orden de lectura distinto. Revísalo antes de confirmar.']});
        } else {
          const rendered=await renderPage(page,{signal:options.signal});canvas=rendered.canvas;
          if(index===0)preview=canvas.toDataURL('image/png');
          if(!worker)worker=await createOcrWorker(options,number,selected.length,index);
          const data=await worker.recognize(canvas,number,selected.length,index);checkAbort(options.signal);
          const lines=ocrLines(data);let lowConfidence=confidenceFragments(lines);const warnings=[];
          let text=normalizeExtractedText(data.text);let method='ocr';
          if(hasChinese) {
            method='mixed';const digital=digitalLines(content,rendered.viewport);
            const boxes=digital.flatMap(line=>line.digitalBoxes);
            const additional=lines.map(line=>{const words=line.words.filter(word=>!coveredByDigital(word,boxes));return {...line,words,text:normalizeExtractedText(words.map(word=>word.text).join(' '))};}).filter(line=>line.text&&chinese.test(line.text));
            lowConfidence=confidenceFragments(additional);
            text=normalizeExtractedText([...digital,...additional].sort((a,b)=>(a.bbox?.y0||0)-(b.bbox?.y0||0)||(a.bbox?.x0||0)-(b.bbox?.x0||0)).map(line=>line.text).join('\n'));
            warnings.push(`Página ${number}: se combinaron texto digital y zonas reconocidas. Revisa el orden de lectura; una maquetación compleja puede necesitar ajustes.`);
          }
          if(Number(data.confidence)<70||lowConfidence.length)warnings.push(`Página ${number}: hay fragmentos con baja confianza. Comprueba los caracteres señalados y la puntuación.`);
          results.push({number,method,text,confidence:Number(data.confidence),lowConfidence,warnings});
        }
        progress(options,`Página ${number} extraída.`,(index+1)/selected.length,number,selected.length);
      } finally {if(canvas){canvas.width=0;canvas.height=0;}page.cleanup();}
    }
    const result=extractionResult(results,preview);progress(options,'Extracción terminada. Revisa y confirma el texto.',1,selected.at(-1),selected.length);return result;
  } catch(error) {if(options.signal?.aborted)throw aborted();if(typeof error.code==='string')throw error;throw fail('No se pudo extraer una de las páginas. Prueba con otra selección o una copia más nítida.','PDF_EXTRACTION_FAILED');}
  finally{worker?.terminate();if(ownsDocument)await handle.dispose();}
}
