#!/usr/bin/env node
/**
 * khaliljerro (LinkedIn Profile) → Buffer daily queue top-up
 * -----------------------------------------------------------------------
 * Standalone automation for the personal LinkedIn Profile "khaliljerro" —
 * shares a Buffer account with the "Voxvibes International" LinkedIn Page
 * + Facebook Page, but that one has its own separate repo and different,
 * evergreen content. Kept apart on purpose so the two never mix.
 *
 * DATED content (not evergreen): the Drive folder has year subfolders
 * (2026, 2027, ...) — same structure as the LAYA repos, just with
 * abbreviated month folder names ("08_aug" instead of "08_august"). The
 * parser here reads the leading number on the folder name directly, so it
 * doesn't care whether the rest is spelled out or abbreviated.
 *
 * Filenames: "DD_<monabbrev><DD>_<slug>.png", e.g.
 * "21_aug21_help-someone-who-can-never-repay.png" — the slug becomes that
 * day's caption (title-cased).
 *
 * Runs unattended (e.g. via GitHub Actions cron, or any daily cron job).
 * Each run:
 *   1. Discovers year folders under ROOT_FOLDER_ID, then month folders,
 *      then PNGs — no folder IDs hardcoded, new years/months picked up
 *      automatically.
 *   2. Figures out which dates are still missing from the Buffer queue.
 *   3. Schedules as many as the account's plan limit allows, earliest date
 *      first.
 *   4. Posts at POST_TIME_LOCAL in POST_UTC_OFFSET.
 *
 * Because Buffer plans cap total *scheduled* (not yet sent) posts, this
 * script is safe to run every day forever — as old posts publish, slots
 * free up and the next unscheduled day gets queued automatically.
 *
 * Required environment variables (set as repo/CI secrets):
 *   BUFFER_API_KEY        Personal API key for this Buffer account
 *   BUFFER_ORG_ID         This Buffer account's organization ID
 *   BUFFER_CHANNEL_ID     The LinkedIn Profile channel ID (single channel)
 *   GOOGLE_DRIVE_API_KEY  API key with Drive API enabled (read-only is fine)
 *   ROOT_FOLDER_ID        Drive folder ID containing year folders like "2026"
 * Optional:
 *   BUFFER_MIN_DATE        Skip any date before this (YYYY-MM-DD).
 *   POST_TIME_LOCAL        Default "19:00:00" (7 PM)
 *   POST_UTC_OFFSET        Default "+08:00" (Asia/Manila)
 *   DRY_RUN                 "true" to log without creating posts
 *
 * Requires Node.js 18+ (uses global fetch).
 */

const BUFFER_API_KEY = requireEnv("BUFFER_API_KEY");
const ORG_ID = requireEnv("BUFFER_ORG_ID");
const CHANNEL_ID = requireEnv("BUFFER_CHANNEL_ID");
const DRIVE_API_KEY = requireEnv("GOOGLE_DRIVE_API_KEY");
const ROOT_FOLDER_ID = requireEnv("ROOT_FOLDER_ID");

const MIN_DATE = process.env.BUFFER_MIN_DATE || null;
const POST_TIME_LOCAL = process.env.POST_TIME_LOCAL || "19:00:00";
const POST_UTC_OFFSET = process.env.POST_UTC_OFFSET || "+08:00";
const DRY_RUN = process.env.DRY_RUN === "true";

const BUFFER_GRAPHQL_URL = "https://api.buffer.com/graphql";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Google Drive helpers
// ---------------------------------------------------------------------------
async function listSubfolders(folderId) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "q",
    `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("key", DRIVE_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Drive folder list failed for ${folderId}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files || [];
}

async function listDriveFolderFiles(folderId) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId}' in parents and mimeType = 'image/png' and trashed = false`);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("key", DRIVE_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Drive file list failed for folder ${folderId}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files || [];
}

