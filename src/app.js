const { $, $$, h, esc, busy, toast, download, store } = Kit;
let C = null, turns = [], mainAsked = 0, pending = null, ansStart = 0, ansTick = null, voiceSecs = 0, recog = null;
let stories = store.get('stories', []);
let sessions = store.get('sessions', []);
const uid = () => Math.random().toString(36).slice(2, 9);

const PERSONA = {
  friendly: 'a warm, encouraging recruiter who puts candidates at ease',
  neutral: 'a calm, professional hiring manager',
  tough: 'a demanding senior engineer who probes for depth and pushes back politely on vague answers',
};
const TYPE = {
  behavioral: 'behavioral questions that invite STAR-format stories (teamwork, conflict, failure, ownership, ambiguity)',
  technical: 'conceptual technical questions appropriate for the role (fundamentals, trade-offs, debugging approach), answerable verbally without code',
  system: 'lightweight system-design questions (design a URL shortener, a chat feature…) focusing on requirements, components, data and trade-offs',
  product: 'product-sense questions (improve a product, prioritize features, define success metrics)',
};

/* ================= interview ================= */
function renderLive() {
  const m = analyzeAnswer($('#answer').value, ansStart ? (Date.now() - ansStart) / 1000 : 0, voiceSecs), len = lengthVerdict(m.words), pace = paceVerdict(m.wpm);
  $('#live').innerHTML = [
    ['Words', `${m.words} <span class="tag ${len === 'good' ? 'good' : 'warn'}">${len}</span>`],
    ['Pace', pace ? `${m.wpm} wpm <span class="tag ${pace === 'natural' ? 'good' : 'warn'}">${pace}</span>` : '<span class="muted">voice only</span>'],
    ['Filler words', m.fillers], ['Hedges', m.hedges], ['Concrete numbers', m.numbers],
    ['"I" vs "we"', m.ownership == null ? '—' : `${m.ownership}% I`],
  ].map(([k, v]) => `<div class="metric"><span>${k}</span><b>${v}</b></div>`).join('') + (C.type === 'behavioral' ? `<div class="star">${['S', 'T', 'A', 'R'].map((k) => `<span class="${m.star[k] ? 'on' : ''}" title="${{ S: 'Situation', T: 'Task', A: 'Action', R: 'Result' }[k]}">${k}</span>`).join('')}</div><div class="small muted" style="margin-top:4px">STAR structure detected live</div>` : '');
}
function say(who, text) {
  const el = h('div', { class: 'msg ' + who }, who !== 'sys' ? h('div', { class: 'who' }, who === 'ai' ? 'Interviewer' : 'You') : '', text);
  $('#chat').append(el);
  $('#chat').scrollTop = 1e9;
}
function speak(text) {
  if (!$('#tts').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  speechSynthesis.speak(u);
}
const transcript = () => turns.map((t) => `Interviewer: ${t.q}\nCandidate: ${t.answer || '(skipped)'}`).join('\n\n');
async function ask(kind) {
  const n = mainAsked + 1;
  const sys = `You are ${PERSONA[C.persona]} interviewing a candidate for a ${C.level} ${C.role} role. You ask ${TYPE[C.type]}.${C.jd ? ` Tailor questions to this job description: ${C.jd.slice(0, 2500)}` : ''} Ask ONE question at a time, conversationally, in 1-3 sentences, no numbering, no preamble like "Great answer". Never answer for the candidate.`;
  let q;
  if (kind === 'followup') {
    const last = turns[turns.length - 1];
    const out = await AI.chat([{ role: 'system', content: sys + ' Decide if a single follow-up probe would reveal more depth (vague claims, missing result, unclear personal role, unexamined trade-off). Return JSON {"followup":"question or empty string"}.' }, { role: 'user', content: `Main question: ${last.q}\nCandidate answer: ${last.answer}` }], { json: true, temperature: 0.6, demo: () => ({ followup: followUpProbe(last.m, C.type) }) });
    if (!out.followup) return false;
    q = out.followup;
  } else {
    q = await AI.chat([{ role: 'system', content: sys }, { role: 'user', content: `${turns.length ? 'Conversation so far:\n' + transcript() + '\n\n' : ''}Ask main question ${n} of ${C.count}${n === 1 ? ' (open with a one-sentence greeting)' : ''}. Cover a different competency than before.` }], { temperature: 0.8, demo: () => DEMO_Q[C.type][(n - 1) % DEMO_Q[C.type].length] });
    mainAsked++;
  }
  pending = { q: q.trim(), kind };
  say('ai', pending.q);
  speak(pending.q);
  $('#qinfo').textContent = kind === 'followup' ? `Follow-up to question ${mainAsked}` : `Question ${mainAsked} of ${C.count}`;
  $('#answer').value = '';
  voiceSecs = 0; ansStart = Date.now();
  clearInterval(ansTick);
  ansTick = setInterval(() => { $('#ansTimer').textContent = fmtSecs((Date.now() - ansStart) / 1000); }, 1000);
  const matches = C.type === 'behavioral' ? matchStories(pending.q, stories).slice(0, 3) : [];
  $('#storyHint').classList.toggle('hidden', !matches.length);
  $('#storyMatches').innerHTML = matches.map((x) => `<div class="metric"><span>${esc(x.story.title)}</span><span class="muted">${x.competencies.join(', ')}</span></div><div class="muted" style="margin:4px 0 8px">${esc(x.story.result || '')}</div>`).join('');
  renderLive(); renderProg();
  $('#answer').focus();
  return true;
}
async function submit(skip = false) {
  if (!pending) return;
  stopMic();
  const answer = skip ? '' : $('#answer').value.trim();
  if (!skip && answer.split(/\s+/).length < 5) return toast('Give a little more detail (or press Skip)', 'err');
  const secs = (Date.now() - ansStart) / 1000, m = analyzeAnswer(answer, secs, voiceSecs);
  turns.push(Object.assign({}, pending, { answer, secs, m, score: scoreAnswer(m, C.type, !!answer) }));
  pending = null;
  clearInterval(ansTick);
  if (answer) say('me', answer); else say('sys', 'Skipped');
  renderProg();
  const last = turns[turns.length - 1];
  if (C.followups && last.kind === 'main' && answer && (await ask('followup'))) return;
  if (mainAsked < C.count) await ask('main'); else await report();
}
function renderProg() {
  $('#prog').innerHTML = `<div class="bar"><span style="width:${(100 * turns.filter((t) => t.kind === 'main').length) / C.count}%"></span></div><p class="small muted" style="margin-top:6px">${turns.length} answers · ${turns.filter((t) => t.kind === 'followup').length} follow-ups</p>`;
}
async function report() {
  stopMic(); clearInterval(ansTick); window.speechSynthesis?.cancel();
  say('sys', 'Interview complete. Writing your report…');
  const local = sessionSummary(turns);
  const out = await AI.chat([
    { role: 'system', content: `You are an experienced interviewer writing calibrated, constructive feedback for a ${C.level} ${C.role} candidate (${C.type} interview). Score each answer 1-5 against: relevance, structure, depth/specificity, evidence of impact, communication. Be honest but kind. Return JSON {"overall":0-100,"signal":"strong hire|hire|lean hire|lean no hire|no hire","summary":"2-3 sentences","per_answer":[{"index":0,"score":1-5,"strength":"","improve":"","better_outline":"3-4 short phrases separated by ' • '"}],"top_tips":["","",""]}` },
    { role: 'user', content: turns.map((t, i) => `#${i} [${t.kind}] Q: ${t.q}\nA: ${t.answer || '(skipped)'}\nLocal metrics: ${JSON.stringify({ words: t.m.words, fillers: t.m.fillers, hedges: t.m.hedges, numbers: t.m.numbers, star: t.m.star })}`).join('\n\n') },
  ], { json: true, temperature: 0.3, maxTokens: 2500, demo: () => ({
    overall: local.overall, signal: local.signal,
    summary: `Scored from answer metrics: length, structure, concrete evidence and filler words. Average ${local.avgScore}/5 across ${turns.length} answers.`,
    per_answer: turns.map((t, i) => ({ index: i, score: t.score, strength: t.m.numbers ? 'You backed the answer with concrete numbers.' : t.m.words >= 80 ? 'Good level of detail.' : 'Clear and to the point.', improve: improvementTip(t.m, C.type), better_outline: C.type === 'behavioral' ? 'Context in one sentence • your specific goal • two or three actions you took • quantified result and lesson' : 'Clarify the question • core idea • trade-offs • concrete example' })),
    top_tips: ['Lead with the headline, then support it.', 'Quantify impact wherever you can, even roughly.', 'Use "I" for your own contributions and save "we" for team context.'],
  }) });
  turns.forEach((t, i) => { const p = (out.per_answer || []).find((x) => +x.index === i); if (p && p.score) t.score = +p.score; });
  sessions.unshift({ id: uid(), t: Date.now(), role: C.role, type: C.type, level: C.level, overall: out.overall ?? local.overall, signal: out.signal || local.signal, answers: turns.length, fillersPer100: local.fillersPer100, avgWords: local.avgWords, summary: out.summary || '', turns: turns.map((t) => ({ q: t.q, answer: t.answer, kind: t.kind, score: t.score })) });
  sessions = sessions.slice(0, 100);
  store.set('sessions', sessions);
  $('#room').classList.add('hidden');
  const box = $('#report');
  box.classList.remove('hidden');
  box.innerHTML = '';
  box.append(
    h('div', { class: 'card row between' }, h('div', {}, h('div', { class: 'small muted' }, `${C.role} · ${C.type} · ${C.persona}`), h('h2', { style: 'margin:4px 0' }, 'Interview report'), h('p', { style: 'margin:0' }, out.summary || '')), h('div', { style: 'text-align:right' }, h('div', { class: 'score-pill' }, `${out.overall ?? '—'}/100`), h('span', { class: 'tag ' + (/strong|^hire/.test(out.signal) ? 'good' : /lean hire/.test(out.signal) ? 'warn' : 'bad') }, out.signal || ''))),
    h('div', { class: 'kpis' }, [['Answers', turns.length], ['Avg words', local.avgWords], ['Fillers per 100 words', local.fillersPer100], ['Concrete numbers', local.numbers], ['Follow-ups', turns.filter((t) => t.kind === 'followup').length], ['Total time', `${Math.round(turns.reduce((a, t) => a + t.secs, 0) / 60)} min`]].map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))),
    ...turns.map((t, i) => { const p = (out.per_answer || []).find((x) => +x.index === i) || {}; return h('div', { class: 'card q-card stack' }, h('div', { class: 'row between' }, h('b', {}, (t.kind === 'followup' ? 'Follow-up: ' : '') + t.q), h('span', { class: 'tag accent' }, `${p.score ?? t.score}/5`)), h('div', { class: 'small muted' }, t.answer ? `“${t.answer.slice(0, 280)}${t.answer.length > 280 ? '…' : ''}”` : '(skipped)'), p.strength ? h('div', {}, h('b', {}, 'Strength: '), p.strength) : '', p.improve ? h('div', {}, h('b', {}, 'Improve: '), p.improve) : '', p.better_outline ? h('div', { class: 'small' }, h('b', {}, 'Stronger outline: '), p.better_outline) : ''); }),
    h('div', { class: 'card' }, h('h2', {}, 'Top tips'), h('ol', {}, (out.top_tips || []).map((x) => h('li', {}, x)))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: resetInterview }, 'New interview'), h('button', { class: 'btn', onclick: () => download('interview-report.md', `# Interview report: ${C.role}\n\n**${out.overall}/100 · ${out.signal}**\n\n${out.summary}\n\n` + turns.map((t, i) => { const p = (out.per_answer || []).find((x) => +x.index === i) || {}; return `## ${t.q}\n\n> ${t.answer || '(skipped)'}\n\n- Score: ${p.score ?? t.score}/5\n- Strength: ${p.strength || ''}\n- Improve: ${p.improve || ''}\n`; }).join('\n') + `\n## Top tips\n${(out.top_tips || []).map((x) => `- ${x}`).join('\n')}\n`, 'text/markdown') }, 'Download report')));
}
function resetInterview() { turns = []; mainAsked = 0; pending = null; $('#chat').innerHTML = ''; $('#report').classList.add('hidden'); $('#room').classList.add('hidden'); $('#setup').classList.remove('hidden'); }
function stopMic() { if (recog) { recog.onend = null; recog.stop(); recog = null; $('#mic').classList.remove('rec'); $('#micStatus').textContent = ''; } }
$('#mic').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Speech recognition needs Chrome or Edge. You can type instead.', 'err');
  if (recog) return stopMic();
  recog = new SR();
  recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
  const base = $('#answer').value ? $('#answer').value + ' ' : '', startedAt = Date.now();
  let finalText = '';
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript; }
    $('#answer').value = base + finalText + interim;
    voiceSecs = (Date.now() - startedAt) / 1000;
    renderLive();
  };
  recog.onerror = (e) => { toast('Mic: ' + e.error, 'err'); stopMic(); };
  recog.onend = () => { if (recog) recog.start(); };
  recog.start();
  $('#mic').classList.add('rec');
  $('#micStatus').textContent = 'Listening… click again to stop';
};
$('#start').onclick = (e) => busy(e.currentTarget, async () => {
  C = { role: $('#role').value.trim() || 'Software Engineer', level: $('#level').value, type: $('#type').value, count: +$('#count').value, persona: $('#persona').value, followups: $('#followups').checked, jd: $('#jdUse').value.trim() };
  $('#setup').classList.add('hidden');
  $('#room').classList.remove('hidden');
  say('sys', `${C.level} ${C.role} · ${C.type} interview · ${C.count} questions${C.jd ? ' · tailored to the job description' : ''}`);
  await ask('main');
});
$('#answer').addEventListener('input', renderLive);
$('#answer').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#submit').click(); });
$('#submit').onclick = (e) => busy(e.currentTarget, () => submit(false));
$('#skip').onclick = (e) => busy(e.currentTarget, () => submit(true));
$('#endEarly').onclick = (e) => busy(e.currentTarget, () => (turns.length ? report() : toast('Answer at least one question first', 'err')));

