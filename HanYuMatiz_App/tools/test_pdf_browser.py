#!/usr/bin/env python3
"""Real Chromium PDF/OCR regression checks for the standalone HTML.

Requires Playwright, Pillow, pypdf, and reportlab in the development environment.
They are test tools, not application dependencies. No OCR/PDF/network mocks or
browser security bypass flags are used. Fixtures are original synthetic pages,
including a photo-like distortion; they are not physical camera photographs.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import hashlib
import http.server
import io
import json
from pathlib import Path
import random
import sys
import threading
import time
import traceback
from urllib.parse import urlparse

from PIL import Image, ImageEnhance, ImageFilter
from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/pdf"
REPORTS = ROOT / "reports/pdf"
TEXTS = ["今天我们一起学习中文。\n我喜欢喝茶。\n这本书很有意思。", "明天我们一起去学校。\n他正在准备晚饭。"]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_image_pdf(path, images):
    pdf = canvas.Canvas(str(path), pagesize=(600, 800))
    for image in images:
        pdf.drawImage(ImageReader(image), 0, 0, width=600, height=800)
        pdf.showPage()
    pdf.save()


def generate_fixtures(browser):
    FIXTURES.mkdir(parents=True, exist_ok=True)
    font = base64.b64encode((ROOT / "web/fonts/AtelierHanzi.woff2").read_bytes()).decode()
    page = browser.new_page(viewport={"width": 900, "height": 1200}, device_scale_factor=1)
    style = f"""<style>@font-face{{font-family:FixtureHan;src:url(data:font/woff2;base64,{font})}}
    @page{{size:600px 800px;margin:0}} *{{box-sizing:border-box}}body{{margin:0;background:white}}
    .sheet{{width:600px;height:800px;padding:95px 46px;font:30px/2.1 FixtureHan,sans-serif;
    color:#111;white-space:pre-wrap;break-after:page}} .sheet:last-child{{break-after:auto}}</style>"""
    page.set_content(style + ''.join(f'<section class="sheet">{text}</section>' for text in TEXTS))
    page.evaluate("document.fonts.ready")
    page.pdf(path=str(FIXTURES / "digital-chinese.pdf"), print_background=True, prefer_css_page_size=True)
    rotated_digital = PdfWriter()
    rotated_digital.add_page(PdfReader(FIXTURES / 'digital-chinese.pdf').pages[0]).rotate(90)
    with (FIXTURES / 'digital-rotated.pdf').open('wb') as output:
        rotated_digital.write(output)
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    cid = canvas.Canvas(str(FIXTURES / 'digital-cid-font.pdf'), pagesize=(600, 800))
    cid.setFont('STSong-Light', 26)
    for index, line in enumerate(TEXTS[0].splitlines()):
        cid.drawString(45, 680 - index * 55, line)
    cid.showPage()
    cid.save()
    images = []
    for index in range(2):
        image = page.locator('.sheet').nth(index).screenshot(scale='css')
        images.append(Image.open(io.BytesIO(image)).convert("RGB"))
        images[-1].save(FIXTURES / f"chinese-page-{index + 1}.png")
    write_image_pdf(FIXTURES / "scanned-chinese.pdf", images)
    source = PdfReader(FIXTURES / "scanned-chinese.pdf")
    rotated = PdfWriter()
    rotated.add_page(source.pages[0]).rotate(90)
    with (FIXTURES / "rotated-metadata.pdf").open('wb') as output:
        rotated.write(output)
    sideways = images[0].rotate(90, expand=True, fillcolor="white")
    pdf = canvas.Canvas(str(FIXTURES / "sideways-bitmap.pdf"), pagesize=sideways.size)
    pdf.drawImage(ImageReader(sideways), 0, 0, width=sideways.width, height=sideways.height)
    pdf.showPage()
    pdf.save()
    rng = random.Random(7)
    photo = images[0].resize((900, 1200)).rotate(3, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(222, 218, 208))
    photo = ImageEnhance.Contrast(photo).enhance(0.86).filter(ImageFilter.GaussianBlur(0.35))
    pixels = photo.load()
    for y in range(photo.height):
        for x in range(photo.width):
            shade = int(20 * x / photo.width + 10 * y / photo.height) + rng.randrange(-2, 3)
            pixels[x, y] = tuple(max(0, value - shade) for value in pixels[x, y])
    photo.save(FIXTURES / "synthetic-photo-like.jpg", quality=90)
    write_image_pdf(FIXTURES / "synthetic-photo-like.pdf", [photo])
    # A real digital heading and a body which exists only as raster pixels.
    image_data = base64.b64encode((FIXTURES / 'chinese-page-1.png').read_bytes()).decode()
    page.set_content(style + f'<section class="sheet" style="padding:25px 46px">中文练习<img src="data:image/png;base64,{image_data}" style="width:508px;height:677px;display:block"></section>')
    page.evaluate("document.fonts.ready")
    page.pdf(path=str(FIXTURES / "mixed-chinese.pdf"), print_background=True, prefer_css_page_size=True)
    protected = PdfWriter()
    for item in PdfReader(FIXTURES / "digital-chinese.pdf").pages:
        protected.add_page(item)
    protected.encrypt('fixture-password')
    with (FIXTURES / "password-protected.pdf").open('wb') as output:
        protected.write(output)
    empty = PdfWriter()
    empty.add_blank_page(width=600, height=800)
    with (FIXTURES / "blank.pdf").open('wb') as output:
        empty.write(output)
    (FIXTURES / "corrupt.pdf").write_bytes(b'%PDF-1.7\nThis is deliberately corrupt original fixture content.\n%%EOF')
    manifest = {
        "provenance": "Original synthetic Chinese fixture pages generated by this runner with the app's licensed embedded Noto font. Photo-like input is a synthetic incline, blur, shadow and JPEG conversion, not a physical photograph.",
        "expectedPages": TEXTS,
        "files": {item.name: {"sha256": digest(item), "bytes": item.stat().st_size} for item in FIXTURES.iterdir() if item.suffix in {'.pdf', '.png', '.jpg'}}
    }
    (FIXTURES / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    page.close()


@contextmanager
def serve_html(html_path):
    data = html_path.read_bytes()
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split('?')[0] not in {'/', '/index.html'}:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def log_message(self, *_):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/index.html'
    finally:
        server.shutdown()
        server.server_close()


def wait_idle(page, timeout=180_000):
    page.wait_for_function("""() => {
      const button = document.querySelector('#dictationOcrExtract');
      const status = document.querySelector('#dictationOcrProgressLabel')?.textContent || '';
      const message = document.querySelector('#dictationMessage')?.textContent || '';
      return /Texto extraído|Sin texto|No se ha|No se pudo/.test(status) || (button && !button.disabled && message.trim().length > 0) ||
        (document.querySelector('#dictationConfirmOcr') && document.querySelector('#dictationText')?.value.length > 0 && button && !button.disabled);
    }""", timeout=timeout)


def han_only(text):
    return ''.join(character for character in text if '\u3400' <= character <= '\u9fff')


def distance(left, right):
    previous = list(range(len(right) + 1))
    for index, character in enumerate(left, 1):
        current = [index]
        for other, target in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[other] + 1, previous[other - 1] + (character != target)))
        previous = current
    return previous[-1]


def expected_text(fixture, pages):
    if fixture in {'digital-chinese.pdf', 'scanned-chinese.pdf'}:
        return TEXTS[0] if pages == '1' else '\n'.join(TEXTS)
    if fixture == 'mixed-chinese.pdf':
        return '中文练习\n' + TEXTS[0]
    if fixture in {'digital-rotated.pdf', 'digital-cid-font.pdf', 'rotated-metadata.pdf', 'sideways-bitmap.pdf', 'synthetic-photo-like.pdf', 'chinese-page-1.png', 'synthetic-photo-like.jpg'}:
        return TEXTS[0]
    return None


def start_import(page, method):
    if page.locator('#dictationCreate').count():
        page.locator('#dictationCreate').click()
    else:
        page.locator('[data-dictation-tab="new"]').click()
    page.locator(f'[data-import-method="{method}"]').click()


def upload_and_extract(page, fixture, method='pdf', pages='1', expect_error=False):
    start_import(page, method)
    started = time.monotonic()
    page.locator('#dictationFile').set_input_files(str(FIXTURES / fixture))
    manual_rotation = None
    if method == 'pdf':
        page.wait_for_function("""() => !!document.querySelector('#dictationPdfPages') ||
          (!!document.querySelector('#dictationMessage')?.textContent.trim() &&
           !document.querySelector('#dictationOcrCancel')?.disabled) ||
          /protegido|contraseña|dañado|válido|abrir|corrupto/i.test(document.querySelector('#dictationMessage')?.textContent || '')""", timeout=90_000)
        if page.locator('#dictationPdfPages').count():
            page.locator('#dictationPdfPages').fill(pages)
        elif expect_error:
            return {"fixture": fixture, "fixtureSha256": digest(FIXTURES / fixture), "method": method, "error": page.locator('#dictationMessage').inner_text(), "seconds": round(time.monotonic() - started, 2)}
        else:
            raise AssertionError('PDF did not open: ' + page.locator('#dictationModule').inner_text())
        if fixture == 'sideways-bitmap.pdf' and page.locator('#dictationPdfRotate').count():
            page.locator('#dictationPdfRotate').click()
            page.wait_for_function("() => !document.querySelector('#dictationPdfRotate').disabled")
            manual_rotation = page.locator('#dictationPdfRotationStatus').inner_text()
    page.locator('#dictationOcrExtract').click()
    wait_idle(page)
    result = {
        "fixture": fixture, "fixtureSha256": digest(FIXTURES / fixture), "method": method, "pages": pages,
        "text": page.locator('#dictationText').input_value() if page.locator('#dictationText').count() else '',
        "status": page.locator('#dictationOcrProgressLabel').inner_text(),
        "message": page.locator('#dictationMessage').inner_text(),
        "seconds": round(time.monotonic() - started, 2),
        "methods": page.locator('.dictation-ocr-import').inner_text(),
        "confirmedInitially": page.locator('#dictationConfirmOcr').is_checked() if page.locator('#dictationConfirmOcr').count() else None,
        "manualRotation": manual_rotation,
    }
    if result['text']:
        assert result['confirmedInitially'] is False, 'OCR unexpectedly pre-confirmed'
    return result


def complete_review_and_dictation(page):
    # Verify the mandatory review gate, then explicitly correct OCR to known text.
    page.locator('#dictationParse').click()
    assert page.locator('#dictationConfirmOcr').count(), 'Unconfirmed OCR bypassed review'
    assert not page.locator('#dictationPreviewList').count(), 'Unconfirmed OCR advanced'
    reviewed = '今天我们一起学习中文。\n我喜欢喝茶。\n这本书很有意思。'
    page.locator('#dictationText').fill(reviewed)
    page.locator('#dictationConfirmOcr').check()
    page.locator('#dictationText').fill(reviewed + '\n明天我们一起去学校。')
    assert not page.locator('#dictationConfirmOcr').is_checked(), 'Editing did not reset review consent'
    page.locator('#dictationText').fill(reviewed)
    page.locator('#dictationConfirmOcr').check()
    page.locator('#dictationParse').click()
    page.locator('#dictationPreviewList').wait_for()
    sentences = page.locator('#dictationPreviewList textarea').evaluate_all('(items) => items.map(item => item.value)')
    assert len(sentences) == 3, sentences
    page.locator('#dictationBegin').click()
    page.locator('#dictationAnswer').wait_for()
    live_dom = page.locator('#dictationModule').inner_text()
    assert all(sentence not in live_dom for sentence in sentences), 'Original sentence exposed during dictation'
    audio = {"available": not page.locator('#dictationListen').is_disabled(), "status": page.locator('#dictationAudioStatus').inner_text()}
    for index, sentence in enumerate(sentences):
        page.locator('#dictationAnswer').fill(sentence if index != 1 else '我喜欢喝水。')
        if index < len(sentences) - 1:
            page.locator('#dictationAnswer').press('Control+Enter')
    page.locator('#dictationCheckAll').click()
    page.locator('#dictationAccuracy').wait_for()
    metrics = page.locator('.dictation-metric-list').inner_text()
    exactness = page.locator('#dictationAccuracy').inner_text()
    page.locator('#dictationReviewErrors').click()
    page.locator('#dictationAnswer').wait_for()
    assert page.locator('#dictationPosition').inner_text().strip() == '1 / 1', 'Review did not select only incorrect sentence'
    page.locator('#dictationAnswer').fill(sentences[1])
    page.locator('#dictationCheckAll').click()
    page.locator('#dictationAccuracy').wait_for()
    assert page.locator('#dictationAccuracy strong').inner_text() == '100,0 %'
    return {"reviewGateAndReset": True, "segmentedSentences": sentences, "sourceHiddenInPractice": True,
            "audio": audio, "firstExactness": exactness, "firstMetrics": metrics,
            "failedOnlyReview": '1 / 1', "reviewExactness": page.locator('#dictationAccuracy').inner_text()}


def additional_ui_checks(page, url, report_dir, mode):
    page.goto(url, wait_until='domcontentloaded')
    page.locator('[data-view="dictation"]').click()
    start_import(page, 'pdf')
    page.locator('#dictationFile').set_input_files(str(FIXTURES / 'digital-chinese.pdf'))
    page.locator('#dictationPdfPages').wait_for()
    if not page.locator('#dictationPdfPreviewPage').count():
        return {"available": False, "reason": "Baseline has no PDF page preview controls"}
    page.locator('#dictationPdfPages').fill('3')
    assert page.locator('#dictationPdfPages').get_attribute('aria-invalid') == 'true'
    invalid_hint = page.locator('#dictationPdfPageSelection').inner_text()
    if not page.locator('#dictationOcrExtract').is_disabled():
        page.locator('#dictationOcrExtract').click()
        assert page.locator('#dictationPdfPages').evaluate('(node) => document.activeElement === node')
        assert not page.locator('#dictationText').count(), 'Invalid page range started extraction'
    page.locator('#dictationPdfPages').fill('1-2')
    page.locator('#dictationPdfPreviewPage').select_option('2')
    page.wait_for_function("() => document.querySelector('#dictationSourceImage')?.alt === 'Página 2 del PDF seleccionado'")
    page.locator('#dictationPdfUsePreview').click()
    wait_idle(page)
    second_page = page.locator('#dictationText').input_value()
    assert han_only(second_page) == han_only(TEXTS[1]), second_page
    assert '今天' not in second_page, 'Page 1 leaked into selected page 2'
    if page.locator('.dictation-ocr-setup').count():
        page.locator('.dictation-ocr-setup > summary').click()
    # Trigger a real asynchronous import and cancel synchronously before it
    # resolves, so this covers the startup race rather than relying on timing.
    payload = base64.b64encode((FIXTURES / 'scanned-chinese.pdf').read_bytes()).decode()
    page.evaluate("""(encoded) => {
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'scanned-chinese.pdf', {type:'application/pdf'}));
      const field=document.querySelector('#dictationFile');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#dictationOcrCancel').click();
    }""", payload)
    page.wait_for_function("() => !document.querySelector('#dictationOcrExtract').disabled")
    retry_label = page.locator('#dictationOcrExtract').inner_text()
    assert 'Reintentar' in retry_label, retry_label
    page.locator('#dictationOcrExtract').click()
    page.locator('#dictationPdfPages').wait_for()
    page.locator('#dictationPdfPages').fill('1')
    page.evaluate("document.querySelector('#dictationOcrExtract').click();document.querySelector('#dictationOcrCancel').click()")
    page.wait_for_function("() => !document.querySelector('#dictationOcrExtract').disabled")
    canceled_status = page.locator('#dictationOcrProgressLabel').inner_text()
    assert 'cancelada' in canceled_status.lower(), canceled_status
    page.locator('#dictationOcrExtract').click()
    wait_idle(page)
    retried_text = page.locator('#dictationText').input_value()
    assert han_only(retried_text) == han_only(TEXTS[0]), retried_text
    if page.locator('.dictation-ocr-setup').count():
        page.locator('.dictation-ocr-setup > summary').click()
    # Switching input source must leave the new source usable after workers stop.
    page.evaluate("document.querySelector('#dictationOcrExtract').click();document.querySelector('[data-import-method=image]').click()")
    page.wait_for_function("() => !document.querySelector('#dictationPdfPages')")
    page.locator('#dictationFile').set_input_files(str(FIXTURES / 'chinese-page-1.png'))
    page.locator('#dictationOcrExtract').click()
    wait_idle(page)
    image_text = page.locator('#dictationText').input_value()
    assert han_only(image_text) == han_only(TEXTS[0]), image_text
    # A small viewport uses the actual page and engine, not a layout surrogate.
    page.set_viewport_size({"width": 390, "height": 844})
    page.locator('[data-dictation-tab="new"]').click()
    page.screenshot(path=str(report_dir / f'{mode}-mobile-review.png'), full_page=True)
    mobile = page.evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth})")
    assert mobile['document'] <= mobile['viewport'], mobile
    return {"available": True, "invalidPageRejected": invalid_hint,
            "page2Only": second_page, "page2PreviewLabel": 'Página 2 del PDF seleccionado',
            "inspectionCancelRetry": retry_label, "ocrCancelStatus": canceled_status,
            "ocrRetryText": retried_text, "switchSourceText": image_text, "mobile": mobile}


