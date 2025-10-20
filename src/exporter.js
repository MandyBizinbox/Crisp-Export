import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatISO } from "date-fns";
import { writeCSV } from "./csv.js";

/**
 * Exporter uses the crisp-api client with plugin tier to pull:
 *  - People (profiles)
 *  - Conversations (metadata)
 *  - Messages (by session_id; timestamp_before pagination)
 *  - Pages, Events, Files (per session)
 *
 * All results are CSVs, returned as file paths.
 */
export async function exportAll({ client, websiteId, filters }) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "crisp-export-"));
  const files = [];

  if (filters.people) files.push(await exportPeople({ client, websiteId, dir: tmp }));
  const conversations = (filters.conversations || filters.messages || filters.pages || filters.events || filters.files)
    ? await collectConversations({ client, websiteId, perPage: filters.perPage, dateStart: filters.dateStart, dateEnd: filters.dateEnd })
    : [];

  if (filters.conversations) files.push(await exportConversations({ dir: tmp, conversations }));
  if (filters.messages)     files.push(await exportMessages({ client, websiteId, dir: tmp, conversations }));
  if (filters.pages)        files.push(await exportPages({ client, websiteId, dir: tmp, conversations }));
  if (filters.events)       files.push(await exportEvents({ client, websiteId, dir: tmp, conversations }));
  if (filters.files)        files.push(await exportFiles({ client, websiteId, dir: tmp, conversations }));

  return { files, tmpDir: tmp };
}

/** PEOPLE ********************************************************************/
async function exportPeople({ client, websiteId, dir }) {
  const rows = [];
  let page = 1;
  for (;;) {
    const res = await client.websitePeople.list(websiteId, page); // /people/profiles/{page}
    const data = res?.data || res || [];
    if (!Array.isArray(data) || data.length === 0) break;

    for (const p of data) {
      rows.push({
        people_id: p.people_id ?? "",
        email: p.email ?? "",
        phone: p.phone ?? "",
        nickname: p.nickname ?? "",
        name: p.person ?? "",
        avatar: p.avatar ?? "",
        company: p.company ?? "",
        segments: p.segments ?? [],
        timezone: p.timezone ?? "",
        city: p.geolocation?.city ?? "",
        country: p.geolocation?.country ?? "",
        created_at: p.created_at ?? "",
        updated_at: p.updated_at ?? "",
        data: p.data ?? {},
        notes: p.notes ?? [],
        labels: p.labels ?? []
      });
    }
    page += 1;
    await sleep(200);
  }
  const file = path.join(dir, "people.csv");
  return writeCSV(file, rows);
}

/** CONVERSATIONS **************************************************************/
async function collectConversations({ client, websiteId, perPage = 50, dateStart, dateEnd }) {
  let page = 1;
  const list = [];
  for (;;) {
    const params = { per_page: String(Math.max(20, Math.min(50, perPage))) };
    if (dateStart) params.filter_date_start = dateStart;
    if (dateEnd)   params.filter_date_end = dateEnd;

    const res = await client.websiteConversations.list(websiteId, page, params); // /conversations/{page}
    const data = res?.data || res || [];
    if (!Array.isArray(data) || data.length === 0) break;

    list.push(...data);
    page += 1;
    await sleep(200);
  }
  return list;
}

async function exportConversations({ dir, conversations }) {
  const rows = conversations.map((c) => ({
    session_id: c.session_id ?? "",
    subject: c.subject ?? "",
    created_at: c.created_at ?? "",
    updated_at: c.updated_at ?? "",
    state: c.state ?? "",
    inbox_id: c.inbox_id ?? "",
    origin: c.meta?.origin ?? "",
    website: c.meta?.website ?? "",
    ip: c.meta?.ip ?? "",
    country: c.meta?.country ?? "",
    city: c.meta?.city ?? "",
    email: c.meta?.email ?? "",
    phone: c.meta?.phone ?? "",
    segments: c.segments ?? [],
    participants: c.participants ?? []
  }));
  const file = path.join(dir, "conversations.csv");
  return writeCSV(file, rows);
}