/* ================= prep ================= */
function renderJD() {
  const r = jdSkills($('#jd').value);
  $('#jdSkills').innerHTML = r.skills.length ? r.skills.map((s) => `<span class="skill">${esc(s.skill)}<b>${s.mentions}</b></span>`).join('') : '<span class="muted small">No known skills found yet.</span>';
  $('#jdYears').textContent = [r.years ? `Asks for about ${r.years}+ years of experience.` : '', r.competencies.length ? `Behavioral themes: ${r.competencies.join(', ')}.` : ''].filter(Boolean).join(' ');
  $('#jdReqs').innerHTML = r.requirements.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No requirement sentences detected.</li>';
  return r;
}
$('#jdGo').onclick = () => { renderJD(); store.set('jd', $('#jd').value); };
$('#jdQs').onclick = (e) => busy(e.currentTarget, async () => {
  const r = renderJD();
  const out = await AI.chat([
    { role: 'system', content: 'You are a hiring manager. From the job description, list the 8 questions this candidate is most likely to be asked: a mix of behavioral, technical and role-specific. For each give one line on what a strong answer shows. Return JSON {"questions":[{"q":"","type":"behavioral|technical|role","why":""}]}.' },
    { role: 'user', content: $('#jd').value.slice(0, 6000) },
  ], { json: true, temperature: 0.5, demo: () => ({ questions: [
    ...r.skills.slice(0, 4).map((s) => ({ q: `Walk me through a project where you used ${s.skill}. What would you do differently now?`, type: 'technical', why: `Depth with ${s.skill}, not just familiarity.` })),
    ...(r.competencies.length ? r.competencies : ['impact', 'conflict']).slice(0, 3).map((c) => ({ q: DRILLS[c][0], type: 'behavioral', why: `Evidence of ${c}.` })),
    { q: 'Why this role, and why now?', type: 'role', why: 'Motivation that matches the job.' },
  ] }) });
  $('#jdQuestions').innerHTML = (out.questions || []).map((q) => `<div class="metric"><span><b>${esc(q.q)}</b><div class="muted">${esc(q.why || '')}</div></span><span class="tag">${esc(q.type || '')}</span></div>`).join('');
});
$('#jdPractice').onclick = () => { $('#jdUse').value = $('#jd').value; resetInterview(); Router.go('interview'); toast('Job description added to the interview setup'); };

