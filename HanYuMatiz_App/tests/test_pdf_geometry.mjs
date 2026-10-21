import test from 'node:test';
import assert from 'node:assert/strict';
import {digitalPdfLines,pdfImageProfile,inspectPdf} from '../web/dictationocr.js';

const OPS={save:1,restore:2,transform:3,paintImageXObject:4,paintInlineImageXObject:5,paintImageMaskXObject:6,paintImageXObjectRepeat:7,paintInlineImageXObjectGroup:8,paintImageMaskXObjectGroup:9,paintImageMaskXObjectRepeat:10,paintFormXObjectBegin:11,paintFormXObjectEnd:12};
const page={view:[0,0,600,800]};
const raster=(width,height,transform=[600,0,0,800,0,0])=>({fnArray:[OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore],argsArray:[[],transform,['scan',width,height],[]]});

test('a dominant low-resolution PDF scan is not enlarged before OCR',()=>{
  assert.deepEqual(pdfImageProfile(raster(600,800),OPS,page),{hasImages:true,maxScale:1});
  assert.deepEqual(pdfImageProfile(raster(1200,1600),OPS,page),{hasImages:true,maxScale:2});
  assert.deepEqual(pdfImageProfile(raster(3000,4000),OPS,page),{hasImages:true,maxScale:3});
});

test('small decorations never lower the rendering resolution for the rest of a page',()=>{
  assert.deepEqual(pdfImageProfile(raster(60,40,[60,0,0,40,0,0]),OPS,page),{hasImages:false,maxScale:3});
  assert.deepEqual(pdfImageProfile(raster(100,100,[100,0,0,100,0,0]),OPS,page),{hasImages:true,maxScale:3});
});

test('native raster scale respects a rotated image matrix, inline images and PDF user units',()=>{
  assert.equal(pdfImageProfile(raster(600,800,[0,600,-800,0,800,0]),OPS,page).maxScale,1);
  const inline={fnArray:[OPS.transform,OPS.paintInlineImageXObject],argsArray:[[600,0,0,800,0,0],[{width:600,height:800}]]};
  assert.equal(pdfImageProfile(inline,OPS,page).maxScale,1);
  assert.equal(pdfImageProfile(raster(600,800),OPS,{...page,userUnit:2}).maxScale,.5);
});

test('image dimensions within nested PDF forms use the form transform and restore it',()=>{
  const operators={fnArray:[OPS.paintFormXObjectBegin,OPS.transform,OPS.paintImageXObject,OPS.paintFormXObjectEnd,OPS.transform,OPS.paintImageXObject],argsArray:[[[2,0,0,2,0,0],null],[300,0,0,400,0,0],['scan',600,800],[],[50,0,0,50,0,0],['logo',50,50]]};
  assert.deepEqual(pdfImageProfile(operators,OPS,page),{hasImages:true,maxScale:1});
});

function viewport(rotation=0,scale=1) {
  return {scale,rotation,clone:options=>viewport(options.rotation??rotation,options.scale??scale),convertToViewportPoint(x,y){
    if(rotation===90)return [y*scale,x*scale];
    if(rotation===180)return [(600-x)*scale,y*scale];
    if(rotation===270)return [(800-y)*scale,(600-x)*scale];
    return [x*scale,(800-y)*scale];
  }};
}
const item=(str,x,y)=>({str,transform:[24,0,0,24,x,y],width:str.length*24,height:24});
const content={items:[item('今天学习中文。',50,720),item('明天一起喝茶。',50,660),item('我们去学校。',50,600)]};

test('digital PDF reading order and line breaks survive display rotation in all four directions',()=>{
  for(const rotation of [0,90,180,270])for(const scale of [1,2]) {
    assert.deepEqual(digitalPdfLines(content,viewport(rotation,scale)).map(line=>line.text),['今天学习中文。','明天一起喝茶。','我们去学校。']);
  }
});

test('mixed PDF masking boxes follow the actual rotated display coordinates',()=>{
  const [line]=digitalPdfLines({items:[item('中文',50,720)]},viewport(90,2));
  assert.deepEqual(line.bbox,{x0:1428,y0:100,x1:1480.8,y1:196});
  assert.deepEqual(line.digitalBoxes,[line.bbox]);
});

test('invalid manual rotation is rejected before loading a document or a browser engine',async()=>{
  const file={size:10,type:'application/pdf',arrayBuffer:async()=>new ArrayBuffer(10)};
  for(const rotation of [-90,45,360,'90',null])await assert.rejects(inspectPdf(file,{rotation}),error=>error.code==='INVALID_ROTATION');
});

test('a browser without required PDF APIs gets an actionable error instead of a raw TypeError',async()=>{
  const original=Object.getOwnPropertyDescriptor(Promise,'withResolvers');
  try {
    Object.defineProperty(Promise,'withResolvers',{configurable:true,value:undefined});
    const file={size:10,type:'application/pdf',arrayBuffer:async()=>new ArrayBuffer(10)};
    await assert.rejects(inspectPdf(file),error=>error.code==='PDF_BROWSER_UNSUPPORTED'&&/Actualiza tu navegador/u.test(error.message));
  } finally {Object.defineProperty(Promise,'withResolvers',original);}
});
