<div align="center">
  <a href="images/logo.png">
    <img src="images/logo.png" width="128" height="128" alt="Byte Coder AI Logo" />
  </a>
  <h1>Byte Coder AI Agent</h1>
  <h3>The Autonomous Software Engineer for VS Code</h3>
  
  <p>
    <b>Plan. Execute. Verify.</b><br/>
    <i>Powered by Multi-Agent "Think-Act-Verify" Architecture</i>
  </p>

  [![Version](https://img.shields.io/visual-studio-marketplace/v/uthakkan.byte-coder-ai-agent?style=flat-square&color=blue)](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)
  [![Installs](https://img.shields.io/visual-studio-marketplace/i/uthakkan.byte-coder-ai-agent?style=flat-square&color=success)](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)
  [![Rating](https://img.shields.io/visual-studio-marketplace/r/uthakkan.byte-coder-ai-agent?style=flat-square&color=orange)](https://marketplace.visualstudio.com/items?itemName=uthakkan.byte-coder-ai-agent)
</div>

<br/>

> **Byte Coder** is not just a chat extension — it is an **autonomous software engineering agent** capable of handling complex development tasks end-to-end. It understands your codebase, plans multi-step solutions, executes file operations, and verifies its own work.

---

## 📸 Experience Byte Coder

<div align="center">
  <i>Click any image to view in full resolution (Overlay Mode)</i>
</div>
<br/>

<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="images/screenshots/chat.png">
        <img src="images/screenshots/chat.png" alt="Byte Coder Chat Interface" width="400" />
      </a>
      <br/>
      <sub><b>Intelligent Chat Interface</b><br/>Context-aware conversations with your codebase</sub>
    </td>
    <td width="50%" align="center" valign="middle">
      <table border="0">
        <tr>
          <td align="center">
            <a href="images/screenshots/history.png">
              <img src="images/screenshots/history.png" alt="Session History" width="200" />
            </a>
            <br/><sub><b>Session History</b></sub>
          </td>
        </tr>
        <tr>
          <td align="center">
            <br/>
            <a href="images/screenshots/models.png">
              <img src="images/screenshots/models.png" alt="Model Selection" width="200" />
            </a>
            <br/><sub><b>Model Management</b></sub>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<br/>

<div align="center">
  <table border="0">
    <tr>
      <td align="center">
        <a href="images/screenshots/settings.png">
          <img src="images/screenshots/settings.png" alt="Settings Interface" width="500" />
        </a>
        <br/>
        <sub><b>Comprehensive Configuration</b></sub>
      </td>
    </tr>
  </table>
</div>

---

## 🚀 Why Byte Coder?

Most AI tools are passive text generators. **Byte Coder is an active agent.**

| Feature | Description |
| :--- | :--- |
| **🧠 Think-Act-Verify** | It doesn't just guess code; it plans a solution, writes the files, and checks for errors. |
| **📂 Deep Context** | Automatically discovers relevant files, reads imports, and understands project structure. |
| **🛡️ Safe Execution** | All file operations are presented for your review before execution. |
| **⚡ Parallel Agents** | Multiple specialized sub-agents work in parallel to solve tasks faster. |

---

## 🛠️ Core Capabilities

### 1. Autonomous Task Execution (New in v1.0.3)
Byte Coder can handle complex requests like *"Create a React component for UserProfile and add it to the router"*:

*   **Manager Agent**: Analyzes your request and determines the intent.
*   **Architect Agent**: Designs the system structure if needed.
*   **Task Planner**: Breaks the goal into a dependency graph of executable tasks.
*   **Execution Engine**: Writes code, runs commands, and modifies files.

### 2. Intelligent Codebase Search
Stop manually copy-pasting files. Byte Coder finds what it needs:
*   **Semantic Search**: Finds code by concept (e.g., "auth logic" finds `LoginController.ts`).
*   **AST Extraction**: Reads full function definitions and class structures.
*   **Smart Context**: Auto-includes relevant imports and types.

### 3. Premium Developer Experience
*   **Glassmorphism UI**: Beautiful, translucent interface that fits right into modern VS Code.
*   **Slash Commands**: Quick actions like `/fix`, `/refactor`, `/test`, `/explain`.
*   **One-Click Actions**: Right-click any code to Explain, Refactor, or Find Bugs.

---

## 🏗️ Multi-Agent Architecture

Byte Coder operates as a system of specialized agents, each with a distinct role:

<details>
<summary><b>Click to view Architecture Diagram</b></summary>
<br/>

```mermaid
graph TD
    User[User Request] --> Manager[Manager Agent]
    Manager -->|Complex Task| Architect[Architect Agent]
    Manager -->|Simple Task| Planner[Task Planner]
    Architect --> Planner
    Planner -->|Task Graph| Orchestrator[Execution Orchestrator]
    
    subgraph Execution Engine
    Orchestrator --> CodeGen[Code Generator]
    Orchestrator --> Executor[Command Executor]
    Orchestrator --> QA[QA Agent]
    end
    
    Execution Engine -->|Result| Verify[Verification]
    Verify -->|Success| User
    Verify -->|Fail| Planner
```
</details>

### The "Pipeline" Process
1.  **Phase 0: Manager Analysis** - Determines if the request is a simple question or a complex build task.
2.  **Phase 1: Planning** - The **Task Planner** creates a Directed Acyclic Graph (DAG) of necessary steps.
3.  **Phase 2: Execution** - Agents run in parallel where possible to write code, install dependencies, and fix errors.
4.  **Phase 3: Verification** - The agent validates the output against the original requirements.

---

## ⚡ Shortcuts & Commands

Access Byte Coder features instantly with keyboard shortcuts and slash commands.

| Action | Shortcut (Mac) | Shortcut (Win/Linux) | Command |
| :--- | :--- | :--- | :--- |
| **Quick Ask** | `Cmd+Alt+A` | `Ctrl+Alt+A` | `byteAI.quickAsk` |
| **Explain Code** | `Cmd+Alt+E` | `Ctrl+Alt+E` | `byteAI.explainCode` |
| **Refactor** | `Cmd+Alt+R` | `Ctrl+Alt+R` | `byteAI.refactorCode` |
| **Fix Bugs** | `Cmd+Alt+F` | `Ctrl+Alt+F` | `byteAI.fixCode` |

> **Tip**: You can also right-click any code selection and choose **Byte AI** from the context menu to access **Security Audit**, **Code Review**, **Optimize Performance**, and more.

---

## ⚙️ Configuration

Customize Byte Coder in `Settings > Extensions > Byte Coder AI`:

| Setting | Description | Default |
| :--- | :--- | :--- |
| `byteAI.customInstructions` | Define your preferred coding style or persona | `""` |
| `byteAI.autoContext` | Enable autonomous file discovery | `true` |
| `byteAI.autoExecute` | Allow creating files without confirmation (simple tasks only) | `true` |
| `byteAI.useLocalModel` | Use local Ollama model instead of Cloud API | `false` |
| `byteAI.localModelName` | Specify local model name (e.g., `llama3`, `mistral`) | `llama3` |
| `byteAI.debugSearchAgent` | Show debug info for search operations | `false` |

---

## 📦 Installation

1.  Open VS Code Extensions (`Cmd+Shift+X`).
2.  Search for **"Byte Coder AI"**.
3.  Click **Install**.
4.  Open the Byte Coder sidebar icon to start.

---

<div align="center">
  <p>Made with ❤️ by <b>Ajmal U K</b></p>
  <p><i>The Future of Coding is Agentic.</i></p>
</div>