/* ================= stories ================= */
let editing = null, formTags = [];
const saveStories = () => store.set('stories', stories);
function renderTagPicker() {
  $('#sTags').innerHTML = '';
  Object.keys(COMPETENCIES).forEach((c) => $('#sTags').append(h('button', { type: 'button', class: 'tagbtn' + (formTags.includes(c) ? ' on' : ''), onclick: () => { formTags = formTags.includes(c) ? formTags.filter((x) => x !== c) : formTags.concat(c); renderTagPicker(); } }, c)));
}
function fillForm(s) {
  editing = s ? s.id : null;
  $('#storyFormTitle').textContent = s ? 'Edit story' : 'New STAR story';
  $('#sTitle').value = s?.title || ''; $('#sS').value = s?.situation || ''; $('#sT').value = s?.task || ''; $('#sA').value = s?.action || ''; $('#sR').value = s?.result || '';
  formTags = s?.tags?.slice() || [];
  renderTagPicker();
}
$('#storyForm').onsubmit = (e) => {
  e.preventDefault();
  const s = { id: editing || uid(), title: $('#sTitle').value.trim(), situation: $('#sS').value.trim(), task: $('#sT').value.trim(), action: $('#sA').value.trim(), result: $('#sR').value.trim(), tags: formTags.length ? formTags : competenciesOf([$('#sTitle').value, $('#sS').value, $('#sT').value, $('#sA').value, $('#sR').value].join(' ')) };
  stories = editing ? stories.map((x) => (x.id === editing ? s : x)) : [s].concat(stories);
  saveStories(); fillForm(null); renderStories();
  toast('Story saved');
};
$('#sReset').onclick = () => fillForm(null);
$('#sPolish').onclick = (e) => busy(e.currentTarget, async () => {
  const draft = { situation: $('#sS').value, task: $('#sT').value, action: $('#sA').value, result: $('#sR').value };
  const out = await AI.chat([
    { role: 'system', content: 'Tighten this STAR interview story: keep every fact, cut filler, use "I" for the candidate\'s own actions, and make the result concrete. Never invent numbers; if a result has none, add "(add a number)". Return JSON {"situation":"","task":"","action":"","result":""}.' },
    { role: 'user', content: JSON.stringify(draft) },
  ], { json: true, temperature: 0.3, demo: () => Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.replace(/\b(basically|actually|really|just|kind of|sort of)\s+/gi, '').replace(/\bwe (built|decided|wrote|designed|fixed)\b/gi, 'I $1') + (k === 'result' && v && !/\d/.test(v) ? ' (add a number)' : '')])) });
  ['situation', 'task', 'action', 'result'].forEach((k, i) => { if (out[k]) $(['#sS', '#sT', '#sA', '#sR'][i]).value = out[k]; });
});
function renderStories() {
  const q = $('#sQuery').value.trim(), list = $('#storyList');
  const ranked = q ? matchStories(q, stories) : stories.map((s) => ({ story: s, competencies: [] }));
  list.innerHTML = '';
  if (!stories.length) list.append(h('div', { class: 'card empty' }, 'Write five or six stories that cover different competencies. Behavioral interviews mostly recombine them.'));
  else if (q && !ranked.length) list.append(h('div', { class: 'card empty' }, 'No saved story fits that question. Consider writing one.'));
  ranked.forEach((x, i) => {
    const s = x.story;
    list.append(h('div', { class: 'card story' + (q && i === 0 ? ' match' : '') },
      h('div', { class: 'row between' }, h('b', {}, s.title), h('div', { class: 'row' }, ...(s.tags || []).map((t) => h('span', { class: 'tag' + (x.competencies.includes(t) ? ' accent' : '') }, t)))),
      h('div', { class: 'parts' }, ...[['S', s.situation], ['T', s.task], ['A', s.action], ['R', s.result]].flatMap(([k, v]) => [h('b', {}, k), h('span', { class: v ? '' : 'muted' }, v || 'missing')])),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, `${analyzeAnswer(storyText(s)).words} words`), h('span', { class: 'grow' }), h('button', { class: 'btn ghost sm', onclick: () => fillForm(s) }, 'Edit'), h('button', { class: 'btn ghost sm danger', onclick: () => { if (!confirm(`Delete "${s.title}"?`)) return; stories = stories.filter((y) => y !== s); saveStories(); renderStories(); } }, 'Delete'))));
  });
  const gaps = storyGaps(stories);
  $('#gaps').innerHTML = gaps.length ? `No story yet for: <b>${gaps.join(', ')}</b>.` : 'Every competency has at least one story.';
}
$('#sQuery').oninput = renderStories;

