# AED Readiness Campaign — Think Health

A standalone Next.js replacement for the Google Form: a live audit wizard,
PREPARED scoring, SQLite storage, a detailed report per submission, a Good
Samaritan Warrior certificate, and a full **Form Builder admin panel** —
every section, question, option, image, and point value is editable from
the browser, with no code changes and no redeploy.

## How the form works now

Nothing about the 40-question audit is hardcoded anymore. It's data:

- **`form_sections`** — the 12 sections (General Details, AED Status, the
  eight PREPARED sections, Good Samaritan). Each has a title, note, letter,
  a `supplementary`/`unscored` flag, and an optional visibility rule
  ("only show this section if question X was answered Y").
- **`form_questions`** — every question: type (radio / checkbox / dropdown /
  text / email / phone / date / linear scale), label, hint, required flag,
  an `unscored` flag (counts toward nothing — for optional/inventory-only
  fields), and for checkboxes, a selection cap that can be a fixed number or
  **linked to another question's numeric answer** (this is what powers
  "select exactly as many AED models as AEDs installed").
- **`form_options`** — every answer choice: label, sub-label, point value,
  an uploaded image, and a free-text flag ("Other — please specify").

The wizard (`components/AuditWizard.jsx`) and the scoring engine
(`lib/genericScoring.js`) both just read this structure and render/score
whatever's there. Add a question, delete a section, rewrite every point
value — the live form and the score totals update automatically.

## Using the Form Builder

1. Sign in at `/admin`, click **Edit form** (or go straight to
   `/admin/builder`).
2. The top bar shows the live point budget (PREPARED max / Supplementary
   max / Total) — it recalculates as you edit, so you can see the effect
   of a change immediately.
3. Sections start collapsed (there are 12, and the hotel dropdown alone has
   150+ options) — click the ▸ to expand one. Each question's option list
   also collapses on its own if it has more than 8 options.
4. Every text field saves on blur (click away or press Enter); checkboxes
   and dropdowns save immediately. There's no separate "Save" button.
5. **Images**: click "Image" next to any option to upload a replacement —
   it's stored under `public/uploads/` and swapped in immediately.
6. **Reordering**: the ↑/↓ buttons move a section, question, or option
   relative to its siblings.
7. **Visibility rules**: a section's "Visible only if" dropdown lists every
   radio/dropdown question in the form; pick one and the value it must
   equal. This is how "no AED installed" skips straight past all the
   equipment sections to Good Samaritan.
8. **Certificate gates**: any radio/dropdown question can be flagged
   "Certificate gate" with a required answer — the Good Samaritan Warrior
   certificate is awarded only when every gated question is answered that
   way. By default that's the CPR-trained and AED-trained questions.
9. **Special roles**: a few questions are tagged (hotel, first/last name,
   email, phone, the AED-installed gate) so the admin submissions list and
   the section-visibility engine can find them regardless of wording changes.

## Scoring model

Nothing is fixed at "80" or "100" anymore — the point totals are whatever
the current form adds up to (shown live in the builder). The default seeded
form happens to total **103**: an 80-point PREPARED core (Physical,
Readiness, Expiry, Paediatric, Training, Regular inspection, Emergency
accessories, Documentation) plus 23 supplementary points (AED Status +
Good Samaritan). Edit any point value and that math updates everywhere —
the wizard, the report page, and the admin totals bar.

## Running locally

```bash
npm install
cp .env.local.example .env.local   # then set a real ADMIN_PASSWORD
npm run dev
```

Visit `http://localhost:3000` for the audit wizard. Data lives in
`data/aed.db` (SQLite, created and seeded automatically on first run,
gitignored). Delete that file to reset the form back to the original
default content.

Admin: `http://localhost:3000/admin` — sign in with `ADMIN_PASSWORD` from
`.env.local`. **Change it from the default `changeme` before this goes
anywhere near the internet.**

## Project layout

- `lib/seedFormData.js` — the default 40-question content, used once to
  populate an empty database. Editing this file has no effect after the
  first run — use the Form Builder for ongoing changes.
- `lib/db.js` — SQLite schema (sections/questions/options/submissions) +
  all CRUD used by both the public wizard and the admin API routes.
- `lib/genericScoring.js` — scoring, validation, visibility, and the
  linked-max-selections logic. The single source of truth; both the
  submissions API and the report page call it.
- `lib/adminAuth.js` — password check + signed cookie for `/admin`.
- `components/AuditWizard.jsx` — renders whatever `getFormSchema()` returns;
  no question-specific code.
- `components/FormBuilder.jsx` — the admin editing UI.
- `app/api/admin/*` — section/question/option CRUD + image upload, all
  behind `isAdminAuthed()`.
- `app/report/[id]/page.js` — the detailed report + certificate, computed
  fresh from the schema and the stored answers (so editing the form later
  doesn't corrupt old reports — they just stop matching new sections).

## Deploying so hotel staff can reach it online

**Important:** this app stores data (submissions **and** uploaded images)
on local disk. That only works on a host with a **persistent filesystem** —
it will silently lose data on serverless platforms with ephemeral storage
(e.g. Vercel's default runtime). Pick a host that gives the Node process a
real, persistent disk:

- **Render** (straightforward, has a free persistent-disk tier for small apps)
- **Railway**
- **Fly.io** (attach a volume)
- Any plain VPS (DigitalOcean, Lightsail, etc.) running `npm run build && npm start`

General steps (Render as the concrete example):

1. Push this project to a GitHub repo (not done yet — this directory isn't
   a git repo. `git init`, commit, and create a GitHub repo when you're
   ready; ask before pushing anywhere public — the repo would include
   whatever images you've uploaded, though never the actual password).
2. On Render: **New → Web Service**, connect the repo.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Add a **persistent disk**, mounted so both `data/` and
     `public/uploads/` survive redeploys (e.g. mount at
     `/opt/render/project/src` or symlink those two directories onto the disk).
   - Environment variable: `ADMIN_PASSWORD=<something real>`
3. Once deployed, hotel staff hit the service's public URL directly for
   the wizard; you use `/admin` and `/admin/builder` for management.

If you'd rather I scaffold a `Dockerfile` and a `render.yaml` / `fly.toml`
for one of these, say which host and I'll add it — didn't want to guess
your provider and commit you to one.
