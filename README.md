# interview-practice

[![tests](https://github.com/dguywhoknows/interview-practice/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/interview-practice/actions/workflows/tests.yml)

Practice interviews with an adaptive AI interviewer: voice or text answers, follow-up probes, STAR and filler-word analytics, and a scored report.

Live: https://dguywhoknows.github.io/interview-practice/

## Overview

Pick a role, level, interview type (behavioral, technical concepts, system design, product sense) and an interviewer persona, from a friendly recruiter to a tough senior engineer. The AI asks one question at a time, can read it aloud, and after each answer decides whether a follow-up probe would expose more depth: a vague claim, a missing result, or 'we' where it should be 'I'. You can answer by typing or by speaking (Web Speech API). Live local analytics track length, pace (wpm), filler words, hedges, concrete numbers, I-vs-we ownership and STAR structure as you talk. At the end you get a calibrated report with a per-answer score, what worked, what to fix, an outline of a stronger answer, and an overall hiring signal.

## Pages

- **Interview**
- **Prep**
- **Stories**
- **Drills**
- **History**
- **Settings**

## Features

- Configurable role, level, interview type, persona, question count
- Adaptive follow-up probes decided by the AI from your actual answer
- Voice answers via SpeechRecognition with live transcription; questions via speech synthesis
- Live analytics: words, wpm, fillers, hedges, numbers, I/we ownership, STAR detector
- Scored report: per-answer 1-5, strengths, fixes, stronger-answer outlines, overall signal
- Markdown report export
- Prep page: paste a job description to extract the skills it mentions (ranked by frequency, without false matches like "go" inside words), requirement sentences, years of experience and behavioral themes, then generate likely questions or start an interview tailored to it
- Stories page: a STAR story bank tagged by competency, with coverage gaps, AI tightening that never invents numbers, and search that ranks your stories against any question
- During behavioral interviews the best-matching saved stories appear beside the question
- Drills page: one timed question at a time per competency, scored on STAR structure, length and fillers with a specific tip
- History page: every finished interview with score, signal and fillers per 100 words, a trend chart and Markdown export
- Offline scoring and follow-up probes use the same answer metrics shown live

## How it works

LLM calls are used for:

- Conversational question generation with persona + competency coverage
- Follow-up decision (JSON)
- Rubric-based evaluation (JSON) informed by local metrics

Everything else (speech-to-text plumbing, timing, linguistic metrics, STAR detection, report rendering) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/interview-practice.git
cd interview-practice
python -m http.server 8000
```

Then open http://localhost:8000.

### Configuration

Without an API key the app runs in demo mode with sample model output. To use a live model, open
**Settings → Configure provider** and paste a key for [Groq](https://console.groq.com/keys) or
[OpenRouter](https://openrouter.ai/keys). The key is stored in this browser's `localStorage` (namespaced to
this app) and is sent only to the selected provider.

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 7 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/interview-practice/tests/)).

## Project structure

```
index.html           markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/demo.js          sample responses used when no API key is configured
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- Web Speech API (recognition + synthesis)
- Regex-based discourse analysis
- Streaming-free turn-based state machine
- Answer analytics, scoring, follow-ups, competency tagging, story matching and job-description parsing in src/core.js covered by unit tests run in the browser and in CI
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