/** MESSAGES ******************************************************************/
async function exportMessages({ client, websiteId, dir, conversations }) {
  const rows = [];
  for (const conv of conversations) {
    const sid = conv.session_id;
    if (!sid) continue;

    let tsBefore = null;
    let guard = 0;
    for (;;) {
      const res = await client.websiteConversations.getMessages(websiteId, sid, tsBefore ? { timestamp_before: tsBefore } : undefined);
      const batch = res?.data || res || [];
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const m of batch) {
        rows.push({
          session_id: sid,
          fingerprint: m.fingerprint ?? "",
          type: m.type ?? "",
          from: m.from ?? "",
          origin: m.origin ?? "",
          timestamp: m.timestamp ?? "",
          content: m.content ?? "",
          to: m.to ?? [],
          cc: m.cc ?? [],
          subject: m.subject ?? "",
          mentions: m.mentions ?? [],
          attachments: m.attachments ?? [],
          meta: m.meta ?? {}
        });
      }

      // page backwards in time using the oldest timestamp we saw
      const oldest = Math.min(...batch.map(x => x.timestamp ?? Number.MAX_SAFE_INTEGER));
      if (!oldest || oldest === tsBefore) break;
      tsBefore = oldest;
      guard += batch.length;
      if (guard > 100000) break; // soft cap per conversation
      await sleep(200);
    }
  }
  const file = path.join(dir, "messages.csv");
  return writeCSV(file, rows);
}

/** PAGES / EVENTS / FILES ****************************************************/
async function exportPages({ client, websiteId, dir, conversations }) {
  const rows = [];
  for (const conv of conversations) {
    const sid = conv.session_id;
    if (!sid) continue;
    let page = 1;
    for (;;) {
      const res = await client.websiteConversations.listPages(websiteId, sid, page);
      const data = res?.data || res || [];
      if (!Array.isArray(data) || data.length === 0) break;
      for (const p of data) {
        rows.push({
          session_id: sid,
          page_title: p.page_title ?? "",
          page_url: p.page_url ?? "",
          timestamp: p.timestamp ?? "",
          ip: p.ip ?? "",
          country: p.country ?? ""
        });
      }
      page += 1;
      await sleep(150);
    }
  }
  const file = path.join(dir, "pages.csv");
  return writeCSV(file, rows);
}

async function exportEvents({ client, websiteId, dir, conversations }) {
  const rows = [];
  for (const conv of conversations) {
    const sid = conv.session_id;
    if (!sid) continue;
    let page = 1;
    for (;;) {
      const res = await client.websiteConversations.listEvents(websiteId, sid, page);
      const data = res?.data || res || [];
      if (!Array.isArray(data) || data.length === 0) break;
      for (const e of data) {
        rows.push({
          session_id: sid,
          text: e.text ?? "",
          data: e.data ?? {},
          timestamp: e.timestamp ?? ""
        });
      }
      page += 1;
      await sleep(150);
    }
  }
  const file = path.join(dir, "events.csv");
  return writeCSV(file, rows);
}

async function exportFiles({ client, websiteId, dir, conversations }) {
  const rows = [];
  for (const conv of conversations) {
    const sid = conv.session_id;
    if (!sid) continue;
    let page = 1;
    for (;;) {
      const res = await client.websiteConversations.listFiles(websiteId, sid, page);
      const data = res?.data || res || [];
      if (!Array.isArray(data) || data.length === 0) break;
      for (const f of data) {
        rows.push({
          session_id: sid,
          name: f.name ?? "",
          type: f.type ?? "",
          url: f.url ?? "",
          fingerprint: f.fingerprint ?? "",
          timestamp: f.timestamp ?? ""
        });
      }
      page += 1;
      await sleep(150);
    }
  }
  const file = path.join(dir, "files.csv");
  return writeCSV(file, rows);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
