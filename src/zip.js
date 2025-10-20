import fs from "node:fs";
import archiver from "archiver";

/** Creates a ZIP from a set of file paths; returns {zipPath} */
export async function zipFiles({ files, outPath }) {
  await fs.promises.mkdir(new URL(".", outPath).pathname || ".", { recursive: true }).catch(() => {});
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve({ zipPath: outPath }));
    archive.on("error", reject);

    archive.pipe(output);
    for (const f of files) archive.file(f, { name: f.split("/").pop() });
    archive.finalize();
  });
}
