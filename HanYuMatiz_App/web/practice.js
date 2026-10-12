import { normalizeExercise, feedbackFor } from './engine.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (className, text, action) => {
  const element = node('button', className, text);
  element.type = 'button';
  if (action) element.addEventListener('click', action);
  return element;
};
const hanzi = (text, className = 'zh') => {
  const element = node('span', className, text);
  element.lang = 'zh-Hans';
  return element;
};

/** A single question at a time, backed by the learner's real saved session. */
export function mountPractice(container, {
  exercises,
  bootstrap,
  progress,
  lessonId = null,
  sessionId,
  onExit = () => {},
  onComplete = () => {},
  createReportButton = null,
  onExploreContrast = null,
}) {
  const questions = exercises.map(raw => normalizeExercise(raw, bootstrap))
    .filter(question => question && question.options.length > 1);
  container.replaceChildren();
  if (!questions.length) {
    const empty = node('section', 'empty-state');
    empty.append(node('h1', '', 'No hay ejercicios disponibles.'),
      node('p', '', 'Esta práctica todavía no contiene preguntas utilizables.'),
      button('submit', 'Volver', onExit));
    container.append(empty);
    return () => {};
  }

  const exerciseIds = questions.map(question => question.id);
  const previous = progress.getSession(sessionId);
  const dataVersion = typeof bootstrap?.dataVersion === 'string' && bootstrap.dataVersion
    ? bootstrap.dataVersion : undefined;
  if (previous && previous.dataVersion !== dataVersion) {
    const previousVersion = node('section', 'empty-state');
    previousVersion.append(node('h1', '', 'Esta práctica pertenece a otra versión.'),
      node('p', '', 'Tus respuestas anteriores se conservan. Vuelve y abre una sesión nueva para practicar con el contenido actual.'),
      button('submit', 'Volver', onExit));
    container.append(previousVersion);
    return () => {};
  }
  let session = {
    id: sessionId,
    lessonId,
    exerciseIds,
    currentIndex: previous?.currentIndex ?? 0,
    showPinyin: previous?.showPinyin ?? false,
    showTranslation: previous?.showTranslation ?? false,
    ended: previous?.ended ?? false,
    selections: { ...(previous?.selections || {}) },
  };
  if (dataVersion !== undefined) session.dataVersion = dataVersion;
  session.currentIndex = Math.min(questions.length - 1,
    Math.max(0, Number.isInteger(session.currentIndex) ? session.currentIndex : 0));
  let selected = null;
  let checked = false;
  let disposed = false;
  let completedNotice = false;
  const answers = () => progress.getState().answers[sessionId] || {};
  const answerFor = question => answers()[question.id];
  const visibleOptions = question => question.kind === 'both_acceptable'
    ? question.options.filter(option => option.key !== 'both') : question.options;
  const completed = () => questions.filter(question => answerFor(question)).length;
  const score = () => questions.filter(question => answerFor(question)?.correct).length;
  if (session.ended && completed() !== questions.length) session.ended = false;
  const save = () => progress.saveSession(session);
  save();

  const card = node('section', 'study-card');
  card.id = 'studyCard';
  card.setAttribute('aria-label', 'Ejercicio interactivo');
  const header = node('header', 'study-head');
  const exit = button('icon-button practice-exit', '×', onExit);
  exit.setAttribute('aria-label', 'Salir de la práctica; tu avance queda guardado');
  const bar = node('div', 'bars');
  bar.id = 'progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Preguntas respondidas');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(questions.length));
  const fill = node('span', 'progress-fill');
  fill.id = 'progressFill';
  bar.append(fill);
  const progressText = node('span', 'progress-text');
  progressText.id = 'stripProgress';
  const listButton = button('practice-list-button extra-button', 'Situaciones', openList);
  header.append(exit, bar, progressText, listButton);

  const region = node('div', 'scroll-region');
  region.id = 'scrollRegion';
  region.tabIndex = 0;
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Pregunta y explicación');
  const studyBody = node('div', 'study-body');
  studyBody.id = 'studyBody';
  const title = node('h1', 'exercise-title');
  title.id = 'exerciseTitle';
  title.tabIndex = -1;
  const context = node('p', 'exercise-context');
  context.id = 'exerciseContext';
  const field = node('section', 'ink-field');
  field.setAttribute('aria-label', 'Frase china para completar');
  const phrase = node('div', 'phrase zh');
  phrase.id = 'phrase';
  phrase.lang = 'zh-Hans';
  field.append(phrase);
  const extras = node('div', 'extras');
  const pinyinButton = button('extra-button', 'Pinyin', () => {
    session.showPinyin = !session.showPinyin;
    save();
    drawPhrase();
  });
  pinyinButton.id = 'togglePinyin';
  const translationButton = button('extra-button', 'Traducción', () => {
    session.showTranslation = !session.showTranslation;
    save();
    drawPhrase();
  });
  translationButton.id = 'toggleTranslation';
  const translation = node('span', 'inline-translation');
  translation.id = 'translation';
  extras.append(pinyinButton, translationButton, translation);
  const caption = node('div', 'options-caption');
  const objective = node('strong');
  const keyboardHint = node('span');
  caption.append(objective, keyboardHint);
  const choices = node('div', 'choices');
  choices.id = 'choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Opciones de respuesta');
  const feedback = node('div', 'feedback');
  feedback.id = 'feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const feedbackTitle = node('strong');
  feedbackTitle.id = 'feedbackTitle';
  const feedbackHeading = node('div', 'feedback-heading');
  const feedbackIcon = node('span', 'feedback-icon');
  feedbackIcon.setAttribute('aria-hidden', 'true');
  feedbackHeading.append(feedbackIcon, feedbackTitle);
  const feedbackText = node('p');
  feedbackText.id = 'feedbackText';
  const feedbackReading = node('div', 'feedback-reading');
  feedbackReading.id = 'feedbackReading';
  const feedbackDetails = node('details', 'feedback-details');
  feedbackDetails.append(node('summary', '', 'Otro ejemplo'));
  const difference = node('div', 'feedback-difference');
  feedbackDetails.append(difference);
  feedback.append(feedbackHeading, feedbackText, feedbackReading, feedbackDetails);
  const reportActions = node('div', 'exercise-report-actions'); reportActions.hidden = true;
  studyBody.append(title, context, field, extras, caption, choices, feedback, reportActions);
  const endView = node('section', 'end-view');
  endView.id = 'endView';
  endView.hidden = true;
  region.append(studyBody, endView);

  const footer = node('footer', 'study-footer');
  const note = node('div', 'footer-note');
  const actionHint = node('span');
  actionHint.id = 'actionHint';
  const scrollHint = node('small', '', 'Desliza la pregunta para leer más.');
  scrollHint.id = 'scrollHint';
  scrollHint.hidden = true;
  note.append(actionHint, scrollHint);
  const primary = button('submit', 'Comprobar', advance);
  primary.id = 'primary';
  footer.append(note, primary);
  card.append(header, region, footer);

  const modal = node('dialog');
  modal.id = 'practiceSituations';
  modal.setAttribute('aria-labelledby', 'situationsTitle');
  const modalHeader = node('header', 'dialog-header');
  const modalTitle = node('h2', '', 'Situaciones de la práctica');
  modalTitle.id = 'situationsTitle';
  const closeModalButton = button('icon-button', '×', closeList);
  closeModalButton.setAttribute('aria-label', 'Cerrar situaciones');
  modalHeader.append(modalTitle, closeModalButton);
  const modalItems = node('div', 'dialog-body');
  modal.append(modalHeader, modalItems);
  modal.addEventListener('cancel', event => {
    event.preventDefault();
    closeList();
  });
  const announce = node('div', 'sr-only');
  announce.setAttribute('aria-live', 'polite');
  container.append(card, modal, announce);

  function updateHint() {
    if (!disposed) scrollHint.hidden = region.scrollHeight <= region.clientHeight + 1;
  }
  function focusHeading(element = title) {
    requestAnimationFrame(() => {
      if (disposed) return;
      element.focus({ preventScroll: true });
      updateHint();
    });
  }
  function updateProgress() {
    const done = completed();
    bar.setAttribute('aria-valuenow', String(done));
    bar.setAttribute('aria-valuetext', `${done} de ${questions.length} preguntas respondidas`);
    fill.style.width = `${done / questions.length * 100}%`;
    progressText.textContent = session.ended ? 'Práctica completada'
      : `Pregunta ${session.currentIndex + 1} de ${questions.length}`;
  }
  function appendTokens(target, tokens, fallback) {
    if (!session.showPinyin || !Array.isArray(tokens)) {
      target.append(hanzi(fallback));
      return;
    }
    for (const token of tokens) {
      const text = Array.isArray(token) ? token[0] : token.text;
      const pinyin = Array.isArray(token) ? token[1] : token.pinyin;
      if (!pinyin) {
        target.append(hanzi(text ?? ''));
        continue;
      }
      const ruby = node('ruby');
      const rt = node('rt', '', pinyin);
      rt.lang = 'zh-Latn-pinyin';
      ruby.append(document.createTextNode(text ?? ''), rt);
      target.append(ruby);
    }
  }
  function drawPhrase() {
    const question = questions[session.currentIndex];
    const pieces = question.sentence.split('〔词〕');
    const option = question.options.find(item => item.key === selected);
    phrase.replaceChildren();
    appendTokens(phrase, question.beforeTokens, pieces[0] || '');
    const blank = node('span', 'blank');
    const choiceWord = option?.word;
    blank.setAttribute('aria-label', choiceWord ? 'Tu elección: ' + choiceWord : 'Espacio por completar');
    if (choiceWord) {
      blank.classList.add('filled');
      appendTokens(blank, option.pinyin ? [[choiceWord, option.pinyin]] : null, choiceWord);
    } else if (option?.key === 'both') {
      const words = question.options.filter(item => item.word).map(item => item.word);
      blank.classList.add('filled');
      blank.append(hanzi(words.join(' / ')));
      blank.setAttribute('aria-label', 'Las dos opciones: ' + words.join(' y '));
    }
    phrase.append(blank);
    appendTokens(phrase, question.afterTokens, pieces.slice(1).join('〔词〕'));
    pinyinButton.setAttribute('aria-pressed', String(session.showPinyin));
    translationButton.setAttribute('aria-pressed', String(session.showTranslation));
    translation.textContent = session.showTranslation ? question.translation || 'Traducción pendiente.' : '';
    requestAnimationFrame(updateHint);
  }
  function select(key) {
    if (checked || session.ended) return;
    const question = questions[session.currentIndex];
    const option = question.options.find(item => item.key === key);
    if (!option) return;
    selected = key;
    session.selections[question.id] = key;
    save();
    for (const choice of choices.children) {
      const active = choice.dataset.key === key;
      choice.classList.toggle('selected', active);
      choice.setAttribute('aria-pressed', String(active));
    }
    primary.disabled = false;
    actionHint.textContent = 'Tu elección: ' + option.label;
    drawPhrase();
  }
  function drawFeedback() {
    const question = questions[session.currentIndex];
    const answer = answerFor(question);
    const state = feedbackFor(question, answer.selected);
    card.dataset.result = state.tone;
    for (const choice of choices.children) {
      choice.disabled = true;
      const isAnswer = feedbackFor(question, choice.dataset.key)?.correct;
      const isSelected = choice.dataset.key === answer.selected;
      choice.classList.toggle('correct', isAnswer);
      choice.classList.toggle('wrong', isSelected && !answer.correct);
      choice.classList.remove('valid-nuance');
      const circle = choice.querySelector('.choice-circle');
      if (circle) circle.textContent = isSelected && !answer.correct ? '×' : '✓';
      choice.querySelector('.choice-state')?.remove();
      if (isSelected) choice.append(node('span', 'choice-state', answer.correct
        ? 'Tu respuesta · correcta' : 'Tu respuesta · incorrecta'));
      else if (isAnswer) choice.append(node('span', 'choice-state', 'Respuesta correcta'));
      choice.setAttribute('aria-label', `Opción ${choice.dataset.option * 1 + 1}: ${question.options
        .find(option => option.key === choice.dataset.key).label}${isSelected ? ', tu respuesta' : ''}${isAnswer
        ? ', correcta' : isSelected ? ', incorrecta' : ''}`);
    }
    feedbackTitle.textContent = state.title;
    feedbackIcon.textContent = state.icon;
    feedbackText.textContent = state.lead;
    feedbackReading.replaceChildren();
    for (const paragraph of state.paragraphs) {
      const block = node('section', 'feedback-reading-section');
      block.append(node('h3', '', paragraph.label), node('p', '', paragraph.text));
      feedbackReading.append(block);
    }
    if (state.example) {
      const block = node('section', 'feedback-application');
      const sentence = node('p', 'feedback-application-sentence zh', state.example.sentence_zh);
      sentence.lang = 'zh-Hans';
      block.append(node('h3', '', 'La frase completa'), sentence,
        node('p', '', state.example.translation_es));
      feedbackReading.append(block);
    }
    difference.replaceChildren();
    const example = question.relatedExample;
    if (example) {
      difference.append(node('h3', 'feedback-example-title', example.label));
      const variants = node('div', 'feedback-example-variants');
      for (const key of ['a', 'b']) {
        const variant = example.variants[key];
        const block = node('section', 'feedback-example-variant');
        const sentence = node('p', 'zh'); sentence.lang = 'zh-Hans';
        sentence.textContent = variant.sentence_zh;
        block.append(sentence, node('p', 'feedback-example-translation', variant.translation_es));
        variants.append(block);
      }
      difference.append(variants);
      if (example.takeaway) difference.append(node('p', 'feedback-example-takeaway', example.takeaway));
      if (onExploreContrast && question.contrastId) {
        difference.append(button('text-button', 'Ver todos los ejemplos', () => onExploreContrast(question.contrastId)));
      }
    }
    feedbackDetails.open = false;
    feedbackDetails.hidden = !difference.childNodes.length;
    feedback.className = 'feedback active' + (answer.correct ? '' : ' error');
    reportActions.replaceChildren();
    if (createReportButton) reportActions.append(createReportButton(question));
    reportActions.hidden = !createReportButton;
    primary.disabled = false;
    primary.textContent = completed() === questions.length ? 'Ver resultados' : 'Continuar';
    actionHint.textContent = state.title;
  }
  function renderQuestion(focus = false) {
    const question = questions[session.currentIndex];
    const answer = answerFor(question);
    selected = answer?.selected ?? session.selections[question.id] ?? null;
    if (!question.options.some(item => item.key === selected)) selected = null;
    checked = Boolean(answer);
    session.ended = false;
    save();
    studyBody.hidden = false;
    endView.hidden = true;
    card.dataset.result = '';
    title.textContent = question.title;
    context.textContent = question.context;
    objective.textContent = question.prompt;
    keyboardHint.textContent = 'Teclas 1–' + visibleOptions(question).length;
    feedback.className = 'feedback';
    feedbackTitle.textContent = '';
    feedbackIcon.textContent = '';
    feedbackText.textContent = '';
    feedbackReading.replaceChildren();
    feedbackDetails.open = false;
    difference.replaceChildren();
    reportActions.replaceChildren(); reportActions.hidden = true;
    choices.replaceChildren();
    choices.dataset.optionCount = String(visibleOptions(question).length);
    visibleOptions(question).forEach((option, index) => {
      const choice = button('choice' + (selected === option.key ? ' selected' : ''), undefined,
        () => select(option.key));
      choice.dataset.key = option.key;
      choice.dataset.option = String(index);
      choice.setAttribute('aria-pressed', String(selected === option.key));
      choice.setAttribute('aria-label', `Opción ${index + 1}: ${option.label}${option.pinyin ? ', ' + option.pinyin : ''}`);
      const word = node('span', 'choice-word');
      if (option.word && option.label !== option.word) {
        const qualifier = option.label.includes(option.word)
          ? option.label.replace(option.word, '').trim() : option.label;
        if (qualifier) word.append(node('span', 'choice-qualifier', qualifier));
      }
      const wordNode = option.word ? hanzi(option.word, 'choice-han zh') : node('span', 'choice-label', option.label);
      word.append(wordNode);
      if (option.pinyin) {
        const pinyin = node('span', 'choice-py', option.pinyin);
        pinyin.lang = 'zh-Latn-pinyin';
        word.append(pinyin);
      }
      const check = node('span', 'choice-circle', '•');
      check.setAttribute('aria-hidden', 'true');
      choice.append(node('span', 'choice-index', String(index + 1).padStart(2, '0')), word, check);
      choices.append(choice);
    });
    primary.textContent = 'Comprobar';
    primary.disabled = selected === null;
    actionHint.textContent = selected === null ? 'Selecciona una respuesta' : 'Tu elección: '
      + question.options.find(item => item.key === selected).label;
    if (checked) drawFeedback();
    drawPhrase();
    updateProgress();
    region.scrollTop = 0;
    announce.textContent = `Pregunta ${session.currentIndex + 1} de ${questions.length}`;
    if (focus) focusHeading();
  }
  function checkAnswer() {
    if (checked || selected === null || session.ended) return;
    const question = questions[session.currentIndex];
    progress.recordAnswer({ sessionId, lessonId, exerciseId: question.id,
      scenarioId: question.scenarioId, selected, correct: feedbackFor(question, selected).correct });
    checked = true;
    drawFeedback();
    updateProgress();
    announce.textContent = feedbackTitle.textContent + ' ' + feedbackText.textContent;
    requestAnimationFrame(() => {
      if (disposed) return;
      const regionRect = region.getBoundingClientRect();
      const feedbackRect = feedback.getBoundingClientRect();
      if (feedbackRect.bottom > regionRect.bottom) {
        region.scrollTop += Math.min(feedbackRect.bottom - regionRect.bottom + 8,
          Math.max(0, feedbackRect.top - regionRect.top));
      }
      updateHint();
    });
  }
  function renderResults(focus = true) {
    if (completed() !== questions.length) return;
    session.ended = true;
    save();
    if (lessonId) progress.completeLesson(lessonId, exerciseIds, dataVersion);
    studyBody.hidden = true;
    endView.hidden = false;
    card.dataset.result = '';
    endView.replaceChildren(node('div', 'eyebrow', 'Práctica completada'));
    const heading = node('h2', '', 'Un matiz más claro.');
    heading.id = 'resultsTitle';
    heading.tabIndex = -1;
    const explanation = node('p', '', `${questions.length} situaciones respondidas. Puedes volver a cada una y revisar su explicación.`);
    const scoreElement = node('div', 'score', `${score()} / ${questions.length}`);
    scoreElement.id = 'score';
    scoreElement.setAttribute('aria-label', `${score()} de ${questions.length} respuestas correctas`);
    const results = node('div', 'results-list');
    results.id = 'resultsList';
    questions.forEach((question, index) => {
      const answer = answerFor(question);
      const selectedOption = question.options.find(option => option.key === answer.selected);
      const item = button('result-item', undefined, () => {
        session.currentIndex = index;
        renderQuestion(true);
      });
      const text = node('span', 'result-text', question.title);
      text.append(node('small', '', 'Tu respuesta: ' + selectedOption.label));
      item.append(node('span', '', String(index + 1).padStart(2, '0')), text,
        node('span', 'result-state' + (answer.correct ? '' : ' missed'),
          answer.correct ? '✓ Correcta' : '× Incorrecta'),
        node('span', '', '→'));
      item.dataset.review = String(index);
      results.append(item);
    });
    endView.append(heading, explanation, scoreElement, results);
    primary.disabled = false;
    primary.textContent = 'Volver';
    actionHint.textContent = progress.persistent === false
      ? 'Sesión completada. El navegador no permite guardarla.'
      : 'Tu sesión está guardada en este navegador.';
    region.scrollTop = 0;
    updateProgress();
    if (focus) focusHeading(heading);
    announce.textContent = `Práctica finalizada: ${score()} de ${questions.length} respuestas correctas.`;
    if (!completedNotice) {
      completedNotice = true;
      onComplete({ lessonId, sessionId, score: score(), total: questions.length });
    }
  }
  function advance() {
    if (session.ended) {
      onExit();
      return;
    }
    if (!checked) {
      checkAnswer();
      return;
    }
    if (completed() === questions.length) {
      renderResults();
      return;
    }
    const next = questions.findIndex((question, index) => index > session.currentIndex && !answerFor(question));
    session.currentIndex = next >= 0 ? next : questions.findIndex(question => !answerFor(question));
    renderQuestion(true);
  }
  function closeList() {
    modal.close();
    listButton.focus({ preventScroll: true });
  }
  function openList() {
    modalItems.replaceChildren();
    questions.forEach((question, index) => {
      const item = button('dialog-item' + (index === session.currentIndex ? ' current' : ''), undefined,
        () => {
          session.currentIndex = index;
          modal.close();
          renderQuestion(true);
        });
      item.dataset.q = String(index);
      item.dataset.exercise = question.id;
      const text = node('span', '', question.title);
      text.append(node('small', '', question.options.filter(option => option.word).map(option => option.word).join(' / ')));
      const answer = answerFor(question);
      item.append(node('span', 'num', String(index + 1).padStart(2, '0')), text,
        node('span', 'state', answer ? (answer.correct ? '✓ Correcta' : '× Incorrecta') : 'Sin responder'));
      modalItems.append(item);
    });
    modal.showModal();
    closeModalButton.focus();
  }
  function keyboard(event) {
    if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
      || document.activeElement?.isContentEditable || event.altKey || event.ctrlKey || event.metaKey) return;
    const number = Number(event.key);
    const question = questions[session.currentIndex];
    if (/^[1-9]$/.test(event.key) && number <= visibleOptions(question).length && !checked && !session.ended) {
      event.preventDefault();
      select(visibleOptions(question)[number - 1].key);
    } else if (event.key === 'Enter' && !event.repeat && !primary.disabled
      && [document.body, region, title].includes(document.activeElement)) {
      event.preventDefault();
      advance();
    }
  }
  document.addEventListener('keydown', keyboard);
  const observer = new ResizeObserver(updateHint);
  observer.observe(region);
  observer.observe(studyBody);
  observer.observe(endView);
  const inspect = () => ({ current: session.currentIndex, selected, checked,
    answers: structuredClone(answers()), showPy: session.showPinyin,
    showTrans: session.showTranslation, ended: session.ended, score: score(),
    total: questions.length, sessionId });
  const inspectionApi = Object.freeze({ inspect });
  window.HanYuPractice = inspectionApi;
  if (session.ended) renderResults(false);
  else renderQuestion();
  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener('keydown', keyboard);
    if (modal.open) modal.close();
    if (window.HanYuPractice === inspectionApi) delete window.HanYuPractice;
  };
}