// Parses "21_aug21_help-someone-who-can-never-repay.png" ->
// { day: 21, slug: "help-someone-who-can-never-repay" }
function parseFilename(name) {
  const m = name.match(/^(\d{1,2})_[a-z]+\d{1,2}_(.+)\.png$/i);
  if (!m) return null;
  return { day: parseInt(m[1], 10), slug: m[2] };
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Parses a month folder name by reading its leading number, e.g.
// "08_aug" -> "08". Works regardless of whether the rest of the name is
// abbreviated ("aug") or spelled out ("august") — no month-name mapping
// needed, just the digits are used.
function parseMonthFolderNumber(name) {
  const m = name.match(/^(\d{1,2})_/);
  if (!m) return null;
  return String(parseInt(m[1], 10)).padStart(2, "0");
}

// Discovers ROOT_FOLDER_ID/<year>/<NN_month>/*.png and builds a calendar:
// { "2026-08-21": { fileId, title }, ... }
async function buildCalendar() {
  const calendar = {};
  const yearFolders = await listSubfolders(ROOT_FOLDER_ID);

  for (const yearFolder of yearFolders) {
    if (!/^\d{4}$/.test(yearFolder.name)) {
      console.warn(`Skipping non-year folder under root: ${yearFolder.name}`);
      continue;
    }
    const year = yearFolder.name;
    const monthFolders = await listSubfolders(yearFolder.id);

    for (const monthFolder of monthFolders) {
      const monthNum = parseMonthFolderNumber(monthFolder.name);
      if (!monthNum) {
        console.warn(`Skipping unrecognized month folder: ${year}/${monthFolder.name}`);
        continue;
      }

      const files = await listDriveFolderFiles(monthFolder.id);
      for (const f of files) {
        const parsed = parseFilename(f.name);
        if (!parsed) {
          console.warn(`Skipping file with unexpected name: ${year}/${monthFolder.name}/${f.name}`);
          continue;
        }
        const dateKey = `${year}-${monthNum}-${String(parsed.day).padStart(2, "0")}`;
        calendar[dateKey] = { fileId: f.id, title: titleFromSlug(parsed.slug) };
      }
    }
  }

  return calendar;
}

// ---------------------------------------------------------------------------
// Buffer GraphQL helpers
// ---------------------------------------------------------------------------
async function bufferRequest(query, variables) {
  const res = await fetch(BUFFER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BUFFER_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Buffer API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

async function getOrgScheduledPostLimit() {
  const query = `
    query Account {
      account { organizations { id limits { scheduledPosts } } }
    }
  `;
  const data = await bufferRequest(query, {});
  const org = data.account.organizations.find((o) => o.id === ORG_ID);
  return org ? org.limits.scheduledPosts : 10;
}

async function getScheduledDates(channelId) {
  const query = `
    query Posts($organizationId: OrganizationId!, $channelIds: [ChannelId!]) {
      posts(input: { organizationId: $organizationId, filter: { channelIds: $channelIds, status: [scheduled] } }, first: 100) {
        edges { node { dueAt } }
      }
    }
  `;
  const data = await bufferRequest(query, { organizationId: ORG_ID, channelIds: [channelId] });
  return new Set(data.posts.edges.map((e) => e.node.dueAt.slice(0, 10)));
}

async function createPost({ channelId, fileId, title, dueAtIso }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id status dueAt } }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
        ... on UnexpectedError { message }
      }
    }
  `;
  const input = {
    channelId,
    mode: "customScheduled",
    schedulingType: "automatic",
    dueAt: dueAtIso,
    text: title,
    assets: [
      {
        image: {
          url: `https://lh3.googleusercontent.com/d/${fileId}`,
          metadata: { altText: title },
        },
      },
    ],
    // LinkedIn Profile posts don't require an explicit "type" the way
    // Facebook/Instagram do — no extra metadata needed here.
  };
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would create post: channel=${channelId} dueAt=${dueAtIso} title="${title}"`);
    return;
  }
  const data = await bufferRequest(mutation, { input });
  const payload = data.createPost;
  if (payload.message) {
    throw new Error(`createPost failed: ${payload.message}`);
  }
  console.log(`Scheduled: channel=${channelId} dueAt=${dueAtIso} title="${title}" -> post ${payload.post.id}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Run started ${new Date().toISOString()}${DRY_RUN ? " [DRY RUN]" : ""}`);

  const calendar = await buildCalendar();
  const sortedDates = Object.keys(calendar).sort();
  console.log(`Loaded ${sortedDates.length} days of content from Drive.`);

  const limit = await getOrgScheduledPostLimit();
  console.log(`Buffer scheduled-post limit per channel: ${limit}`);
  if (MIN_DATE) {
    console.log(`Minimum date: ${MIN_DATE} (earlier dates skipped)`);
  }

  const today = new Date().toISOString().slice(0, 10);

  const scheduledDates = await getScheduledDates(CHANNEL_ID);
  let scheduledCount = scheduledDates.size;
  console.log(`Channel ${CHANNEL_ID}: ${scheduledCount}/${limit} slots currently used.`);

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  for (const dateKey of sortedDates) {
    if (scheduledCount >= limit) break;
    if (dateKey < today) continue;
    if (MIN_DATE && dateKey < MIN_DATE) continue;
    if (scheduledDates.has(dateKey)) continue;

    const { fileId, title } = calendar[dateKey];
    const dueAtIso = `${dateKey}T${POST_TIME_LOCAL}${POST_UTC_OFFSET}`;

    try {
      await createPost({ channelId: CHANNEL_ID, fileId, title, dueAtIso });
      scheduledCount++;
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`Failed to schedule ${dateKey}: ${err.message}`);
      consecutiveFailures++;
      if (/limit/i.test(err.message)) break;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`Stopping after ${consecutiveFailures} consecutive failures.`);
        break;
      }
    }
  }

  console.log("Run complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
