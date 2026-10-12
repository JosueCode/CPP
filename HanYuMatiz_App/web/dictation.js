import { DICTATION_LIMITS, validateInput, validateSentences, splitSentence, mergeSentences, compareSentence, aggregateResults } from './dictationcore.js';
import { createSpeechPlayer, SPEECH_RATES } from './dictationaudio.js';
import { createDictationStore, DICTATION_STORE_LIMITS } from './dictationstore.js';
import { OCR_LIMITS, inspectPdf, extractImage, extractPdf } from './dictationocr.js';

const el = (tag, className = '', text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};
const action = (text, handler, className = 'secondary-button', id = '') => {
  const item = el('button', className, text);
  item.type = 'button';
  if (id) item.id = id;
  item.addEventListener('click', handler);
  return item;
};
const chinese = text => { const item = el('span', 'zh', text); item.lang = 'zh-Hans'; return item; };
const points = text => [...String(text)].length;
const countChinese = text => [...String(text)].filter(char => /\p{Script=Han}/u.test(char)).length;
const formatDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
};
const statusLabel = status => ({ correct: 'Correcta', incorrect: 'Con errores', unanswered: 'Sin responder' }[status] || 'Pendiente');
const safeError = error => error instanceof RangeError ? error.message : 'No se pudo completar esta acción. Tus respuestas se conservan.';

