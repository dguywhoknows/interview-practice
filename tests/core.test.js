const STRONG = 'Last summer at my internship, our deploys took 40 minutes and broke often. My goal was to make releases safe. I built a staging pipeline, then I wrote smoke tests and set up automatic rollbacks. As a result, deploy time dropped to 8 minutes and failed releases fell by 70 percent over two months. I learned to measure before optimizing. I also documented the runbook so the next intern could maintain the pipeline without my help.';
const WEAK = 'Um, I think we basically worked on the app together and, you know, we kind of made it better.';

test('analyzeAnswer counts words, fillers, hedges, numbers and STAR parts', () => {
  const s = analyzeAnswer(STRONG, 60, 0);
  assert.eq(s.starCount, 4);
  assert.ok(s.numbers >= 4);
  assert.eq(s.fillers, 0);
  assert.eq(s.ownership, 86);
  assert.eq(s.wpm, null);
  const w = analyzeAnswer(WEAK, 20, 10);
  assert.deepEq([w.fillers, w.hedges, w.starCount], [4, 2, 0]);
  assert.eq(w.ownership, 33);
  assert.eq(w.wpm, Math.round((w.words / 10) * 60));
});

test('verdicts for length and pace', () => {
  assert.eq(lengthVerdict(40), 'short'); assert.eq(lengthVerdict(150), 'good'); assert.eq(lengthVerdict(400), 'long');
  assert.eq(paceVerdict(190), 'fast'); assert.eq(paceVerdict(80), 'slow'); assert.eq(paceVerdict(140), 'natural'); assert.eq(paceVerdict(null), null);
});

test('scoreAnswer rewards specifics and structure', () => {
  assert.eq(scoreAnswer(analyzeAnswer(STRONG), 'behavioral', true), 4);
  assert.eq(scoreAnswer(analyzeAnswer(WEAK), 'behavioral', true), 2);
  assert.eq(scoreAnswer(analyzeAnswer(''), 'technical', false), 1);
});

test('followUpProbe and improvementTip target the biggest gap', () => {
  assert.eq(followUpProbe(analyzeAnswer(STRONG), 'behavioral'), '');
  assert.ok(/measurable outcome/.test(followUpProbe(analyzeAnswer('At my last job I led the team and we delivered it eventually.'), 'behavioral')));
  assert.ok(/personally/.test(followUpProbe(analyzeAnswer(WEAK), 'technical')));
  assert.ok(/trade-offs/.test(followUpProbe(analyzeAnswer('An index '.repeat(40) + 'speeds up reads a lot by keeping a sorted structure.'), 'technical')));
  assert.ok(/result/.test(improvementTip(analyzeAnswer(WEAK), 'behavioral')));
});

test('sessionSummary aggregates answers', () => {
  const turns = [{ m: analyzeAnswer(STRONG), score: 4 }, { m: analyzeAnswer(WEAK), score: 2 }];
  const s = sessionSummary(turns);
  assert.deepEq([s.answers, s.avgScore, s.overall, s.signal, s.fillers], [2, 3, 60, 'lean no hire', 4]);
});

test('competencies and story matching', () => {
  assert.deepEq(competenciesOf('Tell me about a time you disagreed with a teammate'), ['teamwork', 'conflict']);
  assert.deepEq(competenciesOf('Describe a mistake you made under a tight deadline'), ['failure', 'prioritization']);
  const stories = [
    { id: 1, title: 'Deploy pipeline', situation: 'Deploys broke often at my internship', task: 'Make releases safe', action: 'Built staging and rollbacks', result: 'Failures fell 70%', tags: ['impact', 'failure'] },
    { id: 2, title: 'Design disagreement', situation: 'A teammate and I disagreed on the API design', task: '', action: 'We prototyped both and compared', result: 'Picked the simpler one', tags: [] },
  ];
  const m = matchStories('Tell me about a time you disagreed with a teammate', stories);
  assert.eq(m[0].story.id, 2);
  assert.ok(m[0].competencies.includes('conflict'));
  assert.eq(matchStories('What is your favorite color?', stories).length, 0);
  assert.ok(storyGaps(stories).includes('customer'));
  assert.ok(!storyGaps(stories).includes('failure'));
});

test('jdSkills finds skills, requirements and years', () => {
  const jd = 'We are hiring a Backend Engineer.\nRequirements:\n- 3+ years of experience with Python and SQL\n- Experience with AWS and Docker; Kubernetes is a plus\n- Strong communication skills\nYou will mentor junior engineers and own our REST APIs. Python is used everywhere.';
  const r = jdSkills(jd);
  assert.deepEq(r.skills.slice(0, 1).map((x) => x.skill), ['python']);
  ['sql', 'aws', 'docker', 'kubernetes', 'communication', 'rest'].forEach((s) => assert.ok(r.skills.some((x) => x.skill === s), s));
  assert.ok(!r.skills.some((x) => x.skill === 'go'), 'no false positive for "go"');
  assert.eq(r.years, 3);
  assert.ok(r.requirements.some((x) => /AWS and Docker/.test(x)));
  assert.ok(r.competencies.includes('leadership'), 'mentoring signals leadership');
  assert.ok(!r.requirements.includes('Requirements:'));
  assert.eq(fmtSecs(75), '1:15');
});
