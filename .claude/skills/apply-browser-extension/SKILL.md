---
name: apply-browser-extension
description: Apply through the user's own signed-in browser with the Claude in Chrome extension or the Claude desktop Browser pane - LinkedIn Easy Apply, Indeed smartapply, Reed, TotalJobs, CV-Library, resolving LinkedIn "apply on company site" links, and forms that need a real browser or a file upload. Includes the captcha handoff for in-browser flows. Use for every job in the browser lane.
---

# Apply in the user's browser

Claude Code only (Codex: use the headless driver `skills/apply-ats` with `"headed": true`, or hand the row to the user).
The user signs in to each board once in their own Chrome. Claude never signs in, never creates an account, never types
a password. A signed-out board: log `needs-user-login-<board>` once per session and move on.

## Which tool

- **Claude in Chrome extension** (`mcp__claude-in-chrome__*`): real Chrome, can upload files (`file_upload`), best for
  anything that needs a CV upload or real-browser trust.
- **Browser pane** in the Claude desktop app (`mcp__Claude_Browser__*`): keeps board sessions, can't upload files.
  Good for discovery, triage, Easy Apply with a stored CV.
- `file_upload` only accepts files under the project folder or the session scratchpad: copy the PDF there first,
  delete the copy afterwards.

## Universal mechanics

- Load browser tools in one batch; re-inject page helpers after every navigation (navigation wipes `window.*`).
- JS calls die at about 45 s: keep each call to a handful of fetches, or start an async job writing to `window.__x`
  and poll it. The extension blanks outputs containing URLs, query strings or `@`: return `host ## path` pieces and
  rebuild URLs yourself.
- React inputs often ignore `form_input` and synthetic values: use the native value setter plus `input`/`change`
  events, or focus and type real keys. **Read every value back** after setting it.
- If the screenshot frame and the page viewport differ, every coordinate click misses: `resize_window` to match the
  screenshot frame, take a fresh screenshot, `scrollIntoView({block:'center'})`, click the element's rect centre.
  Screenshots can lag one action: take two before deciding a click failed.
- A background or hidden tab renders 0x0 and stalls ("Preparing review"): bring it to the front first.
- To upload into a hidden file input: make it visible (or give it an `aria-label`) via JS, re-run `find`, then
  `file_upload`.

## LinkedIn Easy Apply

- Use the role-family CV variant (not a per-job build). The resume list is ordered by last use: pick the card by exact
  filename **and** upload date, read the selected card back before Next and again on Review.
- The modal is not a normal `[role=dialog]`: it can sit in a shadow root or a top-layer `<dialog>`. Find it with a
  recursive shadow-root walker, or by its "Apply to <company>" text. Next / Review / Submit respond to clicking the last
  visible matching button.
- Re-derive every saved answer from the profile each time (years, notice, salary): saved answers are often wrong.
  Numeric screeners reject text ("Invalid input" shows only after Next): enter digits only (`pay.numeric_salary_answer`).
  Years questions: the true number from `experience.by_skill`; "N+ years" you don't have = No.
- Radios have empty labels; click the visible control, wait a second, re-read that exactly one is checked
  (ids re-render after each click).
- Untick the pre-ticked "Follow <company>" box on the Review page and confirm it is unticked.
- **Success** = the "Your application was sent" dialog, or "Application submitted" on the reloaded job page.
  The "We couldn't submit your application" toast is a **false negative**: never retry on it; reload the job page and
  read the application status.
- LinkedIn throttles Easy Apply at roughly 25-30 per rolling day; the button still shows, the limit dialog appears
  only after clicking. Log `deferred-easyapply-limit` (not skipped) and stop Easy Apply for the day.
- "Apply on company website" rows (`unresolved` lane): open the job page, read the real Apply link, add the decoded URL
  to the queue and send it to `skills/apply-ats`. Rebuild `routes.py` output if you resolve many.

## Indeed smartapply

Works in real Chrome; often Cloudflare-walled in the pane (never try to pass the wall). Steps: contact, CV (stored
or upload), employer questions, review, "Submit your application". Pick the `Continue` that is actually visible
(many hidden ones exist). An invisible reCAPTCHA badge is normal; a visible "I'm not a robot" box with Submit disabled
is the captcha handoff. "Apply on company site" goes through `uk.indeed.com/applystart?jk=<jk>`; route that URL to
apply-ats.

## Reed, TotalJobs, CV-Library

- These boards send the **last uploaded CV** by default. After any CV change, re-upload explicitly on the first apply
  on each board and check the "added <date>" label.
- Reed: "Session expired" is a hidden dialog always present in the DOM; it only counts when visible. Verify success with
  "You applied for this job" on the job page. Agency posts can be click-throughs to an external ATS (route to apply-ats).
- TotalJobs: reach job pages from a search page (direct navigation can fail). The sticky Apply appears after scrolling.
  Smart-apply is prefilled from the account: check the phone and CV; leave "get contacted by employers" unticked.
  "Send application" may ignore JS clicks: use a real click. Success `/application/confirmation/success` or
  "Already applied" on the job page. Employer posts that say "apply directly" go to the company ATS.
- CV-Library: never use one-click apply while the stored CV is out of date.

## Captcha in the browser

Same handoff as the driver: stop, leave the page open and filled, alert the user through your session (Claude Code
push notification / message they follow on the phone app; macOS banner fallback) with the job and link: "solve the
captcha in the Chrome window on your computer, I'll continue". Poll with screenshots or `find` every few seconds for up
to `captcha.wait_minutes`; when the challenge is gone, continue and submit. On timeout log `needs-user-captcha` with
the URL and what is already filled. Never click into the captcha, never read its code from email.

Quick test for overlays: if `document.elementFromPoint()` at the Submit button's centre returns the button itself,
nothing is covering it; if it returns a captcha iframe, it's a real challenge.

## Email verification codes

Only if `limits.allow_reading_inbox_for_codes` is true: open the user's inbox in a tab, search the ATS sender, copy the
code (they expire in about 10 minutes; resend has a cooldown), check the link host matches the ATS host, enter it.
Never for captcha codes or sign-in codes, never send email. Otherwise park `needs-user-otp`.

## Log

Append one row per application to `data/batches/<date>-browser.csv` (`skills/tracker-and-handoff`), including which CV
variant was selected.