/* ================= drills ================= */
let drillTimer = null;
Object.keys(DRILLS).forEach((c) => $('#dComp').append(h('option', { value: c }, c)));
$('#dComp').insertBefore(h('option', { value: 'any', selected: true }, 'Any competency'), $('#dComp').firstChild);
$('#dNext').onclick = () => {
  clearInterval(drillTimer);
  const comp = $('#dComp').value === 'any' ? Object.keys(DRILLS)[Math.floor(Math.random() * Object.keys(DRILLS).length)] : $('#dComp').value;
  const q = DRILLS[comp][Math.floor(Math.random() * DRILLS[comp].length)], limit = +$('#dLimit').value, t0 = Date.now();
  const timer = h('div', { class: 'drill-timer' }, fmtSecs(limit));
  const ta = h('textarea', { rows: 7, placeholder: 'Answer in STAR order. Aim to land the result before time runs out.', 'aria-label': 'Answer' });
  const fb = h('div', {});
  const best = matchStories(q, stories)[0];
  $('#drill').innerHTML = '';
  $('#drill').append(h('div', { class: 'row between' }, h('span', { class: 'tag accent' }, comp), timer), h('div', { class: 'drill-q' }, q),
    best ? h('div', { class: 'small muted' }, 'Your best-fitting story: ', h('b', {}, best.story.title)) : '',
    ta, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => {
      clearInterval(drillTimer);
      const m = analyzeAnswer(ta.value, (Date.now() - t0) / 1000);
      const score = scoreAnswer(m, 'behavioral', m.words > 0);
      fb.innerHTML = `<div class="kpis"><div class="stat"><div class="k">Score</div><div class="v">${score}/5</div></div><div class="stat"><div class="k">Words</div><div class="v">${m.words}</div></div><div class="stat"><div class="k">STAR parts</div><div class="v">${['S', 'T', 'A', 'R'].filter((k) => m.star[k]).join(' ') || 'none'}</div></div><div class="stat"><div class="k">Fillers</div><div class="v">${m.fillers}</div></div></div><p><b>Next time:</b> ${esc(improvementTip(m, 'behavioral'))}</p>`;
    } }, 'Done')), fb);
  ta.focus();
  drillTimer = setInterval(() => { const left = limit - (Date.now() - t0) / 1000; timer.textContent = left >= 0 ? fmtSecs(left) : '+' + fmtSecs(-left); timer.classList.toggle('over', left < 0); }, 250);
};

