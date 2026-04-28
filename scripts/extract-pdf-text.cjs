const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { PDFParse } = require("pdf-parse");

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    throw new Error("Missing PDF path.");
  }

  const workerPath = path.join(path.dirname(require.resolve("pdf-parse")), "pdf.worker.mjs");
  PDFParse.setWorker(pathToFileURL(workerPath).href);

  const buffer = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    process.stdout.write(JSON.stringify({ text: result.text.trim() }));
  } finally {
    await parser.destroy();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});
