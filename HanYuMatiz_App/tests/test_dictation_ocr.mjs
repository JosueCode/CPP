import test from 'node:test';
import assert from 'node:assert/strict';
import {OCR_LIMITS,normalizeExtractedText,selectPdfPages,extractImage,inspectPdf} from '../web/dictationocr.js';

test('Chinese OCR normalization preserves punctuation, English spacing and decimals',()=>{
 assert.equal(normalizeExtractedText(' 我 喜欢 学习 中文 。\r\n价格是12.5元。 Hello world. '),'我喜欢学习中文。\n价格是12.5元。 Hello world.');
 assert.equal(normalizeExtractedText('我喜歡學習中文。'),'我喜歡學習中文。');
});
test('PDF selection is unique, ordered, bounded and never silently includes unselected pages',()=>{
 assert.deepEqual(selectPdfPages([3,1,3],3),[1,3]);
 for(const invalid of [[],[0],[4],[1.5]])assert.throws(()=>selectPdfPages(invalid,3));
 assert.throws(()=>selectPdfPages(Array.from({length:11},(_,i)=>i+1),11),/10 páginas/u);
});
test('Image and PDF validation prevents processing empty, unsupported and oversized files',async()=>{
 const fake=(size,type,name)=>({size,type,name,arrayBuffer:async()=>new ArrayBuffer(0)});
 await assert.rejects(extractImage(fake(0,'image/png','x.png')),/vacío/u);
 await assert.rejects(extractImage(fake(100,'image/svg+xml','x.svg')),/JPG, PNG o WebP/u);
 await assert.rejects(extractImage(fake(100,'image/svg+xml','renamed.png')),/JPG, PNG o WebP/u);
 await assert.rejects(extractImage(fake(OCR_LIMITS.maxFileBytes+1,'image/png','x.png')),/25 MB/u);
 await assert.rejects(inspectPdf(fake(100,'text/plain','x.txt')),/documento PDF/u);
 await assert.rejects(inspectPdf(fake(OCR_LIMITS.maxFileBytes+1,'application/pdf','x.pdf')),/25 MB/u);
});
test('Cancellation is honored before loading a browser engine',async()=>{
 const signal=AbortSignal.abort();
 await assert.rejects(extractImage({size:10,type:'image/png',arrayBuffer:async()=>new ArrayBuffer(10)},{signal}),error=>error.name==='AbortError');
});