/** Own texts and writing history stay local. The only audio provider is the browser. */
export function mountDictation(container, { onExit = () => {}, announce = () => {} } = {}) {
  let disposed = false;
  let mode = 'home';
  let draft = { title: '', text: '', sentences: [] };
  let exercise = null;
  let session = null;
  let composition = false;
  let remoteConsent = false;
  let storageMessage = '';
  let voices = [];
  let audioState = { status: 'idle', hasVoices: false, supported: false, capabilities: {} };
  let player;
  let answerTimer = null;
  let live = null;
  let message = '';
  let importMethod = 'text';
  let ocr = { file: null, document: null, result: null, preview: '', pages: '1', script: 'simplified', confirmed: false, busy: false, progress: 0, message: '' };
  let ocrAbort = null;
  let previewURL = null;
  const store = createDictationStore({ onStatus: status => {
    storageMessage = status.persistent ? '' : status.message;
    const notice = container.querySelector('#dictationStorageNotice');
    if (notice) { notice.textContent = storageMessage; notice.hidden = !storageMessage; }
  } });
  let settings = { ...store.getState().preferences };
  player = createSpeechPlayer({
    onVoices: list => { voices = list; if (!disposed) updateVoiceControls(); },
    onState: state => { audioState = state; if (!disposed) updateAudioControls(); },
  });
  voices = player.listVoices();
  audioState = player.getState();

  function tell(text) {
    if (disposed) return;
    if (live) live.textContent = text;
    announce(text);
  }
  function guard(operation) {
    try { return operation(); }
    catch (error) { message = safeError(error); tell(message); const notice = container.querySelector('#dictationMessage'); if (notice) { notice.textContent = message; notice.hidden = false; } return null; }
  }
  function buildShell(title, description, { tabs = true } = {}) {
    container.replaceChildren();
    const root = el('section', 'dictation'); root.id = 'dictationModule'; root.dataset.mode = mode;
    const intro = el('header', 'page-intro dictation-intro');
    const copy = el('div'); const heading = el('h1', '', title); heading.tabIndex = -1;
    copy.append(heading, el('p', '', description)); intro.append(copy);
    const symbol = chinese('听写'); symbol.className = 'dictation-symbol zh'; intro.append(symbol);
    root.append(intro);
    if (tabs) {
      const nav = el('nav', 'dictation-tabs'); nav.setAttribute('aria-label', 'Secciones del dictado');
      for (const [value, label] of [['home', 'Mis dictados'], ['new', 'Crear dictado'], ['history', 'Mis errores']]) {
        const item = action(label, () => { if (!flushAnswer()) return; player.stop(); if (ocr.busy) cancelOcr(); mode = value; message = ''; render(); }, 'dictation-tab');
        item.dataset.dictationTab = value; item.setAttribute('aria-current', mode === value || (value === 'new' && mode === 'preview') ? 'page' : 'false');
        nav.append(item);
      }
      root.append(nav);
    }
    const warning = el('p', 'dictation-notice'); warning.id = 'dictationStorageNotice'; warning.hidden = !storageMessage; warning.textContent = storageMessage; warning.setAttribute('role', 'status');
    const notice = el('p', 'dictation-notice error'); notice.id = 'dictationMessage'; notice.hidden = !message; notice.textContent = message; notice.setAttribute('role', 'alert');
    live = el('div', 'sr-only'); live.id = 'dictationAnnouncer'; live.setAttribute('aria-live', 'polite');
    root.append(warning, notice, live); container.append(root); return root;
  }
  function render() {
    if (disposed) return;
    ({ home: renderHome, new: renderImport, preview: renderPreview, practice: renderPractice, results: renderResults, history: renderHistory })[mode]();
  }
  function privacyNote(root) {
    const text = el('p', 'dictation-privacy', 'Tus textos y respuestas se guardan en este navegador; no se publican ni se sincronizan. La voz depende de tu dispositivo. Para una voz remota o de origen desconocido se requiere tu permiso.');
    root.append(text);
  }
  function releaseDocument() {
    ocr.document?.dispose?.();
    ocr.document = null;
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null;
  }
  function cancelOcr() {
    if (ocrAbort) ocrAbort.abort();
    ocrAbort = null;
    if (ocr.busy) { ocr.busy = false; ocr.message = 'Procesamiento cancelado. Puedes elegir otro archivo.'; updateOcrProgress(); }
  }
  function updateOcrProgress(value = null) {
    if (value) {
      ocr.progress = Math.max(0, Math.min(1, Number(value.progress) || 0));
      ocr.message = value.message || value.status || 'Procesando el documento…';
    }
    const label = container.querySelector('#dictationOcrProgressLabel'); if (label) label.textContent = ocr.message;
    const progress = container.querySelector('#dictationOcrProgress'); if (progress) { progress.value = ocr.progress; progress.hidden = !ocr.busy; }
    const cancel = container.querySelector('#dictationOcrCancel'); if (cancel) cancel.hidden = !ocr.busy;
    const extract = container.querySelector('#dictationOcrExtract'); if (extract) extract.disabled = ocr.busy || !ocr.file || (importMethod === 'pdf' && !ocr.document);
    const script = container.querySelector('#dictationOcrScript'); if (script) script.disabled = ocr.busy;
    const pages = container.querySelector('#dictationPdfPages'); if (pages) pages.disabled = ocr.busy;
  }
  async function selectFile(file) {
    if (!file) return;
    cancelOcr(); releaseDocument();
    ocr = { ...ocr, file: null, document: null, result: null, preview: '', confirmed: false, busy: false, progress: 0, message: '' };
    if (file.size > OCR_LIMITS.maxFileBytes) { message = `El archivo supera el límite de ${Math.round(OCR_LIMITS.maxFileBytes / 1024 / 1024)} MB.`; renderImport(); return; }
    const image = /\.(?:png|jpe?g|webp)$/i.test(file.name) || ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
    const pdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (importMethod === 'image' ? !image : !pdf) { message = importMethod === 'image' ? 'Elige una imagen PNG, JPG, JPEG o WebP.' : 'Elige un documento PDF.'; renderImport(); return; }
    ocr.file = file; message = '';
    if (importMethod === 'image') { previewURL = URL.createObjectURL(file); ocr.preview = previewURL; renderImport(); return; }
    ocr.busy = true; ocr.message = 'Abriendo el PDF…'; ocrAbort = new AbortController(); const controller = ocrAbort; renderImport();
    try {
      const document = await inspectPdf(file, { signal: controller.signal, onProgress: value => { if (!controller.signal.aborted && !disposed) updateOcrProgress(value); } });
      if (controller.signal.aborted || disposed) { document.dispose?.(); return; }
      ocr.document = document; ocr.preview = document.preview || ''; ocr.pages = '1'; ocr.busy = false; ocr.message = `${document.pageCount} páginas. Elige cuáles quieres usar.`; ocrAbort = null; renderImport(); tell(ocr.message);
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      ocr.busy = false; ocrAbort = null; message = typeof error?.message === 'string' ? error.message : 'No se pudo abrir el PDF. Prueba otro documento.'; renderImport(); tell(message);
    }
  }
  function selectedPages() {
    const count = ocr.document?.pageCount || 0;
    const values = new Set();
    if (!ocr.pages.trim()) throw new RangeError('Indica al menos una página del PDF.');
    for (const raw of ocr.pages.split(',')) {
      const part = raw.trim();
      const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) {
        const first = Number(range[1]); const last = Number(range[2]);
        if (first < 1 || last < first || last > count) throw new RangeError(`Usa páginas entre 1 y ${count}, en orden creciente.`);
        if (last - first + 1 > OCR_LIMITS.maxSelectedPages) throw new RangeError(`Selecciona hasta ${OCR_LIMITS.maxSelectedPages} páginas por extracción.`);
        for (let number = first; number <= last; number++) values.add(number);
      } else if (/^\d+$/.test(part)) {
        const number = Number(part); if (number < 1 || number > count) throw new RangeError(`Usa páginas entre 1 y ${count}.`); values.add(number);
      } else throw new RangeError('Escribe las páginas como «1-3, 5».');
    }
    if (values.size > OCR_LIMITS.maxSelectedPages) throw new RangeError(`Selecciona hasta ${OCR_LIMITS.maxSelectedPages} páginas por extracción.`);
    return [...values].sort((a, b) => a - b);
  }
  async function runOcr() {
    if (ocr.busy || !ocr.file) return;
    let pages;
    if (importMethod === 'pdf') { pages = guard(selectedPages); if (!pages) return; }
    message = ''; ocr.busy = true; ocr.confirmed = false; ocr.progress = 0; ocr.message = 'Preparando la extracción local…';
    ocrAbort = new AbortController(); const controller = ocrAbort; renderImport();
    const options = { script: ocr.script, signal: controller.signal, onProgress: value => { if (!controller.signal.aborted && !disposed) updateOcrProgress(value); } };
    try {
      const result = importMethod === 'pdf' ? await extractPdf(ocr.document, { ...options, pages }) : await extractImage(ocr.file, options);
      if (controller.signal.aborted || disposed) return;
      ocr.result = result; ocr.busy = false; ocr.progress = 1; ocr.message = 'Texto extraído. Revisa los caracteres antes de continuar.'; ocr.preview = result.preview || ocr.preview; ocrAbort = null;
      draft.text = result.text || ''; draft.sentences = [];
      renderImport(); container.querySelector('#dictationText')?.focus(); tell('Extracción terminada. Revisa y confirma el texto.');
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      ocr.busy = false; ocrAbort = null; message = typeof error?.message === 'string' ? error.message : 'No se pudo extraer el texto. Prueba una imagen más nítida o un PDF diferente.'; renderImport(); tell(message);
    }
  }
  function renderOcrImport(root) {
    const section = el('section', 'dictation-ocr-import'); section.id = 'dictationOcrImport';
    const label = el('label', 'dictation-label', importMethod === 'pdf' ? 'Documento PDF' : 'Imagen con texto chino'); label.htmlFor = 'dictationFile';
    const file = el('input', 'dictation-file'); file.id = 'dictationFile'; file.type = 'file'; file.accept = importMethod === 'pdf' ? 'application/pdf,.pdf' : 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
    file.addEventListener('change', () => selectFile(file.files?.[0])); section.append(label, file);
    if (importMethod === 'image') {
      const camera = el('input', 'sr-only'); camera.id = 'dictationCamera'; camera.type = 'file'; camera.accept = 'image/png,image/jpeg,image/webp'; camera.setAttribute('capture', 'environment'); camera.tabIndex = -1;
      camera.addEventListener('change', () => selectFile(camera.files?.[0])); section.append(camera, action('Usar la cámara', () => camera.click(), 'text-button dictation-camera', 'dictationOpenCamera'));
    }
    if (ocr.file) section.append(el('p', 'dictation-file-name', `${ocr.file.name} · ${(ocr.file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB`));
    section.append(el('p', 'dictation-hint', `Los documentos se procesan en este navegador y no se suben. Límite: ${Math.round(OCR_LIMITS.maxFileBytes / 1024 / 1024)} MB${importMethod === 'pdf' ? `, ${OCR_LIMITS.maxPdfPages} páginas por PDF y ${OCR_LIMITS.maxSelectedPages} por extracción` : ''}. La primera extracción puede tardar mientras se prepara el motor de reconocimiento.`));
    const options = el('div', 'dictation-ocr-options');
    const scriptField = el('div'); const scriptLabel = el('label', 'dictation-label', 'Texto del documento'); scriptLabel.htmlFor = 'dictationOcrScript';
    const script = el('select', 'dictation-input'); script.id = 'dictationOcrScript';
    for (const [value, text] of [['simplified', '简体中文 · Chino simplificado'], ['traditional', '繁體中文 · Chino tradicional']]) { const option = el('option', '', text); option.value = value; script.append(option); }
    script.value = ocr.script; script.addEventListener('change', () => { ocr.script = script.value; }); scriptField.append(scriptLabel, script); options.append(scriptField);
    if (importMethod === 'pdf' && ocr.document) {
      const pagesField = el('div'); const pagesLabel = el('label', 'dictation-label', `Páginas de 1 a ${ocr.document.pageCount}`); pagesLabel.htmlFor = 'dictationPdfPages';
      const pages = el('input', 'dictation-input'); pages.id = 'dictationPdfPages'; pages.type = 'text'; pages.value = ocr.pages; pages.placeholder = 'Por ejemplo: 1-3, 5'; pages.setAttribute('inputmode', 'text'); pages.addEventListener('input', () => { ocr.pages = pages.value; });
      pagesField.append(pagesLabel, pages, el('p', 'dictation-hint', 'Se extraen en el orden del documento.')); options.append(pagesField);
    }
    section.append(options);
    const controls = el('div', 'dictation-ocr-actions');
    const extract = action(ocr.result ? 'Extraer de nuevo' : 'Extraer texto', runOcr, 'primary-button', 'dictationOcrExtract'); controls.append(extract);
    const cancel = action('Cancelar extracción', cancelOcr, 'secondary-button', 'dictationOcrCancel'); controls.append(cancel); section.append(controls);
    const progress = el('progress', 'dictation-ocr-progress'); progress.id = 'dictationOcrProgress'; progress.max = 1; progress.value = ocr.progress; progress.setAttribute('aria-label', 'Progreso de extracción'); section.append(progress);
    const status = el('p', 'dictation-hint'); status.id = 'dictationOcrProgressLabel'; status.setAttribute('role', 'status'); status.textContent = ocr.message; section.append(status);
    if (ocr.preview) {
      const preview = el('details', 'dictation-source-preview'); preview.open = !ocr.result;
      preview.append(el('summary', '', importMethod === 'pdf' ? 'Ver página de referencia' : 'Ver imagen de referencia'));
      const image = el('img', 'dictation-ocr-preview'); image.src = ocr.preview; image.alt = importMethod === 'pdf' ? 'Vista previa de una página del PDF seleccionado' : 'Imagen seleccionada para extraer el texto'; image.loading = 'lazy'; preview.append(image); section.append(preview);
    }
    if (ocr.result) {
      const result = ocr.result;
      section.append(el('p', 'dictation-ocr-review-note', 'El reconocimiento puede cambiar u omitir caracteres. Corrige el texto, elimina encabezados o números de página y conserva solo lo que quieras practicar. No se usará hasta que lo confirmes.'));
      if (Array.isArray(result.pages) && importMethod === 'pdf') {
        const methods = result.pages.map(page => `Pág. ${page.number}: ${{ digital: 'texto seleccionable', ocr: 'reconocimiento de imagen', mixed: 'texto e imagen' }[page.method] || 'texto extraído'}`).join(' · ');
        section.append(el('p', 'dictation-hint', methods));
      }
      const warnings = [...(result.warnings || []), ...(result.pages || []).flatMap(page => page.warnings || [])];
      if (warnings.length) { const list = el('ul', 'dictation-ocr-warnings'); for (const warning of [...new Set(warnings)]) list.append(el('li', '', String(warning))); section.append(list); }
      const fragments = (result.pages || []).flatMap(page => page.lowConfidence || []);
      if (fragments.length) {
        const confidence = el('details', 'dictation-low-confidence'); confidence.append(el('summary', '', 'Fragmentos que conviene revisar con atención'));
        const list = el('ul');
        for (const fragment of fragments.slice(0, 20)) { const text = typeof fragment === 'string' ? fragment : fragment.text || ''; const item = el('li'); item.append(chinese(text)); if (typeof fragment.confidence === 'number') item.append(el('span', '', ` · Confianza del motor: ${Math.round(fragment.confidence)} %`)); list.append(item); }
        confidence.append(list, el('p', 'dictation-hint', 'La confianza del motor no garantiza que un carácter sea correcto. Revisa también el resto del texto.')); section.append(confidence);
      }
    }
    root.append(section); updateOcrProgress();
  }
  function renderHome() {
    const root = buildShell('听写 · Dictado', 'Escucha una frase, escríbela y descubre exactamente qué caracteres necesitas practicar.');
    const invitation = el('section', 'dictation-start');
    invitation.append(el('h2', '', 'Un texto tuyo, frase a frase.'), el('p', '', 'Pega un texto en chino. Podrás revisar las frases antes de escucharlas y escribirlas sin ver la respuesta.'));
    invitation.append(action('Crear un dictado', () => { mode = 'new'; render(); container.querySelector('#dictationText')?.focus(); }, 'primary-button', 'dictationCreate'));
    root.append(invitation);
    const data = store.getState();
    if (!data.exercises.length) {
      const empty = el('p', 'dictation-empty', 'Aquí aparecerán tus dictados guardados. Puedes cerrar la página y continuar después en este mismo navegador.'); root.append(empty);
    } else {
      const list = el('section', 'dictation-library'); list.setAttribute('aria-label', 'Dictados guardados');
      list.append(el('h2', '', 'Tus dictados'));
      for (const saved of [...data.exercises].reverse()) {
        const row = el('article', 'dictation-library-row'); row.dataset.exerciseId = saved.id;
        const copy = el('div', 'dictation-library-copy');
        copy.append(el('h3', '', saved.title || 'Dictado guardado'), el('p', '', `${saved.sentences.length} frases · ${countChinese(saved.text)} caracteres chinos · ${formatDate(saved.updatedAt)}`));
        const sessions = data.sessions.filter(item => item.exerciseId === saved.id);
        const pending = [...sessions].reverse().find(item => item.status === 'pending');
        const previous = [...sessions].reverse().find(item => item.status === 'completed');
        const controls = el('div', 'dictation-row-actions');
        if (pending) {
          controls.append(action(`Continuar · ${pending.currentIndex + 1} de ${pending.indices.length}`, () => openSession(saved, pending), 'primary-button dictation-resume'));
        } else {
          controls.append(action('Practicar', () => startSaved(saved), 'primary-button dictation-start-saved'));
        }
        if (previous) controls.append(action('Ver último resultado', () => { exercise = saved; session = previous; settings = { ...previous.settings, rate: data.preferences.rate, voiceURI: data.preferences.voiceURI }; mode = 'results'; render(); }, 'text-button dictation-view-result'));
        controls.append(action('Eliminar', () => {
          if (!window.confirm('¿Eliminar este dictado, sus sesiones y sus registros de errores? Los demás dictados se conservan.')) return;
          guard(() => store.deleteExercise(saved.id)); render();
        }, 'text-button dictation-delete'));
        row.append(copy, controls); list.append(row);
      }
      root.append(list);
    }
    const tools = el('details', 'dictation-data-tools');
    tools.append(el('summary', '', 'Datos guardados en este navegador'));
    tools.append(el('p', '', 'Puedes borrar todos los dictados, sesiones, resultados, errores y preferencias. Esta acción no se puede deshacer.'));
    tools.append(action('Borrar todos los datos de Dictado', () => {
      if (!window.confirm('¿Borrar todos los datos de Dictado en este navegador? No se puede deshacer.')) return;
      guard(() => store.clearAll()); exercise = null; session = null; draft = { title: '', text: '', sentences: [] }; settings = { ...store.getState().preferences }; remoteConsent = false; render(); tell('Se borraron los datos de Dictado.');
    }, 'text-button dictation-clear-all', 'dictationClearAll'));
    root.append(tools); privacyNote(root);
  }
  function renderImport() {
    const root = buildShell('Crea tu dictado', 'Empieza con un texto en chino que quieras aprender a escuchar y escribir.');
    const methods = el('div', 'dictation-import-methods'); methods.setAttribute('role', 'group'); methods.setAttribute('aria-label', 'Cómo introducir el texto');
    for (const [value, label] of [['text', 'Pegar texto'], ['image', 'Subir imagen'], ['pdf', 'Subir PDF']]) {
      const choice = action(label, () => {
        if (importMethod !== value) { cancelOcr(); releaseDocument(); ocr = { ...ocr, file: null, document: null, result: null, preview: '', confirmed: false, progress: 0, message: '' }; }
        importMethod = value; message = ''; renderImport();
      }, 'dictation-method'); choice.dataset.importMethod = value; choice.setAttribute('aria-pressed', String(importMethod === value)); methods.append(choice);
    }
    root.append(methods);
    if (importMethod !== 'text') renderOcrImport(root);
    if (importMethod !== 'text' && !ocr.result) { privacyNote(root); return; }
    const form = el('form', 'dictation-import');
    const nameLabel = el('label', 'dictation-label', 'Nombre del dictado (opcional)'); nameLabel.htmlFor = 'dictationTitle';
    const name = el('input', 'dictation-input'); name.id = 'dictationTitle'; name.type = 'text'; name.maxLength = 80; name.value = draft.title; name.placeholder = 'Por ejemplo: Mi rutina de mañana';
    name.addEventListener('input', () => { draft.title = name.value; });
    const label = el('label', 'dictation-label', importMethod === 'text' ? 'Texto en chino' : 'Revisa y corrige el texto extraído'); label.htmlFor = 'dictationText';
    const input = el('textarea', 'dictation-text zh'); input.id = 'dictationText'; input.lang = 'zh-Hans'; input.value = draft.text; input.rows = 7; input.spellcheck = false; input.setAttribute('aria-describedby', 'dictationInputHint dictationInputCount');
    input.placeholder = 'Pega aquí tu propio texto en chino…';
    const hint = el('p', 'dictation-hint', `Hasta ${DICTATION_LIMITS.maxCharacters.toLocaleString('es')} caracteres de texto, ${DICTATION_LIMITS.maxSentences} frases y ${DICTATION_LIMITS.maxSentenceCharacters} caracteres por frase.`); hint.id = 'dictationInputHint';
    const counter = el('p', 'dictation-count'); counter.id = 'dictationInputCount';
    const updateCount = () => { draft.text = input.value; counter.textContent = `${points(input.value).toLocaleString('es')} caracteres de texto · ${countChinese(input.value).toLocaleString('es')} chinos`; };
    input.addEventListener('input', () => { updateCount(); if (importMethod !== 'text') { ocr.confirmed = false; const confirmation = container.querySelector('#dictationConfirmOcr'); if (confirmation) confirmation.checked = false; } }); updateCount();
    const submit = action(importMethod === 'text' ? 'Revisar frases' : '开始听写 · Comenzar dictado', () => form.requestSubmit(), 'primary-button', 'dictationParse');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (ocr.busy) { message = 'Espera a que termine la extracción o cancélala antes de continuar.'; renderImport(); tell(message); return; }
      if (importMethod !== 'text' && !ocr.confirmed) { message = 'Revisa el texto extraído y confirma que es la versión que quieres practicar.'; renderImport(); container.querySelector('#dictationConfirmOcr')?.focus(); tell(message); return; }
      const parsed = validateInput(input.value);
      if (!parsed.ok) { message = parsed.errors.join(' '); renderImport(); container.querySelector('#dictationText')?.focus(); tell(message); return; }
      draft = { title: name.value.trim(), text: input.value, sentences: [...parsed.sentences] };
      message = ''; mode = 'preview'; render(); tell(`${draft.sentences.length} frases identificadas. Revisa el texto antes de empezar.`);
    });
    form.append(nameLabel, name, label, input, counter, hint);
    if (importMethod !== 'text') {
      const confirmation = el('label', 'dictation-checkbox dictation-ocr-confirm');
      const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.id = 'dictationConfirmOcr'; checkbox.checked = ocr.confirmed;
      checkbox.addEventListener('change', () => { ocr.confirmed = checkbox.checked; });
      confirmation.append(checkbox, el('span', '', 'He revisado y corregido el texto. Quiero usar esta versión para mi dictado.')); form.append(confirmation);
    }
    form.append(submit);
    if (importMethod !== 'text' && ocr.result && ocr.preview) {
      const review = el('div', 'dictation-ocr-review-grid');
      const reference = root.querySelector('.dictation-source-preview');
      if (reference) { reference.open = window.matchMedia('(min-width: 1000px)').matches; review.append(reference); }
      review.append(form); root.append(review);
    } else root.append(form);
    privacyNote(root);
  }
  function validateDraft() {
    const validation = validateSentences(draft.sentences);
    if (!validation.ok) throw new RangeError(validation.errors.join(' '));
    if (points(validation.sentences.join('\n')) > DICTATION_LIMITS.maxCharacters) throw new RangeError(`El texto, incluidos los saltos entre frases, supera ${DICTATION_LIMITS.maxCharacters.toLocaleString('es')} caracteres.`);
    draft.sentences = validation.sentences;
    return true;
  }
  function renderPreview() {
    const root = buildShell('Antes de escuchar', 'Revisa dónde empieza y termina cada frase. Después, el texto original quedará oculto.');
    const overview = el('div', 'dictation-preview-head');
    const counts = el('p', 'dictation-count'); counts.id = 'dictationSentenceCount';
    const updateCounts = () => { counts.textContent = `${draft.sentences.length} frases · ${countChinese(draft.sentences.join('')).toLocaleString('es')} caracteres chinos`; };
    updateCounts();
    overview.append(counts, action('Volver al texto', () => { draft.text = draft.sentences.join('\n'); mode = 'new'; message = ''; render(); }, 'text-button', 'dictationEditText'));
    root.append(overview);
    const instructions = el('p', 'dictation-hint', 'Para dividir una frase, coloca el cursor donde quieres cortarla y pulsa «Dividir aquí». También puedes unirla con la siguiente. El orden se conserva.'); root.append(instructions);
    const list = el('ol', 'dictation-preview-list'); list.id = 'dictationPreviewList';
    draft.sentences.forEach((sentence, index) => {
      const row = el('li', 'dictation-preview-row'); row.dataset.sentenceIndex = String(index);
      const label = el('label', 'dictation-label', `Frase ${index + 1}`); label.htmlFor = `dictationSentence${index}`;
      const area = el('textarea', 'dictation-sentence-input zh'); area.id = `dictationSentence${index}`; area.lang = 'zh-Hans'; area.value = sentence; area.rows = 2; area.spellcheck = false; area.setAttribute('aria-label', `Editar frase ${index + 1}`);
      const count = el('span', 'dictation-small-count', `${points(sentence)} caracteres`);
      area.addEventListener('input', () => { draft.sentences[index] = area.value; count.textContent = `${points(area.value)} caracteres`; updateCounts(); });
      const controls = el('div', 'dictation-sentence-tools');
      controls.append(action('Dividir aquí', () => {
        const offset = points(area.value.slice(0, area.selectionStart));
        if (area.selectionStart !== area.selectionEnd) { message = 'Coloca el cursor en un único punto, sin seleccionar texto.'; renderPreview(); tell(message); return; }
        const result = guard(() => splitSentence(draft.sentences, index, offset));
        if (result) { draft.sentences = result; message = ''; renderPreview(); container.querySelector(`#dictationSentence${index + 1}`)?.focus(); tell('La frase se dividió en dos.'); }
      }, 'text-button dictation-split'));
      const merge = action('Unir con la siguiente', () => {
        const result = guard(() => mergeSentences(draft.sentences, index));
        if (result) { draft.sentences = result; message = ''; renderPreview(); container.querySelector(`#dictationSentence${index}`)?.focus(); tell('Se unieron las frases.'); }
      }, 'text-button dictation-merge'); merge.disabled = index === draft.sentences.length - 1; controls.append(merge);
      controls.append(action('Eliminar frase', () => { draft.sentences.splice(index, 1); renderPreview(); tell('Frase eliminada.'); }, 'text-button dictation-delete-sentence'));
      controls.append(count); row.append(label, area, controls); list.append(row);
    });
    root.append(list);
    renderSettings(root);
    const start = action('Empezar dictado', () => {
      const valid = guard(validateDraft); if (!valid) return;
      if (store.getState().sessions.length >= DICTATION_STORE_LIMITS.maxSessions) {
        guard(() => { throw new RangeError(`Ya tienes ${DICTATION_STORE_LIMITS.maxSessions} sesiones guardadas. Elimina un dictado y sus sesiones desde «Mis dictados» antes de crear otro.`); }); return;
      }
      const created = guard(() => store.createExercise({ title: draft.title || 'Dictado guardado', text: draft.sentences.join('\n'), sentences: [...draft.sentences], settings: { ...settings } }));
      if (!created) return;
      const pending = guard(() => store.startSession(created.id));
      if (!pending) { guard(() => store.deleteExercise(created.id)); return; }
      exercise = created; session = pending; mode = 'practice'; message = ''; render();
    }, 'primary-button', 'dictationBegin');
    const foot = el('div', 'dictation-preview-footer'); foot.append(start); root.append(foot); privacyNote(root); updateVoiceControls();
  }
  function renderSettings(root, { compact = false } = {}) {
    const section = el(compact ? 'details' : 'section', 'dictation-settings'); section.id = 'dictationSettings';
    section.append(el(compact ? 'summary' : 'h2', '', compact ? 'Voz y velocidad' : 'Cómo quieres practicar'));
    const controls = el('div', 'dictation-settings-fields');
    const voiceLabel = el('label', 'dictation-label', 'Voz en mandarín'); voiceLabel.htmlFor = 'dictationVoice';
    const voice = el('select', 'dictation-input'); voice.id = 'dictationVoice'; voice.addEventListener('change', () => {
      player.stop(); settings.voiceURI = voice.value; remoteConsent = false; guard(() => store.setPreferences({ voiceURI: settings.voiceURI })); updateVoiceControls();
    });
    const speedLabel = el('label', 'dictation-label', 'Velocidad'); speedLabel.htmlFor = 'dictationRate';
    const speed = el('select', 'dictation-input'); speed.id = 'dictationRate';
    for (const value of SPEECH_RATES) { const option = el('option', '', `${value}×${value === 1 ? ' · Normal' : ''}`); option.value = String(value); speed.append(option); }
    speed.value = String(settings.rate); speed.addEventListener('change', () => { player.stop(); settings.rate = Number(speed.value); guard(() => store.setPreferences({ rate: settings.rate })); });
    const voiceField = el('div'); voiceField.append(voiceLabel, voice); const rateField = el('div'); rateField.append(speedLabel, speed); controls.append(voiceField, rateField);
    const voiceStatus = el('p', 'dictation-hint'); voiceStatus.id = 'dictationVoiceStatus'; voiceStatus.setAttribute('role', 'status');
    const consent = el('label', 'dictation-checkbox dictation-remote'); consent.id = 'dictationRemoteLabel';
    const consentInput = el('input'); consentInput.type = 'checkbox'; consentInput.id = 'dictationRemoteConsent'; consentInput.checked = remoteConsent;
    consentInput.addEventListener('change', () => { remoteConsent = consentInput.checked; if (!remoteConsent) player.stop(); updateAudioControls(); });
    consent.append(consentInput, el('span', '', 'Permito que esta voz lea mis frases mediante el proveedor del navegador. Puede enviar el texto fuera del dispositivo.'));
    section.append(controls, voiceStatus, consent);
    if (!compact) {
      const options = el('div', 'dictation-study-options');
      for (const [key, text] of [['autoNext', 'Escuchar automáticamente al pasar a otra frase'], ['showNumbers', 'Mostrar numeración de las frases'], ['evaluatePunctuation', 'Evaluar también los signos de puntuación']]) {
        const label = el('label', 'dictation-checkbox'); const input = el('input'); input.type = 'checkbox'; input.id = `dictation${key[0].toUpperCase()}${key.slice(1)}`; input.checked = Boolean(settings[key]);
        input.addEventListener('change', () => { settings[key] = input.checked; guard(() => store.setPreferences({ [key]: settings[key] })); }); label.append(input, el('span', '', text)); options.append(label);
      }
      section.append(options, el('p', 'dictation-hint', 'Los espacios no cuentan. Por defecto se ignoran los signos de puntuación; sí se comparan los caracteres y las cifras del texto. El chino simplificado y el tradicional se comparan tal como están escritos.'));
    }
    root.append(section);
  }
  function selectedVoice() { return voices.find(voice => voice.voiceURI === settings.voiceURI) || null; }
  function updateVoiceControls() {
    const select = container.querySelector('#dictationVoice');
    if (!settings.voiceURI || !voices.some(voice => voice.voiceURI === settings.voiceURI)) settings.voiceURI = voices[0]?.voiceURI || '';
    if (select) {
      const previous = select.value;
      select.replaceChildren();
      if (!voices.length) { const option = el('option', '', 'No hay una voz de mandarín disponible'); option.value = ''; select.append(option); }
      else for (const voice of voices) { const option = el('option', '', voice.label || `${voice.name} · ${voice.lang}`); option.value = voice.voiceURI; select.append(option); }
      select.value = settings.voiceURI || previous; select.disabled = !voices.length;
    }
    const voice = selectedVoice();
    const notice = container.querySelector('#dictationVoiceStatus');
    if (notice) notice.textContent = !audioState.supported ? 'Este navegador no ofrece síntesis de voz. Puedes preparar y guardar el texto, o practicar su escritura sin audio.'
      : !voices.length ? 'No se encontró una voz de mandarín. Instala una voz china en tu dispositivo o usa otro navegador. Puedes continuar como práctica de escritura; no habrá audio.'
      : voice?.requiresConsent ? 'Esta voz usa un proveedor remoto o no informa si funciona en el dispositivo. Solo se reproducirá con tu permiso.'
      : 'Esta voz está identificada por el navegador como local. Su calidad y sus controles dependen del dispositivo.';
    const consent = container.querySelector('#dictationRemoteLabel'); if (consent) consent.hidden = !voice?.requiresConsent;
    const checkbox = container.querySelector('#dictationRemoteConsent'); if (checkbox) checkbox.checked = remoteConsent;
    const begin = container.querySelector('#dictationBegin'); if (begin) begin.textContent = voices.length ? 'Empezar dictado' : 'Practicar escritura sin audio';
    updateAudioControls();
  }
  function updateAudioControls() {
    const audio = container.querySelector('.dictation-player');
    if (audio) audio.dataset.audioState = audioState.status;
    const status = container.querySelector('#dictationAudioStatus');
    const voice = selectedVoice(); const available = Boolean(voice) && (!voice.requiresConsent || remoteConsent);
    if (status) status.textContent = !audioState.supported ? 'Este navegador no ofrece síntesis de voz. Puedes practicar escritura sin audio o continuar en otro navegador.'
      : !voices.length ? 'No hay una voz de mandarín disponible. Puedes practicar escritura sin audio; para escuchar, instala una voz china en el dispositivo o usa otro navegador.'
      : voice?.requiresConsent && !remoteConsent ? 'Para escuchar con esta voz, abre «Voz y velocidad» y autoriza el uso de su proveedor. El texto puede salir del dispositivo.'
      : audioState.message || 'Escucha la frase cuando quieras.';
    container.querySelectorAll('[data-dictation-listen]').forEach(item => { item.disabled = !available; });
    const pause = container.querySelector('#dictationPause');
    if (pause) { pause.textContent = audioState.isPaused ? 'Continuar audio' : 'Pausar'; pause.disabled = !(audioState.isPaused ? audioState.capabilities?.resume : audioState.isPlaying && audioState.capabilities?.pause); }
    const stop = container.querySelector('#dictationStop'); if (stop) stop.disabled = !audioState.isActive;
  }
  function playSentence(index) {
    const result = player.speak(exercise.sentences[index], { voiceURI: settings.voiceURI, rate: settings.rate, allowRemote: remoteConsent });
    if (!result.ok) tell(player.getState().message || 'No se pudo reproducir esta frase. Revisa la voz y el permiso.');
  }
  function startSaved(saved) {
    const next = guard(() => store.startSession(saved.id)); if (!next) return;
    openSession(saved, next);
  }
  function openSession(saved, pending) {
    const preferences = store.getState().preferences;
    player.stop(); exercise = saved; session = pending; settings = { ...pending.settings, rate: preferences.rate, voiceURI: preferences.voiceURI }; remoteConsent = false; mode = 'practice'; message = ''; render();
  }
  function flushAnswer() {
    clearTimeout(answerTimer); answerTimer = null;
    if (session?.status !== 'pending') return true;
    const field = container.querySelector('#dictationAnswer');
    if (field && !field.validity.valid) { field.reportValidity(); return false; }
    const updated = guard(() => store.saveSession(session.id, { answers: [...session.answers], currentIndex: session.currentIndex }));
    if (updated) { session = updated; return true; }
    const notice = container.querySelector('#dictationMessage');
    if (notice && !notice.querySelector('.dictation-discard-draft')) {
      notice.append(el('span', 'dictation-save-failure', ' Tu respuesta sigue en esta pantalla. Acórtala para guardar o descarta los últimos cambios para volver a tus dictados.'));
      notice.append(action('Descartar los últimos cambios y salir', () => {
        if (!window.confirm('No se pudieron guardar los últimos cambios. ¿Descartarlos y volver a tus dictados? Las respuestas guardadas previamente se conservan.')) return;
        session = store.getSession(session.id); player.stop(); mode = 'home'; message = ''; render();
      }, 'text-button dictation-discard-draft'));
    }
    return false;
  }
  function renderPractice() {
    const root = buildShell('Escucha y escribe', 'Escribe en chino. Puedes repetir la frase y volver a cambiar tu respuesta.', { tabs: false });
    const top = el('div', 'dictation-session-top');
    top.append(action('← Guardar y salir', () => { if (!flushAnswer()) return; player.stop(); mode = 'home'; render(); }, 'text-button', 'dictationSaveExit'));
    const current = session.currentIndex;
    const total = session.indices.length;
    const done = session.answers.filter(answer => String(answer).trim()).length;
    const count = el('span', 'dictation-session-count', `${current + 1} / ${total}`); count.id = 'dictationPosition'; count.classList.toggle('sr-only', !settings.showNumbers);
    count.setAttribute('aria-label', `Frase ${current + 1} de ${total}`); top.append(count); root.append(top);
    const progress = el('div', 'dictation-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Frases respondidas'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(total)); progress.setAttribute('aria-valuenow', String(done));
    const fill = el('span'); fill.style.width = `${done / total * 100}%`; progress.append(fill); root.append(progress);
    const stage = el('section', 'dictation-stage');
    const heading = el('h2', '', settings.showNumbers ? `Frase ${String(current + 1).padStart(2, '0')}` : 'Escucha y escribe'); heading.id = 'dictationPhraseHeading'; heading.tabIndex = -1; stage.append(heading);
    const playerUI = el('div', 'dictation-player');
    const listen = action('Escuchar frase', () => playSentence(session.indices[current]), 'primary-button', 'dictationListen'); listen.dataset.dictationListen = 'current';
    const repeat = action('↻ Repetir', () => playSentence(session.indices[current]), 'secondary-button', 'dictationRepeat'); repeat.dataset.dictationListen = 'current';
    const pause = action('Pausar', () => audioState.isPaused ? player.resume() : player.pause(), 'text-button', 'dictationPause');
    const stop = action('Detener', () => player.stop(), 'text-button', 'dictationStop');
    playerUI.append(listen, repeat, pause, stop); stage.append(playerUI);
    const status = el('p', 'dictation-audio-status'); status.id = 'dictationAudioStatus'; status.setAttribute('role', 'status'); stage.append(status);
    renderSettings(stage, { compact: true });
    const label = el('label', 'dictation-label', 'Tu respuesta en chino'); label.htmlFor = 'dictationAnswer'; stage.append(label);
    const answer = el('textarea', 'dictation-answer zh'); answer.id = 'dictationAnswer'; answer.lang = 'zh-Hans'; answer.rows = 4; answer.spellcheck = false; answer.value = session.answers[current] || ''; answer.placeholder = 'Escribe lo que escuchas…'; answer.setAttribute('aria-describedby', 'dictationAnswerHint');
    answer.addEventListener('compositionstart', () => { composition = true; }); answer.addEventListener('compositionend', () => { composition = false; updateAnswer(); });
    function updateAnswer() {
      if (points(answer.value) > DICTATION_LIMITS.maxSentenceCharacters) { answer.setCustomValidity(`La respuesta admite hasta ${DICTATION_LIMITS.maxSentenceCharacters} caracteres.`); tell(`La respuesta admite hasta ${DICTATION_LIMITS.maxSentenceCharacters} caracteres. Elimina el texto sobrante antes de continuar.`); return; }
      answer.setCustomValidity(''); session.answers[current] = answer.value;
      clearTimeout(answerTimer); answerTimer = setTimeout(flushAnswer, 250);
      const filled = session.answers.filter(value => String(value).trim()).length; progress.setAttribute('aria-valuenow', String(filled)); fill.style.width = `${filled / total * 100}%`;
    }
    answer.addEventListener('input', updateAnswer);
    answer.addEventListener('keydown', event => { if (event.isComposing || composition || event.keyCode === 229) return; if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (current < total - 1) navigate(current + 1); else complete(); } });
    stage.append(answer, el('p', 'dictation-hint', `Usa el teclado chino del dispositivo. Ctrl/⌘ + Intro: siguiente frase. Hasta ${DICTATION_LIMITS.maxSentenceCharacters} caracteres.`)); stage.lastChild.id = 'dictationAnswerHint';
    const navigation = el('div', 'dictation-navigation');
    const previous = action('← Anterior', () => navigate(current - 1), 'secondary-button', 'dictationPrevious'); previous.disabled = current === 0;
    const next = action('Siguiente →', () => navigate(current + 1), 'primary-button', 'dictationNext'); next.disabled = current === total - 1;
    navigation.append(previous, next); stage.append(navigation); root.append(stage);
    const summary = el('div', 'dictation-finish');
    summary.append(el('p', '', 'Puedes comprobar el dictado aunque haya frases sin responder. Las verás por separado en el resultado.'), action('检查答案 · Comprobar respuestas', complete, 'primary-button', 'dictationCheckAll')); root.append(summary);
    updateVoiceControls();
  }
  function navigate(index) {
    const field = container.querySelector('#dictationAnswer');
    if (composition || (field && !field.reportValidity())) return;
    if (!flushAnswer()) return;
    player.stop(); const previous = session.currentIndex; session.currentIndex = index;
    if (!flushAnswer()) { session.currentIndex = previous; return; }
    renderPractice(); container.querySelector('#dictationAnswer')?.focus();
    if (settings.autoNext) playSentence(session.indices[index]);
  }
  function complete() {
    const field = container.querySelector('#dictationAnswer');
    if (composition || (field && !field.reportValidity())) return;
    if (!flushAnswer()) return;
    player.stop();
    const comparisons = guard(() => session.indices.map((index, position) => compareSentence(exercise.sentences[index], session.answers[position] || '', { evaluatePunctuation: Boolean(session.settings?.evaluatePunctuation) })));
    if (!comparisons) return;
    const finished = guard(() => store.finishSession(session.id, comparisons, aggregateResults(comparisons))); if (!finished) return;
    session = finished; mode = 'results'; message = ''; render(); tell('Dictado corregido. Puedes revisar cada diferencia.');
  }
  function renderResults() {
    const results = session.results;
    if (!results) { mode = 'home'; render(); return; }
    const summary = results.summary;
    const root = buildShell(session.reviewOf ? 'Tu repaso, corregido' : 'Tu dictado, corregido', 'Cada diferencia muestra qué escribiste, qué se esperaba y dónde aparece.', { tabs: false });
    root.append(action('← Mis dictados', () => { player.stop(); mode = 'home'; render(); }, 'text-button', 'dictationResultsBack'));
    const metrics = el('section', 'dictation-metrics'); metrics.setAttribute('aria-label', 'Resultado del dictado');
    const accuracy = el('div', 'dictation-accuracy'); accuracy.id = 'dictationAccuracy'; accuracy.append(el('strong', '', `${Number(summary.accuracy).toFixed(1).replace('.', ',')} %`), el('span', '', 'de exactitud')); metrics.append(accuracy);
    const grid = el('dl', 'dictation-metric-list');
    for (const [label, value] of [['Frases correctas', summary.correctSentences], ['Frases con errores', summary.incorrectSentences], ['Sin responder', summary.unansweredSentences], ['Caracteres evaluados', summary.evaluatedCharacters], ['Caracteres correctos', summary.correctCharacters], ['Diferencias detectadas', summary.errorCount]]) { const group = el('div'); group.append(el('dt', '', label), el('dd', '', String(value))); grid.append(group); }
    metrics.append(grid); root.append(metrics);
    const calculation = el('details', 'dictation-calculation'); calculation.append(el('summary', '', 'Cómo se calcula la exactitud'));
    calculation.append(el('p', '', 'Caracteres correctos ÷ (caracteres del original evaluados + caracteres añadidos) × 100. Una sustitución y una omisión dejan un carácter del original sin acertar; una adición aumenta el total. Las frases en blanco cuentan como no respondidas y sus caracteres como omitidos. Los espacios se ignoran.'));
    calculation.append(el('p', '', session.settings?.evaluatePunctuation ? 'En este dictado también se evalúa la puntuación.' : 'En este dictado se ignora la puntuación.')); root.append(calculation);
    if (session.reviewOf) {
      const source = store.getSession(session.reviewOf);
      const corrected = results.comparisons.filter((result, index) => result.status === 'correct' && source?.results?.comparisons?.[source.indices.indexOf(session.indices[index])]?.status !== 'correct').length;
      root.append(el('p', 'dictation-review-improvement', `Has resuelto ${corrected} de las ${session.indices.length} frases que estabas repasando.`));
    }
    const toolbar = el('div', 'dictation-result-actions');
    const review = action('错题复习 · Repasar errores', () => {
      player.stop(); const next = guard(() => store.startReview(session.id, { includeUnanswered: true })); if (!next) return; session = next; mode = 'practice'; render();
    }, 'primary-button', 'dictationReviewErrors'); review.disabled = results.comparisons.every(result => result.status === 'correct');
    toolbar.append(review, action('Repetir todo', () => startSaved(exercise), 'secondary-button', 'dictationRepeatAll'), action('Editar mis respuestas', () => {
      player.stop(); const next = guard(() => store.startSession(exercise.id, { indices: [...session.indices] })); if (!next) return;
      const restored = guard(() => store.saveSession(next.id, { answers: [...session.answers], currentIndex: 0 })); if (!restored) return; session = restored; mode = 'practice'; render();
    }, 'text-button', 'dictationEditAnswers')); root.append(toolbar);
    renderSettings(root, { compact: true }); updateVoiceControls();
    const list = el('div', 'dictation-results-list'); list.id = 'dictationResults';
    results.comparisons.forEach((comparison, position) => {
      const originalIndex = session.indices[position];
      const row = el('article', `dictation-result ${comparison.status}`); row.dataset.resultIndex = String(position); row.dataset.originalIndex = String(originalIndex); row.dataset.resultStatus = comparison.status;
      const heading = el('div', 'dictation-result-heading');
      heading.append(el('h2', '', `Frase ${String(originalIndex + 1).padStart(2, '0')}`), el('span', 'dictation-result-state', `${comparison.status === 'correct' ? '✓' : comparison.status === 'unanswered' ? '○' : '×'} ${statusLabel(comparison.status)}`)); row.append(heading);
      const original = el('div', 'dictation-result-line'); original.append(el('strong', '', 'Original'), chinese(comparison.original)); row.append(original);
      const written = el('div', 'dictation-result-line'); written.append(el('strong', '', 'Tu respuesta'), comparison.answer ? chinese(comparison.answer) : el('span', 'dictation-unanswered', 'No escribiste una respuesta.')); row.append(written);
      if (comparison.status !== 'correct') {
        const details = el('details', 'dictation-difference'); details.open = true; details.append(el('summary', '', 'Ver las diferencias'));
        const diff = el('div', 'dictation-diff-text zh'); diff.lang = 'zh-Hans'; diff.setAttribute('aria-label', 'Comparación carácter por carácter');
        for (const operation of comparison.operations) {
          const bit = el('span', `dictation-diff-bit ${operation.kind}`);
          if (operation.kind === 'equal') bit.textContent = operation.written;
          else if (operation.kind === 'substitution') { bit.textContent = `${operation.written} → ${operation.expected}`; bit.setAttribute('aria-label', `Sustitución: escribiste ${operation.written}; se esperaba ${operation.expected}`); }
          else if (operation.kind === 'deletion') { bit.textContent = `+${operation.expected}`; bit.setAttribute('aria-label', `Falta ${operation.expected}`); }
          else { bit.textContent = `−${operation.written}`; bit.setAttribute('aria-label', `Sobra ${operation.written}`); }
          diff.append(bit);
        }
        details.append(diff);
        const differences = el('ol', 'dictation-difference-list');
        for (const difference of comparison.differences) {
          const item = el('li');
          const at = difference.originalPosition ?? difference.originalAnchorPosition;
          const positionText = at ? ` · posición ${at} del original` : '';
          if (difference.kind === 'substitution') { item.append(el('span', 'dictation-diff-label', '× Sustitución'), chinese(`${difference.written} → ${difference.expected}`), el('span', '', `Escribiste «${difference.written}». Se esperaba «${difference.expected}»${positionText}.`)); }
          else if (difference.kind === 'deletion') { item.append(el('span', 'dictation-diff-label', '+ Omisión'), chinese(difference.expected), el('span', '', `Falta «${difference.expected}»${positionText}.`)); }
          else { item.append(el('span', 'dictation-diff-label', '− Adición'), chinese(difference.written), el('span', '', `Añadiste «${difference.written}»${difference.answerPosition ? ` en la posición ${difference.answerPosition} de tu respuesta` : ''}.`)); }
          differences.append(item);
        }
        details.append(differences); row.append(details);
      } else row.append(el('p', 'dictation-correct-note', 'Todos los caracteres evaluados coinciden.'));
      const actions = el('div', 'dictation-result-row-actions');
      const listen = action('Escuchar nuevamente', () => playSentence(originalIndex), 'text-button dictation-result-listen'); listen.dataset.dictationListen = String(originalIndex); actions.append(listen);
      if (comparison.status !== 'correct') actions.append(action('Practicar esta frase', () => {
        player.stop(); const next = guard(() => store.startSession(exercise.id, { indices: [originalIndex], reviewOf: session.id })); if (!next) return; session = next; mode = 'practice'; render();
      }, 'text-button dictation-practice-phrase'));
      row.append(actions); list.append(row);
    });
    root.append(list, el('p', 'dictation-history-note', 'Las diferencias observadas se han añadido a «Mis errores». Ese historial describe lo que escribiste; no presupone una confusión de pronunciación, vocabulario o gramática.'));
    updateAudioControls();
  }
  function renderHistory() {
    const root = buildShell('Tus errores de escritura', 'Revisa los caracteres que has omitido, añadido o sustituido, sin perder de vista la frase donde aparecieron.');
    const state = store.getState();
    const errors = state.errors;
    if (!errors.length) root.append(el('p', 'dictation-empty', 'Todavía no hay diferencias guardadas. Cuando corrijas un dictado, verás aquí los caracteres que puedes volver a practicar.'));
    else {
      const list = el('div', 'dictation-error-history'); list.id = 'dictationErrorHistory';
      for (const error of [...errors].sort((a, b) => b.count - a.count)) {
        const row = el('article', 'dictation-history-row'); row.dataset.errorId = error.id;
        const copy = el('div', 'dictation-history-copy');
        const label = error.kind === 'substitution' ? `${error.written} → ${error.expected}` : error.kind === 'deletion' ? `Falta ${error.expected}` : `Sobra ${error.written}`;
        copy.append(chinese(label), el('p', '', `${error.kind === 'substitution' ? 'Sustitución' : error.kind === 'deletion' ? 'Omisión' : 'Adición'} · ${error.count} ${error.count === 1 ? 'vez' : 'veces'} · ${error.corrected ? 'Corregido en el repaso' : error.practiced ? 'Practicado' : 'Pendiente de repasar'}`));
        if (error.expected) copy.append(el('p', '', `Carácter esperado: ${error.expected}.`));
        if (error.written) copy.append(el('p', '', `Carácter escrito anteriormente: ${error.written}.`));
        const controls = el('div', 'dictation-history-actions');
        const source = [...(error.sources || [])].reverse().map(item => state.sessions.find(saved => saved.id === item.sessionId)).find(Boolean);
        const sourceExercise = source ? state.exercises.find(saved => saved.id === source.exerciseId) : null;
        const sourcePosition = source?.results?.comparisons?.findIndex(result => result.differences.some(difference => difference.kind === error.kind && difference.expected === error.expected && difference.written === error.written)) ?? -1;
        if (source && sourceExercise && sourcePosition >= 0) {
          controls.append(action('Ver en su frase', () => {
            exercise = sourceExercise; session = source; settings = { ...source.settings, rate: state.preferences.rate, voiceURI: state.preferences.voiceURI }; mode = 'results'; render();
            const target = container.querySelector(`[data-result-index="${sourcePosition}"]`); target?.scrollIntoView({ block: 'start' }); target?.querySelector('button')?.focus({ preventScroll: true });
          }, 'text-button dictation-history-context'));
          controls.append(action('Repasar esta frase', () => {
            const next = guard(() => store.startSession(sourceExercise.id, { indices: [source.indices[sourcePosition]], reviewOf: source.id })); if (!next) return; openSession(sourceExercise, next);
          }, 'text-button dictation-history-practice'));
        }
        const toggle = action(error.practiced ? 'Marcar pendiente' : 'Marcar como practicado', () => { guard(() => store.markErrorPracticed(error.id, !error.practiced)); renderHistory(); }, 'text-button dictation-mark-practiced'); toggle.setAttribute('aria-pressed', String(Boolean(error.practiced))); controls.append(toggle);
        row.append(copy, controls); list.append(row);
      }
      root.append(list);
      const note = el('p', 'dictation-hint', 'Para volver a escuchar las frases falladas, abre el resultado del dictado en «Mis dictados» y elige «Repasar errores». Marcar un carácter como practicado no cambia tu nota ni borra su frecuencia.'); root.append(note);
      root.append(action('Borrar historial de errores', () => {
        if (!window.confirm('¿Borrar el historial de errores de Dictado? Tus dictados y resultados se conservan.')) return;
        guard(() => store.clearHistory()); renderHistory(); tell('Se borró el historial de errores.');
      }, 'text-button', 'dictationClearHistory'));
    }
    privacyNote(root);
  }
  const onPageHide = () => { flushAnswer(); player.stop(); };
  const onBeforeUnload = event => { if (!flushAnswer()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  render();
  return () => {
    if (!flushAnswer()) return false;
    disposed = true; clearTimeout(answerTimer); cancelOcr(); releaseDocument(); player.dispose(); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('beforeunload', onBeforeUnload);
    return true;
  };
}
