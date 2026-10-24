// Tidies a direction-attributed transcript: punctuation, casing, and grouping
// consecutive lines from the same direction into turns.
//
// What this endpoint is NOT allowed to do is change what anyone said. The raw
// transcript is the honest record; this is a readability pass over it. The
// schema and the system prompt both enforce that, and the client keeps the raw
// version either way.
//
// The API key lives only here, in a server-side environment variable. It is
// never sent to the browser.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// Opus 5 thinks by default; this is a formatting job, so run it at low effort.
const MODEL = 'claude-opus-5';
const MAX_LINES = 150;
const MAX_CHARS = 24000;
const MAX_TOKENS = 8000;

// Vercel would otherwise cut us off at 10s.
export const config = { maxDuration: 60 };

const Tidied = z.object({
  turns: z.array(z.object({
    direction: z.string().describe('Copied verbatim from the input line. Never invented, never changed.'),
    text: z.string().describe('The same words as the input, with punctuation and casing fixed.'),
    uncertain: z.boolean().describe('True if the input direction was an uncertainty label, or the words were unintelligible.'),
  })),
});

const SYSTEM = `You clean up a transcript so it is easier to read. You are not a summariser, a translator, or an editor.

The transcript comes from two separate sources, and you must respect the boundary between them:
- "direction" is what a wearable cap measured. It is a measurement, not a guess you may revise.
- "text" is what the wearer's phone or laptop microphone heard. It may be garbled; that is expected.

You MAY:
- add punctuation and sentence breaks
- fix capitalisation, including proper nouns and the word "I"
- merge consecutive lines from the SAME direction that are obviously one interrupted sentence

You MUST NOT:
- add, remove, replace, reorder or "correct" any word
- guess at words that are unintelligible - keep them exactly as given and set uncertain: true
- infer, name, or label who is speaking
- change a direction, or invent one for a line that has an uncertainty label
- merge lines from different directions, however well they read together

Direction labels that are uncertainty states, not directions: "direction unclear",
"cap heard no voice", "no cap connected". Copy them through unchanged and set uncertain: true.

If you are unsure whether a change is allowed, do not make it. An unpolished true transcript
is worth more than a polished one that puts words in somebody's mouth.`;

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'POST only.');

  // Public endpoint once deployed: only answer our own pages.
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const sameHost = origin === '' || origin.endsWith(host) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  if (!sameHost) return fail(res, 403, 'Not allowed from this origin.');

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(res, 503, 'Tidying is not configured on this deployment. The transcript itself is unaffected.');
  }

  let lines = req.body && req.body.lines;
  if (typeof req.body === 'string') {
    try { lines = JSON.parse(req.body).lines; } catch { return fail(res, 400, 'Could not read the request.'); }
  }
  if (!Array.isArray(lines) || !lines.length) return fail(res, 400, 'No transcript to tidy.');

  // Keep the request bounded regardless of what the client sends.
  const trimmed = lines.slice(-MAX_LINES).map((l) => ({
    direction: String(l.direction || '').slice(0, 60),
    text: String(l.text || '').slice(0, 600),
  }));
  const payload = JSON.stringify(trimmed);
  if (payload.length > MAX_CHARS) return fail(res, 413, 'That transcript is too long to tidy in one go.');

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      output_config: {
        format: zodOutputFormat(Tidied),
        effort: 'low',
      },
      messages: [{
        role: 'user',
        content: `Tidy this transcript. Return one entry per resulting turn, in order.\n\n${payload}`,
      }],
    });

    if (response.stop_reason === 'refusal') {
      return fail(res, 422, 'The model declined to process this transcript.');
    }
    const out = response.parsed_output;
    if (!out || !Array.isArray(out.turns)) return fail(res, 502, 'Tidying returned nothing usable.');

    return res.status(200).json({ turns: out.turns });
  } catch (err) {
    // Most specific first, so a rate limit is not reported as a generic failure.
    if (err instanceof Anthropic.RateLimitError) return fail(res, 429, 'Rate limited. Try again in a moment.');
    if (err instanceof Anthropic.AuthenticationError) return fail(res, 500, 'Tidying is misconfigured on the server.');
    if (err instanceof Anthropic.BadRequestError) return fail(res, 400, 'That transcript could not be processed.');
    if (err instanceof Anthropic.APIError) return fail(res, 502, 'The tidying service is unavailable right now.');
    console.error('tidy failed:', err);
    return fail(res, 500, 'Tidying failed.');
  }
}
