# TypeScript Native Preview LSP Inspector

This repo contains an LSP inspector that proxies between an LSP client and the `tsgo` LSP server (`@typescript/native-preview`). It transparently forwards all LSP messages while logging them to `lsp-inspector.log` in the project directory. This is useful for debugging LSP communication issues, such as those encountered with the GitHub Copilot CLI.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) installed and authenticated

## Setup

1. **Clone the repo and install dependencies:**

   ```bash
   git clone https://github.com/golf1052/GitHubCopilotCliTypescriptNativeDemo.git
   cd GitHubCopilotCliTypescriptNativeDemo
   npm install
   ```

2. **Build the inspector:**

   ```bash
   npm run build
   ```

   This compiles `src/lsp-inspector.ts` using `tsgo` and outputs `dist/lsp-inspector.js`.

## Configuring GitHub Copilot CLI to Use the Inspector

Add the inspector as an LSP server in your Copilot CLI configuration. You can configure it at the **user level** or **repository level**:

- **User-level:** Edit `~/.copilot/lsp-config.json`
- **Repository-level:** Create `.github/lsp.json` in this repository root

Add the following configuration (replace `<path-to-this-repo>` with the absolute path to this cloned repo):

```json
`{
  "lspServers": {
    "tsgo-inspector": {
      "command": "node",
      "args": ["<path-to-this-repo>/GitHubCopilotCliTypescriptNativeDemo/dist/lsp-inspector.js", "--lsp", "-stdio"],
      "fileExtensions": {
        ".ts": "typescript",
        ".tsx": "typescriptreact",
        ".js": "javascript",
        ".jsx": "javascriptreact"
      }
    }
  }
}`
```

## Usage

1. **Start Copilot CLI** in a project directory that contains TypeScript/JavaScript files:

   ```bash
   copilot
   ```

2. **Interact with your code** — any LSP requests (hover, go-to-definition, diagnostics, etc.) will be proxied through the inspector to `tsgo`.

3. **Inspect the log** — all LSP messages are logged to `lsp-inspector.log` in this repo's directory:

   ```bash
   # Follow the log in real-time
   tail -f lsp-inspector.log        # macOS/Linux
   Get-Content lsp-inspector.log -Wait   # PowerShell
   ```

### Log Format

Messages are logged in a human-readable format:

```
=====================================
[2026-03-03T21:24:57.233Z] CLIENT → SERVER
-------------------------------------
Content-Length: 107

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "capabilities": {},
    "rootUri": null,
    "processId": null
  }
}
=====================================
```

## Verifying LSP Server Status

Inside a Copilot CLI session, run the `/lsp` command to confirm that the `typescript-native` LSP server is connected and running.
