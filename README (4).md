# khaliljerro (LinkedIn Profile) → Buffer daily queue top-up

Standalone automation for the personal LinkedIn Profile **"khaliljerro"**.
Shares a Buffer account with the "Voxvibes International" LinkedIn Page +
Facebook Page, but that one has its own separate repo and different,
evergreen content — kept apart on purpose.

## Content structure
**Dated**, not evergreen — year folders (`2026`, `2027`) same as LAYA, but
with abbreviated month folder names (`08_aug` instead of `08_august`).
The script reads the leading number on the folder name directly, so it
works with either style.

Filenames: `DD_<monabbrev><DD>_<slug>.png`, e.g.
`21_aug21_help-someone-who-can-never-repay.png`.

## One-time setup

### 1. Buffer API key
Same Buffer account as Voxvibes — reuse the key if you already generated
one for that repo.

### 2. Google Drive API key
Reuse the one from other repos, or create a new one.

### 3. IDs you need
- `BUFFER_ORG_ID`: `6a6bb7e222ee22698fb4d1ef`
- `BUFFER_CHANNEL_ID`: `6a6bb8cd4b2d03035f6eb05f` (LinkedIn Profile
  "khaliljerro")
- `ROOT_FOLDER_ID`: `1Jw-wRMfkZG_uQDM0gl2Wihw5U30OJQEF`

Make sure this folder is shared as **"Anyone with the link — Viewer"**.

### 4. Minimum date (optional)
Leave `BUFFER_MIN_DATE` unset unless you manually schedule something
first and want to avoid duplicates.

### 5. Create the GitHub repo and add secrets
1. New repo, e.g. `khaliljerro-buffer-scheduler`.
2. Upload `schedule-khaliljerro-posts.js`,
   `.github/workflows/schedule-khaliljerro-posts.yml`, and this
   `README.md` (keep the `.github/workflows/` path intact).
3. Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `BUFFER_API_KEY` | your Buffer API key (same as Voxvibes repo) |
| `BUFFER_ORG_ID` | `6a6bb7e222ee22698fb4d1ef` |
| `BUFFER_CHANNEL_ID` | `6a6bb8cd4b2d03035f6eb05f` |
| `GOOGLE_DRIVE_API_KEY` | your Drive API key |
| `ROOT_FOLDER_ID` | `1Jw-wRMfkZG_uQDM0gl2Wihw5U30OJQEF` |

### 6. Test it
**Actions → "Top up khaliljerro Buffer queue" → Run workflow → check
dry_run → Run.** Then run for real once you're happy with the log.

## Notes
- Posting time defaults to 7:00 PM Manila.
- Adding future years: just create `<year>/<NN_month>/` folders with
  matching filenames — no code changes needed.
