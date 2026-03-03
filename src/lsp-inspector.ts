import { spawn, ChildProcess } from "node:child_process";
import { createWriteStream, WriteStream } from "node:fs";
import { Readable, Writable } from "node:stream";
import { resolve } from "node:path";

const HEADER_DELIMITER = "\r\n\r\n";

// Resolve the log file path to always be in the project directory
const projectDir = resolve(__dirname, "..");
const logFilePath = resolve(projectDir, "lsp-inspector.log");

type Direction = "CLIENT → SERVER" | "SERVER → CLIENT";

/**
 * Parse LSP base-protocol messages from a stream and invoke a callback for each complete message.
 * Messages are framed as: Content-Length: <n>\r\n\r\n<body>
 */
class LspMessageReader {
  private buffer = Buffer.alloc(0);
  private contentLength: number | null = null;

  constructor(
    private readonly source: Readable,
    private readonly onMessage: (header: string, body: string) => void,
    private readonly onClose: () => void
  ) {
    source.on("data", (chunk: Buffer) => this.onData(chunk));
    source.on("end", () => this.onClose());
    source.on("error", () => this.onClose());
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (true) {
      if (this.contentLength === null) {
        // Look for the header delimiter
        const delimIdx = this.buffer.indexOf(HEADER_DELIMITER);
        if (delimIdx === -1) return;

        const headerStr = this.buffer.subarray(0, delimIdx).toString("utf-8");
        const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
        if (!match) {
          // Malformed header — skip past delimiter and try again
          this.buffer = this.buffer.subarray(delimIdx + HEADER_DELIMITER.length);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        // Keep the full header (including delimiter) for faithful forwarding
        this.buffer = this.buffer.subarray(delimIdx + HEADER_DELIMITER.length);
      }

      // We know the content length — wait until we have enough bytes
      if (this.buffer.length < this.contentLength) return;

      const body = this.buffer.subarray(0, this.contentLength).toString("utf-8");
      const header = `Content-Length: ${this.contentLength}`;
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = null;

      this.onMessage(header, body);
    }
  }
}

/**
 * Write a framed LSP message to a writable stream.
 */
function writeLspMessage(dest: Writable, header: string, body: string): void {
  const msg = `${header}${HEADER_DELIMITER}${body}`;
  dest.write(msg);
}

/**
 * Log a message to the log file in human-readable format.
 */
function logMessage(
  logStream: WriteStream,
  direction: Direction,
  header: string,
  body: string
): void {
  const timestamp = new Date().toISOString();
  let prettyBody: string;
  try {
    prettyBody = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    prettyBody = body;
  }

  const entry = [
    "=====================================",
    `[${timestamp}] ${direction}`,
    "-------------------------------------",
    header,
    "",
    prettyBody,
    "=====================================",
    "",
  ].join("\n");

  logStream.write(entry);
}

function main(): void {
  // Open the log file in append mode
  const logStream = createWriteStream(logFilePath, { flags: "a" });
  logStream.write(
    `\n${"=".repeat(50)}\nLSP Inspector started at ${new Date().toISOString()}\n${"=".repeat(50)}\n\n`
  );

  // Resolve tsgo binary — use the one from node_modules
  const tsgoPath = resolve(projectDir, "node_modules", ".bin", "tsgo");

  // Spawn the real tsgo LSP server
  const child: ChildProcess = spawn(tsgoPath, ["--lsp", "-stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: projectDir,
    shell: process.platform === "win32",
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    process.stderr.write("Failed to spawn tsgo child process\n");
    process.exit(1);
  }

  // Forward stderr from tsgo to our stderr and the log file
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    const text = chunk.toString("utf-8");
    const timestamp = new Date().toISOString();
    logStream.write(
      [
        "=====================================",
        `[${timestamp}] SERVER STDERR`,
        "-------------------------------------",
        text.trimEnd(),
        "=====================================",
        "",
      ].join("\n")
    );
  });

  // CLIENT → SERVER: read from our stdin, log, forward to child stdin
  new LspMessageReader(
    process.stdin,
    (header, body) => {
      logMessage(logStream, "CLIENT → SERVER", header, body);
      writeLspMessage(child.stdin!, header, body);
    },
    () => {
      // Client closed — close child stdin
      child.stdin!.end();
    }
  );

  // SERVER → CLIENT: read from child stdout, log, forward to our stdout
  new LspMessageReader(
    child.stdout,
    (header, body) => {
      logMessage(logStream, "SERVER → CLIENT", header, body);
      writeLspMessage(process.stdout, header, body);
    },
    () => {
      // Server closed stdout — nothing more to send to client
    }
  );

  // Handle child process exit
  child.on("exit", (code) => {
    logStream.write(
      `\ntsgo process exited with code ${code}\n`
    );
    logStream.end(() => {
      process.exit(code ?? 1);
    });
  });

  child.on("error", (err) => {
    logStream.write(`\ntsgo process error: ${err.message}\n`);
    process.stderr.write(`tsgo process error: ${err.message}\n`);
    logStream.end(() => {
      process.exit(1);
    });
  });

  // Handle our own process signals
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
}

main();
