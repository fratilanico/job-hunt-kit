# Cover letters and cover notes

Most forms don't need one. Write one only where the form asks (a cover-letter field or upload) or the posting says
it matters. When you do, it has to sound like the user wrote it on a good day, not like a language model.

## Rules

- **Short.** 120 to 180 words for a form field, one page maximum as a file. Many fields cap at 255 or 300 characters
  or 2,000 characters: count before pasting.
- **Their voice.** Read `profile/voice-sample.md` first (writing they actually did). Match sentence length,
  formality, and the words they use. If they write long sentences chained with commas, so does the letter.
- **No em dashes. No bold. No headings. No bullet lists** in a note.
- **Banned**: "I am writing to express my interest", passionate, excited, thrilled, thrive, journey, leverage,
  robust, seamless, crucial, comprehensive, delve, navigate, ensure, furthermore, moreover, additionally, notably,
  "proven track record", "results-driven", "a perfect fit", "hit the ground running", "X rather than Y" pairs,
  three-item punchy lists, slogans, rhetorical questions. `node cv/voice-lint.mjs letters/<file>.txt` checks most.
- **Facts direct, judgements hedged**: "I cut the backlog by about a third" (fact), "it looks like your team is
  at the point where..." (judgement).
- **One specific line about this employer**, from the JD or their site, no adjectives. If you can't find one, leave
  it out rather than flatter.
- **Only facts from the master CV.** Same no-invention rule as the CV.
- Sign-off: their name and one contact line. Nothing else.

## Shape (adapt, don't fill in blanks mechanically)

1. What role, and the one-sentence reason they are a fit (the main must-have, with proof).
2. The most relevant piece of work in a little more detail: situation, what they did, what changed.
3. One line on this employer, from the JD.
4. Practicalities if useful: location / hybrid, notice, availability.

## Files

- `letters/<company>-<role>.txt`: plain text for paste fields (git-ignored).
- For upload fields, render a one-page PDF from the text (or from an HTML twin) and upload that.
- `letters/example-cover-letter.txt`: an example with placeholders, to show tone and length only.
