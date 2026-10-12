const DRAFT_KEY = 'hymy.report-drafts.v1';
const REASONS = [
  ['meaning', 'Significado o matiz'], ['naturalness', 'Uso poco natural'],
  ['grammar', 'Gramática o estructura'], ['translation', 'Traducción'],
  ['answer', 'Respuesta de un ejercicio'], ['other', 'Otro problema'],
];

const element = (tag, className = '', text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Reports use the same origin. The downloadable edition never pretends to send. */
export function mountReports({ bootstrap }) {
  const standalone = bootstrap.delivery === 'standalone';
  const dialog = element('dialog', 'report-dialog');
  dialog.id = 'reportDialog';
  dialog.setAttribute('aria-labelledby', 'reportTitle');
  dialog.setAttribute('aria-describedby', 'reportDescription');
  const header = element('header', 'dialog-header');
  const title = element('h2', '', 'Reportar un error de matiz'); title.id = 'reportTitle';
  const close = element('button', 'icon-button', '×'); close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar reporte');
  header.append(title, close);
  const form = element('form', 'dialog-body report-form');
  const description = element('p', 'report-description', standalone
    ? 'Esta copia funciona sin servidor. Puedes guardar un borrador o descargar el reporte; todavía no se enviará al propietario.'
    : 'Tu comentario llega a una bandeja privada del propietario. Describe qué cambiarías y por qué.');
  description.id = 'reportDescription';
  const context = element('div', 'report-context');
  const targetTitle = element('strong');
  const targetPreview = element('p');
  const targetReference = element('small');
  context.append(targetTitle, targetPreview, targetReference);
  const reasonLabel = element('label', 'report-field', '¿Qué habría que revisar?');
  const reason = element('select'); reason.id = 'reportReason'; reason.required = true;
  reasonLabel.htmlFor = reason.id;
  const placeholder = element('option', '', 'Elige un motivo'); placeholder.value = ''; reason.append(placeholder);
  for (const [value, label] of REASONS) { const option = element('option', '', label); option.value = value; reason.append(option); }
  const commentLabel = element('label', 'report-field', 'Tu explicación'); commentLabel.htmlFor = 'reportComment';
  const comment = element('textarea'); comment.id = 'reportComment'; comment.required = true;
  comment.minLength = 10; comment.maxLength = 2000; comment.rows = 5;
  comment.placeholder = 'Indica la frase o explicación, qué crees que falla y tu propuesta de corrección.';
  const commentHelp = element('small', 'report-help', 'Entre 10 y 2.000 caracteres. Si tienes una referencia o ejemplo, puedes incluirlo.');
  commentHelp.id = 'reportCommentHelp'; comment.setAttribute('aria-describedby', commentHelp.id);
  const contactLabel = element('label', 'report-field', 'Contacto para responderte (opcional)'); contactLabel.htmlFor = 'reportContact';
  const contact = element('input'); contact.id = 'reportContact'; contact.maxLength = 120;
  contact.type = 'text'; contact.autocomplete = 'email'; contact.placeholder = 'Correo electrónico';
  const status = element('p', 'report-status'); status.id = 'reportStatus'; status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = element('div', 'report-actions');
  const exportButton = element('button', 'secondary-button', 'Descargar reporte'); exportButton.type = 'button';
  exportButton.id = 'reportExport';
  exportButton.hidden = !standalone;
  const submit = element('button', 'primary-button', standalone ? 'Guardar borrador' : 'Enviar en privado'); submit.type = 'submit';
  submit.id = 'reportSubmit';
  actions.append(exportButton, submit);
  form.append(description, context, reasonLabel, reason, commentLabel, comment, commentHelp,
    contactLabel, contact, status, actions);
  dialog.append(header, form); document.body.append(dialog);
  let target = null, returnFocus = null, busy = false, sent = false, controller = null;

  function drafts() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw || raw.length > 200000) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.targetId === 'string'
        && typeof item.comment === 'string' && typeof item.contentVersion === 'string').slice(-20) : [];
    } catch { return []; }
  }
  function payload() {
    return { targetType: target.targetType, targetId: target.targetId,
      contentVersion: bootstrap.dataVersion, reason: reason.value, comment: comment.value.trim(),
      ...(contact.value.trim() ? { contact: contact.value.trim() } : {}) };
  }
  function valid() {
    const length = comment.value.trim().length;
    comment.setCustomValidity(length < 10 ? 'Explica el problema con al menos 10 caracteres.'
      : length > 2000 ? 'Reduce el comentario a 2.000 caracteres como máximo.' : '');
    contact.setCustomValidity(contact.value.trim().length > 120 ? 'El contacto admite hasta 120 caracteres.' : '');
    return form.reportValidity();
  }
  comment.addEventListener('input', () => comment.setCustomValidity(''));
  contact.addEventListener('input', () => contact.setCustomValidity(''));
  function closeDialog() {
    controller?.abort(); controller = null;
    dialog.close(); returnFocus?.isConnected && returnFocus.focus({ preventScroll: true });
  }
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  function setBusy(value) {
    busy = value; submit.disabled = value || sent;
    reason.disabled = value || sent; comment.disabled = value || sent; contact.disabled = value || sent;
    form.setAttribute('aria-busy', String(value));
    submit.textContent = value ? 'Enviando…' : sent ? 'Reporte recibido' : standalone ? 'Guardar borrador' : 'Enviar en privado';
  }
  exportButton.addEventListener('click', () => {
    if (!target || !valid()) return;
    const report = { ...payload(), delivery: 'local_draft_not_sent', createdAt: new Date().toISOString(),
      context: { title: target.title, text: target.preview || '' } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = element('a'); link.href = url;
    link.download = `HanYuMatiz_reporte_${target.targetId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Reporte preparado para descargar. No se ha enviado; conserva el archivo para compartirlo en privado.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || sent || !target || !valid()) return;
    status.classList.remove('error');
    if (standalone) {
      const report = { ...payload(), savedAt: new Date().toISOString() };
      const remaining = drafts().filter(item => !(item.targetType === report.targetType
        && item.targetId === report.targetId && item.contentVersion === report.contentVersion));
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify([...remaining, report].slice(-20)));
        status.textContent = 'Borrador guardado en este navegador. Está pendiente de envío. También puedes descargarlo o enviarlo desde la versión web cuando esté disponible.';
      } catch {
        status.classList.add('error');
        status.textContent = 'Este navegador no permite guardar el borrador. Usa Descargar reporte para conservarlo. No se ha enviado.';
      }
      return;
    }
    setBusy(true); status.textContent = 'Enviando tu comentario en privado…';
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    try {
      const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const csrf = await csrfResponse.json();
      if (!csrfResponse.ok || typeof csrf.csrfToken !== 'string' || !csrf.csrfToken) {
        throw new Error('No pudimos preparar un envío seguro. Vuelve a intentarlo.');
      }
      const response = await fetch('/api/reports', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
        body: JSON.stringify(payload()), signal: controller.signal });
      let result = {}; try { result = await response.json(); } catch { /* Treat a non-JSON response as unconfirmed. */ }
      if (!response.ok) {
        throw new Error(response.status === 409
          ? 'El contenido ha cambiado. Recarga la página para reportar la versión actual; tu texto sigue aquí.'
          : typeof result.error === 'string' ? result.error : 'No se recibió el reporte. Vuelve a intentarlo.');
      }
      if (typeof result.id !== 'string' || !['received', 'pending'].includes(result.status)) {
        throw new Error('El servidor no confirmó la recepción. Conserva tu texto y vuelve a intentarlo.');
      }
      sent = true;
      status.textContent = `Reporte recibido en la bandeja privada. Referencia: ${result.id}. Gracias por explicar el problema.`;
    } catch (error) {
      if (dialog.open) {
        status.classList.add('error');
        status.textContent = error.name === 'AbortError'
          ? 'No llegó una confirmación a tiempo. Tu comentario sigue aquí; puedes volver a intentarlo.' : error.message;
      }
    } finally {
      clearTimeout(timeout); controller = null; setBusy(false);
    }
  });

  function open(next) {
    if (busy) return;
    target = next; returnFocus = document.activeElement; sent = false; form.reset();
    comment.setCustomValidity(''); contact.setCustomValidity(''); status.textContent = ''; status.classList.remove('error'); setBusy(false);
    const saved = drafts().find(item => item.targetId === next.targetId && item.targetType === next.targetType
      && item.contentVersion === bootstrap.dataVersion);
    if (saved && standalone) {
      reason.value = saved.reason || ''; comment.value = saved.comment; contact.value = saved.contact || '';
      status.textContent = 'Has recuperado un borrador local. Todavía no se ha enviado.';
    }
    targetTitle.textContent = next.title;
    targetPreview.textContent = next.preview || ''; targetPreview.hidden = !next.preview;
    targetReference.textContent = `Referencia: ${next.targetId} · Versión ${String(bootstrap.dataVersion).slice(0, 8)}`;
    dialog.showModal(); reason.focus();
  }
  return Object.freeze({ open, button(target) {
    const control = element('button', 'text-button report-button', 'Reportar un error de matiz');
    control.type = 'button'; control.dataset.report = target.targetType;
    control.dataset.reportTarget = target.targetId; control.addEventListener('click', () => open(target));
    return control;
  } });
}