def run_mode(browser, url, mode, selected, report_dir, full_flow=True):
    context = browser.new_context(viewport={"width": 1365, "height": 900}, accept_downloads=True)
    page = context.new_page()
    events = {"consoleErrors": [], "pageErrors": [], "requestFailed": [], "requests": [], "blockedExternalRequests": []}
    origin = urlparse(url)
    def local_only(route):
        target = urlparse(route.request.url)
        if target.scheme in {'http', 'https'} and target.netloc != origin.netloc:
            events['blockedExternalRequests'].append(route.request.url)
            route.abort()
        else:
            route.continue_()
    context.route('**/*', local_only)
    page.on('console', lambda msg: events['consoleErrors'].append(msg.text) if msg.type == 'error' else None)
    page.on('pageerror', lambda error: events['pageErrors'].append(str(error)))
    page.on('requestfailed', lambda request: events['requestFailed'].append({"url": request.url[:250], "failure": request.failure}))
    page.on('request', lambda request: events['requests'].append(request.url[:250]))
    result = {"mode": mode, "url": url, "cases": [], "events": events}
    try:
        page.goto(url, wait_until='domcontentloaded', timeout=60_000)
        page.locator('[data-view="dictation"]').click()
        page.locator('#dictationCreate').wait_for(timeout=30_000)
        result['context'] = page.evaluate("({protocol:location.protocol,isSecureContext,wasm:typeof WebAssembly,worker:typeof Worker,voices:speechSynthesis.getVoices().map(v=>({lang:v.lang,local:v.localService}))})")
        for fixture, method, pages, expect_error in selected:
            try:
                case = upload_and_extract(page, fixture, method, pages, expect_error)
                wanted = expected_text(fixture, pages)
                if wanted:
                    case['expectedHan'] = han_only(wanted)
                    case['actualHan'] = han_only(case.get('text', ''))
                    case['hanExact'] = case['expectedHan'] == case['actualHan']
                    case['hanEditDistance'] = distance(case['expectedHan'], case['actualHan'])
                    case['hanCharacterErrorRate'] = round(case['hanEditDistance'] / len(case['expectedHan']), 4)
                result['cases'].append(case)
                page.screenshot(path=str(report_dir / f'{mode}-{Path(fixture).stem}.png'), full_page=True)
                if full_flow and case.get('text') and 'flow' not in result:
                    result['flow'] = complete_review_and_dictation(page)
                    page.locator('#dictationResultsBack').click()
            except Exception as exc:
                result['cases'].append({"fixture": fixture, "failure": str(exc), "traceback": traceback.format_exc()})
                page.screenshot(path=str(report_dir / f'{mode}-{Path(fixture).stem}-failure.png'), full_page=True)
                # Keep separate fixture failures isolated without mocking state.
                page.reload(wait_until='domcontentloaded')
                page.locator('[data-view="dictation"]').click()
        try:
            result['additionalUI'] = additional_ui_checks(page, url, report_dir, mode)
        except Exception as exc:
            result['additionalUI'] = {"failure": str(exc), "traceback": traceback.format_exc()}
            page.screenshot(path=str(report_dir / f'{mode}-extra-ui-failure.png'), full_page=True)
        result['bodyScrollWidth'] = page.evaluate('document.documentElement.scrollWidth')
    except Exception as exc:
        result['failure'] = str(exc)
        result['traceback'] = traceback.format_exc()
        if mode == 'file' and 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(exc):
            result['skipped'] = True
            result['skipReason'] = 'Managed browser policy blocks file:// before the application runs. Local-file execution is not verified.'
    finally:
        context.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path)
    parser.add_argument('--label', default='browser')
    parser.add_argument('--generate-fixtures', action='store_true')
    parser.add_argument('--mode', choices=['file', 'http', 'both'], default='both')
    parser.add_argument('--quick', action='store_true', help='Only digital PDF, real file and HTTP contexts')
    parser.add_argument('--fixture', action='append', help='Limit fixtures by name; repeat to add')
    parser.add_argument('--strict', action='store_true', help='Exit nonzero on fixture text differences or browser/UI failures; file policy block is an explicit skip')
    args = parser.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)
    output = REPORTS / args.label
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
        if args.generate_fixtures:
            generate_fixtures(browser)
        if not args.html:
            browser.close()
            return
        html = args.html.resolve()
        selected = [
            ('digital-chinese.pdf', 'pdf', '1-2', False),
            ('digital-rotated.pdf', 'pdf', '1', False),
            ('digital-cid-font.pdf', 'pdf', '1', False),
            ('scanned-chinese.pdf', 'pdf', '1-2', False),
            ('mixed-chinese.pdf', 'pdf', '1', False),
            ('rotated-metadata.pdf', 'pdf', '1', False),
            ('sideways-bitmap.pdf', 'pdf', '1', False),
            ('synthetic-photo-like.pdf', 'pdf', '1', False),
            ('chinese-page-1.png', 'image', '1', False),
            ('synthetic-photo-like.jpg', 'image', '1', False),
            ('password-protected.pdf', 'pdf', '1', True),
            ('corrupt.pdf', 'pdf', '1', True),
            ('blank.pdf', 'pdf', '1', False),
        ]
        if args.quick:
            selected = selected[:1]
        if args.fixture:
            selected = [case for case in selected if case[0] in args.fixture]
        report = {"html": str(html), "sha256": digest(html), "bytes": html.stat().st_size,
                  "browser": browser.version, "securityBypassFlags": [], "modes": []}
        if args.mode in {'file', 'both'}:
            report['modes'].append(run_mode(browser, html.as_uri(), 'file', selected, output))
            (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        if args.mode in {'http', 'both'}:
            with serve_html(html) as url:
                report['modes'].append(run_mode(browser, url, 'http', selected, output))
        browser.close()
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    failures = []
    for mode in report['modes']:
        if mode.get('failure') and not mode.get('skipped'):
            failures.append(f"{mode['mode']}: {mode['failure']}")
        for case in mode['cases']:
            if case.get('failure') or case.get('hanExact') is False:
                failures.append(f"{mode['mode']}/{case['fixture']}: {case.get('failure') or 'expected Chinese text differs'}")
        for section in ['flow', 'additionalUI']:
            if 'failure' in mode.get(section, {}):
                failures.append(f"{mode['mode']}/{section}: {mode[section]['failure']}")
        for event_type in ['consoleErrors', 'pageErrors', 'requestFailed', 'blockedExternalRequests']:
            if mode['events'][event_type]:
                failures.append(f"{mode['mode']}/{event_type}: {len(mode['events'][event_type])} unexpected browser events")
    report['validation'] = {"strict": args.strict, "failures": failures,
                            "skippedModes": [mode['mode'] for mode in report['modes'] if mode.get('skipped')],
                            "status": 'failed' if failures else ('skipped' if all(mode.get('skipped') for mode in report['modes']) else 'passed')}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    for mode in report['modes']:
        print(json.dumps({"mode": mode['mode'], "failure": mode.get('failure'), "context": mode.get('context'),
                          "cases": [{key: case.get(key) for key in ['fixture', 'text', 'message', 'status', 'seconds', 'failure', 'hanExact']} for case in mode['cases']],
                          "flow": mode.get('flow'), "additionalUI": mode.get('additionalUI'), "events": {key: value for key, value in mode['events'].items() if key != 'requests'}}, ensure_ascii=False))
    print(json.dumps(report['validation'], ensure_ascii=False))
    if args.strict and failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
