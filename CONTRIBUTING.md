# Contributing to Byte Coder

First off, huge thanks for investing your time in contributing to Byte Coder! 🙌

We are committed to building the best AI coding assistant, and your help makes that possible. Whether you're fixing a bug, improving documentation, or proposing a new feature, you're welcome here.

## 🛠️ How to Contribute

### 1. Fork & Clone
Fork the repository to your own GitHub account, then clone it locally:

```bash
git clone https://github.com/ajmal-uk/byte-coder-ai-agent.git
cd byte-coder-ai-agent
```

### 2. Install Dependencies
Make sure you have `npm` installed.

```bash
npm install
```

### 3. Create a Branch
Always create a new branch for your work:

```bash
git checkout -b feature/amazing-new-feature
# or
git checkout -b fix/annoying-bug
```

### 4. Development & Debugging
1.  Open the project in **VS Code**.
2.  Press **F5** to start the extension in a new Extension Development Host window.
3.  Make changes in the source code; assume the "Extension Development Host" window will need a reload (`Cmd+R` or `Ctrl+R`) to see changes.

### 5. Commit Guidelines
We appreciate clear commit messages:

```bash
git commit -m "feat: add support for python refactoring"
# or
git commit -m "fix: resolve crash when context is empty"
```

### 6. Submit a Pull Request (PR)
Push to your fork and verify the changes. Then, go to the original repository and submit a Pull Request.
- Describe your changes clearly.
- Link to any related issues.
- Include screenshots/GIFs if you changed the UI.

## 📐 Coding Standards

- **TypeScript**: We use strict TypeScript. Avoid `any` whenever possible.
- **Linting**: Ensure code is clean. logic should be split into small, functions.
- **Async/Await**: Prefer async/await over promises.

## 🐛 Found a Bug?
If you find a bug, please [open an issue](https://github.com/ajmal-uk/byte-coder-ai-agent/issues) with:
1.  Steps to reproduce.
2.  Expected vs. actual behavior.
3.  Screenshots or logs.

Thank you for helping us build the future of coding! 🚀