/* ================= history ================= */
function renderHistory() {
  const last = sessions.slice(0, 20).reverse();
  $('#hKpis').innerHTML = [['Interviews', sessions.length], ['Best score', sessions.length ? Math.max(...sessions.map((s) => s.overall)) : '—'], ['Latest', sessions[0] ? sessions[0].overall : '—'], ['Stories saved', stories.length]]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  if (last.length < 2) $('#hChart').innerHTML = '<div class="empty">Finish two or more interviews to see a trend.</div>';
  else {
    const W = 640, H = 180, p = 30, x = (i) => p + (i / (last.length - 1)) * (W - p - 10), y = (v) => H - 20 - (v / 100) * (H - 40), maxF = Math.max(1, ...last.map((s) => s.fillersPer100)), yf = (v) => H - 20 - (v / maxF) * (H - 40);
    $('#hChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Score trend"><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${last.map((s, i) => `${x(i)},${y(s.overall)}`).join(' ')}"/><polyline fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="5 4" points="${last.map((s, i) => `${x(i)},${yf(s.fillersPer100)}`).join(' ')}"/>${last.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.overall)}" r="4" fill="var(--accent)"><title>${s.overall}/100</title></circle>`).join('')}<text x="${p}" y="12" font-size="11" fill="var(--accent)">score</text><text x="${p + 50}" y="12" font-size="11" fill="var(--warn)">fillers per 100 words</text></svg>`;
  }
  const t = $('#hTable');
  t.innerHTML = '';
  t.append(h('tr', {}, ['Date', 'Role', 'Type', 'Score', 'Signal', 'Fillers/100', ''].map((x) => h('th', {}, x))));
  if (!sessions.length) t.append(h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'No interviews yet.')));
  sessions.forEach((s) => t.append(h('tr', {}, h('td', {}, new Date(s.t).toLocaleDateString()), h('td', {}, s.role), h('td', {}, s.type), h('td', { class: 'mono' }, s.overall), h('td', {}, s.signal), h('td', {}, s.fillersPer100),
    h('td', {}, h('button', { class: 'btn ghost sm', onclick: () => download(`interview-${new Date(s.t).toISOString().slice(0, 10)}.md`, `# ${s.role} (${s.type})\n\n${s.overall}/100 · ${s.signal}\n\n${s.summary}\n\n` + s.turns.map((x) => `## ${x.q}\n\n> ${x.answer || '(skipped)'}\n\nScore: ${x.score}/5\n`).join('\n'), 'text/markdown') }, 'Export')))));
}

