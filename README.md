<div align="center">
  <img src="images/logo.png" width="128" height="128" alt="Byte Coder AI Logo" />
  <h1>Byte Coder AI Agent</h1>
  <p>
    <b>🚀 Agentic AI Coding Assistant with Intelligent Context Awareness</b>
  </p>
  
  [![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/uthakkan.byte-coder-ai-agent?style=for-the-badge&color=28a745)](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)
[![License](https://img.shields.io/github/license/ajmal-uk/byte-coder-ai-agent?style=for-the-badge&color=orange)](LICENSE)

  <br />
  
  [![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/ajmal.uk)
[![PayPal](https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.com/ncp/payment/AWQFP73AKV4SN)

  <br />
  <i>Powered by a Multi-Agent Architecture for Superior Code Understanding</i>
</div>

<br />

> **Byte Coder** is not just another AI chat extension — it's an **intelligent coding agent** that deeply understands your entire codebase. Using a sophisticated **multi-agent system**, it analyzes your intent, discovers relevant files across your workspace, and extracts precisely the code context needed to give you accurate, project-aware answers 

---

## 📦 Install from VS Code Marketplace

**[👉 Install Byte Coder AI Agent](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)**

Or search for **"Byte Coder AI"** in the VS Code Extensions panel.

---

## ✨ What Makes Byte Coder Different?

Most AI coding tools just send your selected code to an API. **Byte Coder is an agent** — it thinks, searches, and reasons about your entire project before responding.

<table>
<tr>
<td width="50%">

### 🤖 Agentic Intelligence
- **Multi-Agent System** — 4 specialized sub-agents working in concert
- **Semantic Understanding** — knows "login" also means "auth", "session", "signin"
- **AST-Aware Extraction** — finds functions & classes, not just text
- **Parallel Processing** — blazing fast workspace searches

</td>
<td width="50%">

### 💎 Premium Experience
- **Glassmorphism UI** — stunning translucent design
- **Adaptive Theming** — beautiful in Light, Dark, and High Contrast
- **Rich Markdown** — syntax highlighting with MacOS-style code blocks
- **Session History** — searchable conversation archive

</td>
</tr>
</table>

---

## 🧠 Intelligent Agent System

Byte Coder's brain consists of **4 specialized sub-agents** working together:

```mermaid
graph LR
    A[Your Query] --> B[🔍 IntentAnalyzer]
    B --> C[📂 FileFinderAgent]
    C --> D[✂️ CodeExtractorAgent]
    D --> E[⚖️ RelevanceScorerAgent]
    E --> F[🤖 AI Response]
    
    style B fill:#3b82f6,stroke:#fff,color:#fff
    style C fill:#10b981,stroke:#fff,color:#fff
    style D fill:#f59e0b,stroke:#fff,color:#fff
    style E fill:#8b5cf6,stroke:#fff,color:#fff
```

| Agent | What It Does |
|-------|--------------|
| **🔍 IntentAnalyzer** | Understands your query with semantic expansion — "database" finds "sql", "prisma", "orm" |
| **📂 FileFinderAgent** | Discovers relevant files using fuzzy matching and intelligent scoring |
| **✂️ CodeExtractorAgent** | Uses AST-aware parsing to extract complete functions and classes |
| **⚖️ RelevanceScorerAgent** | Ranks results with multi-factor scoring and smart context budgeting (25KB) |

### 🎯 Smart Features

- **Semantic Expansion** — Your keywords automatically expand to related terms
- **Symbol Detection** — Recognizes `camelCase`, `PascalCase`, and `snake_case` patterns
- **Query Type Detection** — Adjusts search strategy for fix/explain/refactor/test
- **Import Awareness** — Always includes relevant imports for complete context

---

## 🚀 Key Features

### 💬 Natural Language Chat
Talk to your codebase like you would to a senior developer.

| Feature | Description |
|---------|-------------|
| **@ File Mentions** | Type `@` to reference any file directly in your query |
| **/ Slash Commands** | Quick access to `/explain`, `/fix`, `/refactor`, `/test`, `/optimize`, `/security` |
| **Live Streaming** | See AI responses as they're generated in real-time |
| **Session Persistence** | Never lose your conversation history |

### ⚡ One-Click Context Menu Actions
Right-click any code selection:

| Action | Shortcut | Description |
|--------|----------|-------------|
| 🕵️ **Explain** | `Cmd+Alt+E` | Plain-English breakdown of complex logic |
| 🐛 **Find Bugs** | `Cmd+Alt+F` | Deep analysis of potential issues |
| 🔨 **Refactor** | `Cmd+Alt+R` | Modernize and optimize code |
| 🧪 **Generate Tests** | — | Auto-create unit tests (Jest, Mocha, PyTest) |
| 📝 **Generate Docs** | — | Auto-generate JSDoc/docstrings |
| 🔒 **Security Audit** | — | Find vulnerabilities and suggest fixes |
| ⚡ **Optimize** | — | Performance improvements |

### 🎨 Premium UI

- **Glassmorphism Design** — Translucent panels with blur effects
- **Fluid Animations** — Smooth transitions and micro-interactions
- **MacOS-Style Code Blocks** — Window dots + copy/insert buttons
- **PRO Badge** — Visual indicator of advanced capabilities

---

## 💻 Quick Start

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)
2. **Click** the Byte Coder icon in your sidebar
3. **Start chatting!**

### Example Queries

```
# Understand code
What does the handleUserMessage function do?

# Reference specific files
@SearchAgent.ts explain the search pipeline

# Use slash commands
/fix the error in ChatViewProvider
/refactor this to use async/await
/test generate tests for FileFinderAgent
/security check for vulnerabilities
```

---

## ⚙️ Configuration

Access via `Settings > Extensions > Byte Coder AI`

| Setting | Description | Default |
|---------|-------------|---------|
| `byteAI.customInstructions` | Custom persona/behavior instructions | `""` |
| `byteAI.autoContext` | Auto-gather relevant context | `true` |
| `byteAI.debugSearchAgent` | Show search debug info | `false` |

---

## 🏗️ Architecture

```
src/
├── agents/                     # 🤖 Multi-Agent System
│   ├── IntentAnalyzer.ts      # Query understanding & semantic expansion
│   ├── FileFinderAgent.ts     # Intelligent file discovery
│   ├── CodeExtractorAgent.ts  # AST-aware code extraction
│   ├── RelevanceScorerAgent.ts # Multi-factor scoring
│   └── index.ts               # Barrel export
├── SearchAgent.ts             # 🎯 Agent Orchestrator
├── ChatViewProvider.ts        # 💬 Chat UI Controller
├── ChatViewHtml.ts            # 🎨 Premium UI Components
├── ContextManager.ts          # 📦 Context Management
├── byteAIClient.ts            # 🌐 AI Backend Client
└── extension.ts               # 🚀 VS Code Entry Point
```

---

## 🔮 Roadmap

- [ ] **Code Actions** — Apply AI suggestions directly to files
- [ ] **Multi-file Editing** — Edit multiple files in one command
- [ ] **Git Integration** — Understand changes and generate commit messages
- [ ] **Custom Models** — Support for local/custom LLM backends
- [ ] **Voice Input** — Talk to your code

---

## ❤️ Support This Project

If Byte Coder helps you code faster, consider supporting its development!

<div align="center">
  <a href="https://www.buymeacoffee.com/ajmal.uk">
    <img src="https://img.shields.io/badge/☕_Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" />
  </a>
  &nbsp;&nbsp;
  <a href="https://www.paypal.com/ncp/payment/AWQFP73AKV4SN">
    <img src="https://img.shields.io/badge/💳_Donate_via_PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal Donate" />
  </a>
</div>

<br />

Your support helps me:
- 🚀 Add new features faster
- 🐛 Fix bugs and improve stability
- 📚 Create better documentation
- ☕ Stay caffeinated while coding!

---

## 🏢 Built by UTHAKKAN

**UTHAKKAN** is a technology studio building the next generation of developer tools.

<div align="center">
  <h3>👨‍💻 Ajmal U K</h3>
  <p><i>Full Stack Developer & Founder</i></p>
  <p>
    <a href="https://github.com/ajmal-uk">
      <img src="https://img.shields.io/badge/GitHub-100000?style=flat&logo=github&logoColor=white" alt="GitHub" />
    </a>
    &nbsp;
    <a href="https://uthakkan.pythonanywhere.com">
      <img src="https://img.shields.io/badge/Website-4285F4?style=flat&logo=google-chrome&logoColor=white" alt="Website" />
    </a>
    &nbsp;
    <a href="mailto:contact.uthakkan@gmail.com">
      <img src="https://img.shields.io/badge/Email-D14836?style=flat&logo=gmail&logoColor=white" alt="Email" />
    </a>
  </p>
</div>

---

## 📄 License

MIT License — See [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>© 2025 UTHAKKAN. Building the future of code.</sub>
  <br /><br />
  <b>⭐ Star this repo if Byte Coder helps you code faster!</b>
  <br /><br />
  <a href="https://www.buymeacoffee.com/ajmal.uk">
    <img src="https://img.buymeacoffee.com/button-api/?text=Support Development&emoji=☕&slug=ajmal.uk&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Support Development" />
  </a>
</div>
