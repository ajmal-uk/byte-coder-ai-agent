# Contributing to Byte Coder AI Agent

First off, huge thanks for investing your time in contributing to Byte Coder! 🙌

We are building an **agentic AI coding assistant** with a sophisticated multi-agent architecture. Your contributions help push the boundaries of what's possible in AI-assisted development.

---

## 🧠 Understanding the Architecture

Byte Coder uses a **multi-agent system** for intelligent code context extraction:

```
src/
├── agents/                     # 🤖 Sub-Agent System
│   ├── IntentAnalyzer.ts      # Query understanding & semantic expansion
│   ├── FileFinderAgent.ts     # Intelligent file discovery
│   ├── CodeExtractorAgent.ts  # AST-aware code extraction
│   ├── RelevanceScorerAgent.ts # Multi-factor scoring
│   └── index.ts               # Barrel export
├── SearchAgent.ts             # 🎯 Orchestrates sub-agents
├── ChatViewProvider.ts        # 💬 Chat UI controller
├── ChatViewHtml.ts            # 🎨 Premium UI components
├── ContextManager.ts          # 📦 Context management
├── byteAIClient.ts            # 🌐 AI backend client
└── extension.ts               # 🚀 VS Code entry point
```

---

## 🛠️ How to Contribute

### 1. Fork & Clone

```bash
git clone https://github.com/ajmal-uk/byte-coder-ai-agent.git
cd byte-coder-ai-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a Branch

```bash
git checkout -b feature/amazing-new-feature
# or
git checkout -b fix/annoying-bug
```

### 4. Development & Debugging

1. Open the project in **VS Code**
2. Press **F5** to start the Extension Development Host
3. Make changes; reload the host (`Cmd+R` / `Ctrl+R`) to see updates

### 5. Compile & Test

```bash
npm run compile     # TypeScript compilation
npm run watch       # Watch mode for development
```

### 6. Commit Guidelines

Use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat(agents): add import graph analysis to CodeExtractor"
git commit -m "fix(ui): resolve code block copy button not working"
git commit -m "docs: update README with new features"
```

### 7. Submit a Pull Request

- Describe your changes clearly
- Link to related issues
- Include screenshots/GIFs for UI changes

---

## 📐 Coding Standards

| Area | Guideline |
|------|-----------|
| **TypeScript** | Strict mode. Avoid `any`. Use proper interfaces. |
| **Async** | Prefer `async/await` over raw promises |
| **Agents** | New agents should implement a consistent interface |
| **UI** | Use VS Code theme variables for colors |
| **Comments** | Document complex logic, not obvious code |

---

## 🔧 Key Areas for Contribution

- **New Sub-Agents** — Add agents for specific tasks (e.g., GitAgent, TestAgent)
- **Language Support** — Extend AST patterns in `CodeExtractorAgent.ts`
- **UI Improvements** — Enhance the chat experience in `ChatViewHtml.ts`
- **Performance** — Optimize search and caching strategies
- **Documentation** — Improve README, add tutorials

---

## 🐛 Found a Bug?

[Open an issue](https://github.com/ajmal-uk/byte-coder-ai-agent/issues) with:
1. Steps to reproduce
2. Expected vs. actual behavior
3. Screenshots or logs

---

Thank you for helping us build the future of AI-assisted coding! 🚀
