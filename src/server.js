import "dotenv/config";
import express from "express";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { makeCrispClient } from "./crispClient.js";
import { exportAll } from "./exporter.js";
import { zipFiles } from "./zip.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/", express.static(path.join(__dirname, "..", "public"))); // serves /config.html

const PORT = process.env.PORT || 1234;
const IDENTIFIER = process.env.CRISP_PLUGIN_IDENTIFIER;
const KEY = process.env.CRISP_PLUGIN_KEY;
if (!IDENTIFIER || !KEY) {
  console.error("Missing CRISP_PLUGIN_IDENTIFIER / CRISP_PLUGIN_KEY");
  process.exit(1);
}

const crisp = makeCrispClient({ identifier: IDENTIFIER, key: KEY });

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /export
 * Body:
 * {
 *   website_id: "uuid",              // required
 *   filters: {
 *     people: true, conversations: true, messages: true, pages: false, events: false, files: false,
 *     perPage: 50,
 *     dateStart: "2025-01-01",       // optional, ISO date
 *     dateEnd:   "2025-10-20"        // optional, ISO date
 *   }
 * }
 */
app.post("/export", async (req, res) => {
  try {
    const websiteId = (req.body.website_id || process.env.TRUSTED_WEBSITE_ID || "").trim();
    if (!websiteId) return res.status(400).json({ error: "website_id required" });

    const filters = {
      people: !!req.body?.filters?.people,
      conversations: !!req.body?.filters?.conversations,
      messages: !!req.body?.filters?.messages,
      pages: !!req.body?.filters?.pages,
      events: !!req.body?.filters?.events,
      files: !!req.body?.filters?.files,
      perPage: Math.max(20, Math.min(50, parseInt(req.body?.filters?.perPage || 50, 10))),
      dateStart: req.body?.filters?.dateStart || null,
      dateEnd: req.body?.filters?.dateEnd || null
    };

    const { files, tmpDir } = await exportAll({ client: crisp, websiteId, filters });

    const zipName = `crisp-export-${Date.now()}.zip`;
    const zipPath = path.join(tmpDir, zipName);
    await zipFiles({ files, outPath: zipPath });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    const stream = fs.createReadStream(zipPath);
    stream.on("close", async () => {
      try {
        for (const f of files) fs.unlinkSync(f);
        fs.unlinkSync(zipPath);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    });
    stream.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Crisp CSV Export plugin running on http://localhost:${PORT}`);
});
