[![CI](https://github.com/jlynshue/Sheila/actions/workflows/ci.yml/badge.svg)](https://github.com/jlynshue/Sheila/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Sheila

![Sheila banner](docs/assets/roxanne-banner.png)

**Local-first research copilot with voice — fork of Roxanne**

Talk to your Zotero library and Obsidian vaults via voice or text using Anthropic Claude, OpenAI GPT, or local Ollama models. Sheila indexes and embeds your entire research database, then uses agentic MCP to search, read, and update your knowledge base—all offline and private.

> **Quick start (macOS / Linux):**
> ```bash
> curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
> ```
> See [Install](#install) for Windows and options.

## Features at a Glance

- **Multi-model inference** — Claude (Bedrock), GPT-4, Ollama (local) via unified interface
- **Voice input/output** — STT (Unmute) + TTS (AWS Bedrock) for hands-free research
- **Zotero integration** — Search your library, pull annotations, cite papers inline via MCP
- **Obsidian integration** — Query your vault, link notes, surface connections via MCP
- **Offline-first** — Vector embeddings indexed locally (FastEmbed), no cloud dependency for search
- **Streaming responses** — Server-Sent Events for real-time generation
- **Conversation persistence** — Full chat history with search and export
- **Cross-platform** — macOS, Windows, Linux (Electron + Python backend)

## Interface

The desktop app is organized into four working surfaces:

- **Chat interface** — model selector, streaming markdown rendering, and citation links
- **Voice mode** — real-time STT indicator and TTS playback controls
- **Research panel** — Zotero results, Obsidian note connections, and web search
- **Settings** — model configuration, voice engine selection, and index management

## How It Differs from Roxanne

Sheila is forked from [Roxanne](https://github.com/TylerIllman/Roxanne) with significant additions:

| Area | Roxanne | Sheila |
|------|---------|--------|
| **LLM support** | OpenAI only | Claude (Bedrock) + GPT-4 + Ollama with runtime switching |
| **Voice** | None | Full STT/TTS pipeline (Unmute + AWS Bedrock TTS) |
| **Tool system** | Hardcoded integrations | MCP-based agentic orchestration (Zotero, Obsidian) |
| **Search** | Cloud-dependent | FastEmbed local vector indexing, offline-first |
| **Architecture** | Monolithic backend | Modular router-based FastAPI with separated concerns |
| **Streaming** | Polling | SSE-based real-time responses |

## What This Fork Adds

This fork extends the upstream Roxanne research copilot with:

- **Multi-model support** — Claude Bedrock, GPT-4, and local Ollama via a dynamic model dropdown, with runtime switching (no restart) and selection persisted across sessions
- **Full voice pipeline** — a `useVoiceMode` hook wiring Unmute audio input and AWS Bedrock TTS output
- **Agentic MCP tooling** — MCP orchestration for multi-step research workflows across Zotero and Obsidian
- **Modular backend** — monolithic `main.py` split into focused router modules (orchestration, embedding, search, Zotero MCP, Obsidian MCP) with cleaner error handling
- **Refactored React UI** — `App.tsx` broken into focused, reusable component modules, plus debug-logging and transcription-callback fixes for stability

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Shell                          │
│                    (Main Process)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    React UI Layer                           │
│  ┌──────────────────┬──────────────────┬─────────────────┐  │
│  │  Voice Input     │  Text Interface  │  Model Selector │  │
│  │  (useVoiceMode)  │  (Chat UI)       │  (Dropdown)     │  │
│  └──────────────────┴──────────────────┴─────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────────┐
│              FastAPI Backend (Python)                       │
│  ┌────────────┬──────────────┬─────────────┬──────────────┐ │
│  │ Orchestr.  │ Embeddings   │ Zotero MCP  │ Obsidian MCP │ │
│  │ Router     │ Router       │ Router      │ Router       │ │
│  └────────────┴──────────────┴─────────────┴──────────────┘ │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────────┐ │
│  │  FastEmbed (Vector Database)                           │ │
│  │  Local Index of Zotero + Obsidian Content              │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐    ┌─────▼──────┐  ┌──────▼──────┐
   │ Anthropic│    │  OpenAI    │  │ Ollama      │
   │ Bedrock  │    │  (GPT-4)   │  │ (Local)     │
   └──────────┘    └────────────┘  └─────────────┘
```

## Install

The install scripts pull the latest published Sheila release for your platform and install it for you.

### macOS or Linux

```bash
curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install-windows.ps1 | iex
```

### Optional Install Flags

Install a specific version:

```bash
SHEILA_VERSION=v0.2.0 curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
```

Install without auto-opening the app:

```bash
SHEILA_NO_OPEN=1 curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
```

After install, launch from your terminal:

```bash
sheila
```

On macOS and Linux, the launcher is installed into `~/.local/bin`. Add it to your `PATH` if needed.

## Develop Locally

### Prerequisites

- Python 3.10+
- Node.js 20+
- Optional: [Ollama](https://ollama.com) for local models

### Clone the Repo

```bash
git clone https://github.com/jlynshue/Sheila.git
cd Sheila
```

### Quick Setup

```bash
npm run setup
```

This creates `apps/backend/.venv`, installs the editable backend with test dependencies, and installs desktop dependencies.

### Manual Setup

**Backend:**

```bash
python3 -m venv apps/backend/.venv
source apps/backend/.venv/bin/activate
pip install -e "./apps/backend[test]"
```

Windows PowerShell:

```powershell
py -3 -m venv apps/backend/.venv
.\apps\backend\.venv\Scripts\Activate.ps1
pip install -e ".\apps\backend[test]"
```

**Frontend:**

```bash
npm install
```

### Run in Development

Full app:

```bash
npm run open:desktop
```

Separate processes (easier debugging):

```bash
npm run debug:backend       # FastAPI backend with reload
npm run debug:frontend      # React dev server
npm run debug:desktop       # Electron shell (needs backend running)
npm run debug:full          # Backend + Electron together
```

### Build the App

Ensure backend dependencies include build tools:

```bash
source apps/backend/.venv/bin/activate
pip install -e "./apps/backend[build]"
```

Build unpacked release:

```bash
SHEILA_PYTHON_BIN="$PWD/apps/backend/.venv/bin/python3" npm run pack:desktop
```

Build installer for your platform:

```bash
SHEILA_PYTHON_BIN="$PWD/apps/backend/.venv/bin/python3" npm run dist:desktop
```

Outputs go to `apps/desktop/release`.

### Run Tests

**Backend tests:**

```bash
source apps/backend/.venv/bin/activate
python -m pytest apps/backend/tests -m "not slow and not integration"
```

**Desktop type-check:**

```bash
npm --workspace apps/desktop run lint
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Desktop** | Electron | Cross-platform app shell |
| **UI** | React + TypeScript | Component-based interface with type safety |
| **Backend** | FastAPI (Python) | REST API and orchestration |
| **Embeddings** | FastEmbed | Fast, local vector embeddings |
| **Vector DB** | Built-in | Indexed embeddings of research library |
| **LLM** | Claude (Bedrock) / GPT-4 / Ollama | Multi-model inference |
| **Voice** | Unmute + AWS Bedrock TTS | Audio input and speech synthesis |
| **Research Integration** | MCP (Model Context Protocol) | Agentic Zotero and Obsidian access |
| **Package Manager** | npm (frontend) + pip (backend) | Dependency management |

## Project Layout

```text
apps/
  backend/            FastAPI backend, indexing, orchestration, routers
  desktop/            Electron shell and React renderer
scripts/
  build-backend-binary.mjs
  install.sh
  install-windows.ps1
docs/assets/
  roxanne-banner.png
```

## Credits

**Forked from [Roxanne](https://github.com/TylerIllman/Roxanne)** by [Tyler Illman](https://github.com/TylerIllman)

This fork extends Roxanne with voice integration, multi-model support, and architectural improvements for production use.

## Author

[**Jonathan Lyn-Shue**](https://jonathanlynshue.com) — Fractional CIO/CTO | Data & AI Executive

---

## License

MIT — See LICENSE file for details.
