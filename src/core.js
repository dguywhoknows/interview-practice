/* Answer analytics (fillers, hedges, STAR, ownership, pace), local scoring and follow-ups, competency tagging, story matching and job-description skill extraction (pure, unit-tested). */

var FILLER = /\b(um+|uh+|erm|like,|you know|i mean|sort of|kind of|basically|actually|literally|honestly)\b/gi;
var HEDGE = /\b(i think|i guess|maybe|probably|i'm not sure|not really sure|kind of|sort of|i believe|perhaps)\b/gi;
var STAR = {
  S: /\b(when i was|at my (last|previous)|in my (role|job|internship|class|project)|during|last (year|summer|semester)|while (working|i was)|we had a|there was a)\b/i,
  T: /\b(my (goal|task|job|responsibility) was|i (needed|had) to|i was (responsible|asked|tasked)|the challenge was|we needed to|objective)\b/i,
  A: /\b(i (built|decided|implemented|led|created|wrote|designed|set up|organized|reached out|proposed|analy[sz]ed|refactored|talked|scheduled|tested|fixed))\b|\b(first|then|next|so i)\b/i,
  R: /\b(as a result|resulted in|which (led|meant)|increased|reduced|improved|saved|cut|grew|in the end|ultimately|outcome|we shipped|learned|%|percent)\b/i,
};
function countMatches(text, re) { return (String(text).match(re) || []).length; }
function analyzeAnswer(text, secs, voiceSecs) {
  text = String(text || '');
  var words = (text.match(/\b[\w'’-]+\b/g) || []).length;
  var i = countMatches(text, /\bI\b|\bI'm\b|\bI've\b|\bI'd\b|\bmy\b/g), we = countMatches(text, /\b(we|our|us)\b/gi);
  var star = {}; Object.keys(STAR).forEach(function (k) { star[k] = STAR[k].test(text); });
  var sentences = text.split(/[.!?]+\s/).filter(function (s) { return s.trim(); });
  return {
    text: text, words: words, secs: secs || 0, voice: voiceSecs || 0,
    wpm: voiceSecs && voiceSecs > 3 ? Math.round((words / voiceSecs) * 60) : null,
    fillers: countMatches(text, FILLER), hedges: countMatches(text, HEDGE),
    numbers: countMatches(text, /\b\d[\d,.]*%?|\b(one|two|three|four|five|ten|twenty|hundred|thousand|million)\b/gi),
    star: star, starCount: Object.keys(star).filter(function (k) { return star[k]; }).length,
    ownership: i + we ? Math.round((100 * i) / (i + we)) : null,
    avgSentence: sentences.length ? Math.round(words / sentences.length) : 0,
  };
}
function lengthVerdict(words) { return words < 60 ? 'short' : words > 330 ? 'long' : 'good'; }
function paceVerdict(wpm) { return wpm == null ? null : wpm > 170 ? 'fast' : wpm < 100 ? 'slow' : 'natural'; }

/* Heuristic 1-5 score from answer metrics; used offline and as a sanity check next to model feedback. */
function scoreAnswer(m, type, answered) {
  if (!answered) return 1;
  var s = 2 + (m.words >= 80 ? 1 : 0) + (m.numbers > 0 ? 1 : 0) + (type !== 'behavioral' || m.starCount >= 3 ? 1 : 0) - (m.fillers > 4 ? 1 : 0) - (m.hedges > 4 ? 1 : 0);
  return Math.max(1, Math.min(5, s));
}
/* The single most useful probe after an answer, or '' if the answer is complete enough. */
function followUpProbe(m, type) {
  if (type === 'behavioral' && !m.star.R) return 'What was the measurable outcome, and how did you know it worked?';
  if (m.ownership != null && m.ownership < 40) return 'You said "we" a lot. What exactly did you personally do?';
  if (m.words < 70) return 'Can you go one level deeper on that? Walk me through a specific example.';
  if (type !== 'behavioral' && !/trade-?off|instead|downside|cost|versus|vs\.?/i.test(m.text || '')) return 'What trade-offs did you consider, and what would make you choose differently?';
  return '';
}
function improvementTip(m, type) {
  if (type === 'behavioral' && !m.star.R) return 'End with a result: what changed, and by how much?';
  if (m.words < 70) return 'Add a specific example to show depth.';
  if (m.fillers > 3) return 'Cut filler words. Pause silently instead.';
  if (m.ownership != null && m.ownership < 40) return 'Say what you did, not just what the team did.';
  if (!m.numbers) return 'Quantify something: time saved, users, error rate, size of the team.';
  return 'Name the trade-offs you considered.';
}
function sessionSummary(turns) {
  var n = turns.length || 1, sum = function (k) { return turns.reduce(function (a, t) { return a + (t.m[k] || 0); }, 0); };
  var scores = turns.map(function (t) { return t.score || 0; });
  var avg = scores.reduce(function (a, b) { return a + b; }, 0) / n;
  return { answers: turns.length, avgWords: Math.round(sum('words') / n), fillers: sum('fillers'), fillersPer100: sum('words') ? +((100 * sum('fillers')) / sum('words')).toFixed(1) : 0, numbers: sum('numbers'), avgScore: +avg.toFixed(2), overall: Math.round(avg * 20), signal: avg >= 4.2 ? 'hire' : avg >= 3.4 ? 'lean hire' : avg >= 2.6 ? 'lean no hire' : 'no hire' };
}

/* ---------- competencies + story bank ---------- */
var COMPETENCIES = {
  teamwork: /\b(team|collaborat|together|cross-functional|peer|colleague)/i,
  conflict: /\b(disagree|conflict|pushback|tension|difficult (person|teammate|colleague|stakeholder)|argument)/i,
  failure: /\b(fail|mistake|bug|went wrong|regret|setback|missed)/i,
  leadership: /\b(lead|led|mentor|influence|ownership|took charge|initiative)/i,
  ambiguity: /\b(ambigu|unclear|uncertain|without (clear|much) (direction|information)|changing requirements)/i,
  learning: /\b(learn|new (skill|technology|tool)|quickly pick|unfamiliar|ramp up)/i,
  impact: /\b(proud|impact|achievement|accomplish|biggest|went beyond|above and beyond)/i,
  customer: /\b(customer|user|client|stakeholder)/i,
  prioritization: /\b(priorit|deadline|trade-?off|too many|time pressure|juggl)/i,
};
function competenciesOf(text) { return Object.keys(COMPETENCIES).filter(function (k) { return COMPETENCIES[k].test(text); }); }
function tokens(s) { return (String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(function (w) { return ['the', 'and', 'you', 'your', 'with', 'that', 'this', 'tell', 'about', 'time', 'when', 'what', 'how', 'did', 'was', 'for', 'have', 'had', 'describe', 'were', 'from'].indexOf(w) < 0; }); }
/* Rank saved STAR stories for a question by shared competencies (weighted) and shared words. */
function matchStories(question, stories) {
  var qc = competenciesOf(question), qt = tokens(question);
  return stories.map(function (s) {
    var text = [s.title, s.situation, s.task, s.action, s.result].join(' '), sc = (s.tags && s.tags.length ? s.tags : competenciesOf(text));
    var shared = sc.filter(function (c) { return qc.indexOf(c) >= 0; }), st = tokens(text);
    var overlap = qt.filter(function (w, i) { return qt.indexOf(w) === i && st.indexOf(w) >= 0; });
    return { story: s, score: shared.length * 3 + overlap.length, competencies: shared };
  }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
}
function storyGaps(stories) {
  var have = {};
  stories.forEach(function (s) { (s.tags && s.tags.length ? s.tags : competenciesOf([s.title, s.situation, s.task, s.action, s.result].join(' '))).forEach(function (c) { have[c] = (have[c] || 0) + 1; }); });
  return Object.keys(COMPETENCIES).filter(function (c) { return !have[c]; });
}
function storyText(s) { return [s.situation, s.task, s.action, s.result].filter(Boolean).join(' '); }

/* ---------- job descriptions ---------- */
var SKILLS = ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c++', 'c#', 'sql', 'react', 'vue', 'angular', 'node', 'django', 'flask', 'spring', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git', 'linux', 'graphql', 'rest', 'microservices', 'machine learning', 'data analysis', 'excel', 'tableau', 'figma', 'agile', 'scrum', 'testing', 'communication', 'leadership', 'stakeholder management', 'product management', 'a/b testing', 'analytics', 'security', 'distributed systems', 'system design', 'mentoring', 'customer'];
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* Known skills found in the text, ranked by mentions, plus requirement sentences ("must", "required", "experience with"). */
function jdSkills(text) {
  var t = String(text).toLowerCase();
  var skills = SKILLS.map(function (s) { var n = (t.match(new RegExp('(^|[^a-z0-9+#])' + escRe(s) + '(?![a-z0-9+#])', 'g')) || []).length; return { skill: s, mentions: n }; }).filter(function (x) { return x.mentions; }).sort(function (a, b) { return b.mentions - a.mentions || a.skill.localeCompare(b.skill); });
  var reqs = String(text).split(/\n|(?<=[.;])\s+/).map(function (s) { return s.replace(/^[\s•*-]+/, '').trim(); }).filter(function (s) { return /\b(must|required|requirements?|experience (with|in)|proficien|you will|you'll|responsib)/i.test(s) && s.length > 12 && !/:$/.test(s); });
  var years = (String(text).match(/(\d+)\+?\s*(?:-\s*\d+\s*)?years?/i) || [])[1];
  return { skills: skills, requirements: reqs.slice(0, 12), years: years ? +years : null, competencies: competenciesOf(text) };
}
function fmtSecs(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
