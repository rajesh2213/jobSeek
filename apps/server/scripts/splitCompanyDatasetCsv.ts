/**
 * Split a large company CSV (same format as seedCompaniesFromCSV) into smaller files
 * for upload to a small VPS: seed one file, remove it, repeat with the next.
 * Streams input so multi-hundred-MB exports do not load entirely into RAM.
 *
 * Usage:
 *   npm run split:company-csv -w @jobseek/server
 *   npm run split:company-csv -w @jobseek/server -- --rows 500
 *
 * Then on the server per batch:
 *   COMPANY_CSV_PATH=data/company-datasets/split/companies-01.csv npm run seed:csv -w @jobseek/server
 */
import fs, { createReadStream, type WriteStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

function serverRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..");
}

function parseArgs(argv: string[]): {
  input: string;
  outDir: string;
  rowsPerFile: number;
} {
  let input = "";
  let outDir = "";
  let rowsPerFile = 500;

  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--in" && argv[i + 1]) {
      input = argv[++i]!;
      continue;
    }
    if (t === "--out" && argv[i + 1]) {
      outDir = argv[++i]!;
      continue;
    }
    if ((t === "--rows" || t === "--rows-per-file") && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n >= 1) rowsPerFile = Math.floor(n);
      continue;
    }
  }

  const root = serverRootDir();
  if (!input) {
    input = path.join(root, "data", "company-datasets", "Wellfound_Final.csv");
  } else if (!path.isAbsolute(input)) {
    input = path.join(process.cwd(), input);
  }

  if (!outDir) {
    outDir = path.join(path.dirname(input), "split");
  } else if (!path.isAbsolute(outDir)) {
    outDir = path.join(process.cwd(), outDir);
  }

  return { input, outDir, rowsPerFile };
}

function chunkFileName(index1: number): string {
  return `companies-${String(index1).padStart(2, "0")}.csv`;
}

function closeStream(ws: WriteStream | null): Promise<void> {
  if (!ws) return Promise.resolve();
  return new Promise((resolve, reject) => {
    ws.end((err) => (err ? reject(err) : resolve()));
  });
}

async function main(): Promise<void> {
  const { input, outDir, rowsPerFile } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(input)) {
    console.error(`Input not found: ${input}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const stream = createReadStream(input, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  let header = "";
  let part = 0;
  let rowsInPart = 0;
  let dataRows = 0;
  let out: WriteStream | null = null;

  const startNewFile = async (): Promise<void> => {
    await closeStream(out);
    part += 1;
    const fp = path.join(outDir, chunkFileName(part));
    out = fs.createWriteStream(fp, { encoding: "utf8" });
    out.write(header + "\n");
    rowsInPart = 0;
  };

  for await (const rawLine of rl) {
    lineNo += 1;
    const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    if (lineNo === 1) {
      header = line;
      if (!header.trim()) {
        console.error("Empty CSV header");
        process.exit(1);
      }
      continue;
    }
    if (!line.length) continue;

    if (!out || rowsInPart >= rowsPerFile) {
      await startNewFile();
    }
    out!.write(line + "\n");
    rowsInPart += 1;
    dataRows += 1;
  }

  await closeStream(out);

  if (lineNo < 1 || !header) {
    console.error("CSV has no header");
    process.exit(1);
  }
  if (dataRows === 0) {
    console.error("No data rows");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        event: "split_company_csv_done",
        input,
        outDir,
        dataRows,
        rowsPerFile,
        filesWritten: part,
        names: `${chunkFileName(1)} … ${chunkFileName(part)}`,
      },
      null,
      2,
    ),
  );
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