/* ================= boot ================= */
Router.on('stories', renderStories);
Router.on('history', renderHistory);
$('#jd').value = store.get('jd', '');
fillForm(null);
renderStories();

/* ================= AI command box ================= */
const optionLike = (sel, v) => { const o = [...$(sel).options].find((x) => (x.value + ' ' + x.textContent).toLowerCase().includes(String(v).toLowerCase())); if (o) $(sel).value = o.value; return !!o; };
Copilot.register({
  context: () => `${C && !$('#room').classList.contains('hidden') ? `Interview in progress: ${C.level} ${C.role}, ${C.type}, question ${mainAsked} of ${C.count}. Current question: ${pending?.q || 'none'}.` : 'No interview running.'} ${stories.length} STAR stories (${stories.map((s) => `${s.title} [${(s.tags || []).join(', ')}]`).join('; ')}). Missing competencies: ${storyGaps(stories).join(', ') || 'none'}. ${sessions.length} past interviews.`,
  actions: [
    { name: 'start_interview', description: 'Set up and start a mock interview', params: { role: 'job title', level: 'Intern | Entry level | Mid level | Senior', type: Object.keys(TYPE).join(' | '), persona: Object.keys(PERSONA).join(' | '), questions: '3-5', job_description: 'optional pasted text' },
      run: ({ role, level, type, persona, questions, job_description }) => { resetInterview(); Router.go('interview'); if (role) $('#role').value = role; if (level) optionLike('#level', String(level).replace(/junior/i, 'Entry')); if (TYPE[type]) $('#type').value = type; if (PERSONA[persona]) $('#persona').value = persona; if (questions) optionLike('#count', Math.max(3, Math.min(5, +questions))); if (job_description) $('#jdUse').value = job_description; $('#start').click(); return `Starting a ${$('#type').value} interview for ${$('#level').value} ${$('#role').value}`; } },
    { name: 'answer', description: 'Submit an answer to the current interview question (only when the user dictated the answer text)', params: { text: 'the user\'s answer' }, run: async ({ text }) => { if (!pending) throw new Error('No question is waiting'); $('#answer').value = text; renderLive(); await submit(false); return 'Answer submitted'; } },
    { name: 'end_interview', description: 'Finish now and write the report', params: {}, run: async () => { if (!turns.length) throw new Error('Answer at least one question first'); await report(); return 'Report written'; } },
    { name: 'save_story', description: 'Save a STAR story to the story bank. Keep the user\'s facts; never invent numbers.', params: { title: 'short title', situation: 'S', task: 'T', action: 'A (use I)', result: 'R', tags: `array from ${Object.keys(COMPETENCIES).join(', ')}` },
      run: ({ title, situation, task, action, result, tags }) => { const t = (Array.isArray(tags) ? tags : String(tags || '').split(',')).map((x) => x.trim().toLowerCase()).filter((x) => COMPETENCIES[x]); const s = { id: uid(), title, situation: situation || '', task: task || '', action: action || '', result: result || '', tags: t.length ? t : competenciesOf([situation, task, action, result].join(' ')).slice(0, 3) }; stories = [s].concat(stories); saveStories(); Router.go('stories'); renderStories(); return `Saved "${title}" (${s.tags.join(', ')})`; } },
    { name: 'start_drill', description: 'Start a timed drill on one competency', params: { competency: `any | ${Object.keys(DRILLS).join(' | ')}`, seconds: '60 | 90 | 120' },
      run: ({ competency, seconds }) => { Router.go('drills'); $('#dComp').value = DRILLS[competency] ? competency : 'any'; if (seconds) optionLike('#dLimit', seconds); $('#dNext').click(); return 'Drill: ' + $('.drill-q').textContent; } },
    { name: 'analyze_job', description: 'Analyze a job description and list likely questions', params: { job_description: 'pasted text' }, run: async ({ job_description }) => { Router.go('prep'); if (job_description) $('#jd').value = job_description; renderJD(); await $('#jdQs').onclick({ currentTarget: $('#jdQs') }); return $('#jdQuestions').innerText.slice(0, 800); } },
    { name: 'find_story', query: true, description: 'Find which saved story best answers a question', params: { question: 'interview question' }, run: ({ question }) => JSON.stringify(matchStories(question, stories).slice(0, 3).map((x) => ({ title: x.story.title, competencies: x.competencies, story: storyText(x.story) }))) },
    { name: 'progress', query: true, description: 'Look up past interview scores and filler-word trends', params: {}, run: () => JSON.stringify(sessions.slice(0, 15).map((s) => ({ date: new Date(s.t).toLocaleDateString(), role: s.role, type: s.type, score: s.overall, signal: s.signal, fillersPer100: s.fillersPer100 }))) },
  ],
});
