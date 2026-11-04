---
name: cover-letter
description: Write a short cover letter or cover note in the user's own voice for one application, only where the form or posting asks for one. Use when an application form has a cover-letter field or upload, or the user asks for a letter.
---

# Cover letter

1. Confirm a letter is actually needed (a cover-letter field, a required upload, or the JD asks). If optional and the
   user hasn't asked for letters, skip it.
2. Read `letters/GUIDE.md`, `profile/voice-sample.md`, the JD (`out/<company>-<role>/jd.txt` if tailoring ran) and the
   tailored CV or the master CV. Use only facts from the master.
3. Draft to `letters/<company-slug>-<role-slug>.txt`, 120 to 180 words (or the field's character limit).
4. `node cv/voice-lint.mjs letters/<file>.txt` until clean. Then read it aloud in your head as the user: would they
   send this? Cut anything that sounds like a template.
5. For an upload field, render a one-page PDF (plain, same fonts as the CV theme) and upload that; for a text field,
   paste the .txt. Check the field's character limit before pasting.
6. When `autonomy` is `confirm_each` or `draft_only`, show the letter with the filled form.
7. Note `letter letters/<file>.txt` in the tracker row.
