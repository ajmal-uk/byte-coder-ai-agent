# Byte Coder Ai Agent

![Version](https://img.shields.io/badge/version-0.0.2-blue) ![License](https://img.shields.io/badge/license-MIT-green)

**Byte Coder Ai Agent** is an elite, context-aware coding assistant for VS Code. It is designed to act as a **Senior Software Architect**, helping you write production-grade code, fix bugs, and generate documentation with ease.

## 🚀 Features

### 1. 🧠 Elite Context Awareness
Byte Coder Ai Agent doesn't just chat; it **sees** what you are working on.
- **Active File Analysis**: It reads your current file to understand the context.
- **Smart Diagnostics**: It automatically detects **compiler errors** (red squigglies) and suggests fixes without you having to copy-paste the error message.
- **Selection Awareness**: Highlight any code to focus the AI's attention on just that block.

### 2. ⚡ Slash Commands
Speed up your workflow with dedicated commands:
- **/explain**: Get a detailed breakdown of how the selected code works.
- **/fix**: Analyze the selected code for bugs (and compile errors) and get a corrected version.
- **/doc**: Generate professional JSDoc/Docstrings for functions and classes.

### 3. 🛠️ Secure Command Line Access
The agent can execute shell commands to help you manage your project (e.g., `ls`, `npm install`, `git status`).
- **Safety First**: It will *always* ask for your explicit permission via a dialog box before running any command.
- **Transparent**: You see exactly what command will be executed.

### 4. 🎨 Premium Chat Interface
- Integrated directly into the VS Code Sidebar.
- Clean, dark-mode optimized UI with syntax highlighting.
- Native VS Code look and feel.

## 📦 Installation

### From VSIX
1.  Download the latest `.vsix` release.
2.  Open VS Code.
3.  Go to the **Extensions** view (`Cmd+Shift+X`).
4.  Click the `...` menu and select **Install from VSIX...**.
5.  Select `byte-coder-ai-agent-0.0.2.vsix`.

### From Source (Development)
1.  Clone the repository:
    ```bash
    git clone https://github.com/ajmal-uk/byte-coder-ai-agent.git
    cd byte-coder-ai-agent
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the extension:
    Press `F5` to open the Extension Development Host.

## 📖 Usage

1.  **Open the Chat**: Click the `Byte AI` icon in the Activity Bar.
2.  **Ask Questions**: Type naturally, e.g., *"Refactor this function to be async"*.
3.  **Use Context Menu**: Right-click any code selection and choose:
    - `Byte AI: Explain Selection`
    - `Byte AI: Fix Bugs`
    - `Byte AI: Generate Docs`

## 🔒 Security Policy
- **Data Privacy**: Your code is sent to the configured AI backend only when you interact with the chat.
- **Command Execution**: No command is run without user approval.

## 🤝 Contributing
Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 👨‍💻 Author
Created by **Ajmal U K** (uthalkkan).
