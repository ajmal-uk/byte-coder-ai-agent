import { ChatViewHtml } from "./ChatViewHtml";

import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';
import { ContextManager } from './ContextManager';
import { SearchAgent } from './SearchAgent';
import { AgentOrchestrator } from './core';
import { ManagerAgent } from './core/ManagerAgent';
import { PipelineEngine } from './core/PipelineEngine';
import { LongTermMemory } from './agents/LongTermMemory';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _contextManager: ContextManager;
    private _searchAgent: SearchAgent;
    private _agentOrchestrator: AgentOrchestrator;
    private _managerAgent: ManagerAgent;
    private _pipelineEngine: PipelineEngine;
    private _longTermMemory: LongTermMemory;
    private _currentSessionId: string;
    private _currentAgentMode: 'plan' | 'build' = 'build';
    private _history: Array<{ role: 'user' | 'assistant', text: string, files?: any[], commands?: any[] }> = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._client = new ByteAIClient();
        this._contextManager = new ContextManager();
        this._searchAgent = new SearchAgent();
        this._agentOrchestrator = new AgentOrchestrator(_context);
        this._managerAgent = new ManagerAgent();
        this._pipelineEngine = new PipelineEngine();
        this._longTermMemory = new LongTermMemory(_context);
        this._currentSessionId = Date.now().toString();
        this._history = [];
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        (webviewView.webview as any).options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
            retainContextWhenHidden: true
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Initialize settings in the view
        this.handleGetSettings();

        // Listen for visibility changes to ensure settings are up-to-date
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.handleGetSettings();
            }
        });

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('byteAI')) {
                this.handleGetSettings();
            }
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            await this.handleMessage(data);
        });

        this.restoreLastSession();
    }

    private async ensureOllamaRunning(): Promise<boolean> {
        // First check if Ollama is installed
        const isInstalled = await this._client.isOllamaInstalled();
        if (!isInstalled) {
            const selection = await vscode.window.showErrorMessage(
                'Ollama is not installed. Please download and install it to use local models.',
                'Download Ollama'
            );
            if (selection === 'Download Ollama') {
                vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
            }
            return false;
        }

        let isConnected = await this._client.checkLocalConnection();
        if (isConnected) return true;

        // Not running, try to start
        vscode.window.showInformationMessage('ByteAI: Starting local Ollama server...');
        
        // Check if we already have a terminal
        let terminal = vscode.window.terminals.find(t => t.name === 'ByteAI Ollama');
        if (!terminal) {
            terminal = vscode.window.createTerminal('ByteAI Ollama');
        }
        terminal.show(true); // show but don't take focus
        terminal.sendText('ollama serve');

        // Poll for connection (max 10 seconds)
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            isConnected = await this._client.checkLocalConnection();
            if (isConnected) {
                vscode.window.showInformationMessage('ByteAI: Ollama started successfully!');
                return true;
            }
        }
        
        return false;
    }

    private async handleMessage(data: any) {
        switch (data.type) {
            case 'setAgentMode':
                this._currentAgentMode = data.mode;
                this._agentOrchestrator.setAgentMode(data.mode);
                vscode.window.showInformationMessage(`Switched to ${data.mode === 'plan' ? 'Plan (Read-Only)' : 'Build (Full Access)'} Agent.`);
                break;
            case 'sendMessage':
                await this.handleUserMessage(data.value, data.files, data.commands);
                break;
            case 'getLocalModels':
                const localModels = await this._client.listLocalModels();
                this._view?.webview.postMessage({ type: 'localModels', models: localModels });
                break;
            case 'deleteLocalModel':
                const deleted = await this._client.deleteLocalModel(data.name);
                if (deleted) {
                    vscode.window.showInformationMessage(`Model ${data.name} deleted successfully.`);
                    // Refresh list
                    const updatedModels = await this._client.listLocalModels();
                    this._view?.webview.postMessage({ type: 'localModels', models: updatedModels });
                } else {
                    vscode.window.showErrorMessage(`Failed to delete model ${data.name}.`);
                }
                break;
            case 'setModel':
                if (data.model === 'local') {
                    // If a specific model name is provided, set it
                    if (data.modelName) {
                        this._client.setLocalModelName(data.modelName);
                    }

                    const running = await this.ensureOllamaRunning();
                    if (!running) {
                        const selection = await vscode.window.showErrorMessage(
                            'Ollama could not be started automatically. Please install it or run "ollama serve" manually.',
                            'Install Ollama'
                        );
                        
                        if (selection === 'Install Ollama') {
                            vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
                        }
                    } else {
                        // If no specific model name was provided, or if we want to verify existence
                        // (Logic simplified: if switching to local, we assume user picked a valid one or default)
                    }
                }
                this._client.setModel(data.model);
                vscode.window.showInformationMessage(`Switched to ${data.model === 'local' ? (data.modelName ? `Local (${data.modelName})` : 'Local (Ollama)') : 'Byte API'} model.`);
                break;
            case 'downloadModel':
                const runningDownload = await this.ensureOllamaRunning();
                if (!runningDownload) {
                        const selection = await vscode.window.showErrorMessage(
                            'Ollama could not be started automatically. Please install it or run "ollama serve" manually.',
                            'Install Ollama'
                        );
                        
                        if (selection === 'Install Ollama') {
                            vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
                        }
                        return;
                }
                // If a model name is provided, download it directly
                    if (data.modelName) {
                        const terminal = vscode.window.createTerminal('ByteAI Model Download');
                        terminal.show();
                        terminal.sendText(`ollama pull ${data.modelName}`);
                        this._client.setLocalModelName(data.modelName);
                    } else {
                        await this.downloadLocalModel();
                    }
                    break;
                case 'newChat':
                    this.clearChat();
                    break;
                case 'clearData':
                    // Stop any running processes
                    this._client.disconnect();

                    // Clear all contexts
                    this._contextManager.clear();
                    await this._agentOrchestrator.clearAllData();

                    // Clear chat session
                    await this.clearChat();

                    // Notify user
                    vscode.window.showInformationMessage('All session data, context, and temporary states have been cleared.');
                    break;
                case 'getSessions':
                    await this.getSessions();
                    break;
                case 'loadSession':
                    await this.loadSession(data.id);
                    break;
                case 'deleteSession':
                    await this.deleteSession(data.id);
                    break;
                case 'renameSession':
                    await this.renameSession(data.id, data.title);
                    break;
                case 'clearAllSessions':
                    await this.clearAllSessions();
                    break;
                case 'copyCode':
                    vscode.env.clipboard.writeText(data.value);
                    break;
                case 'insertCode':
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        editor.edit(editBuilder => {
                            if (editor.selection.isEmpty) {
                                editBuilder.insert(editor.selection.active, data.value);
                            } else {
                                editBuilder.replace(editor.selection, data.value);
                            }
                        });
                        vscode.window.showInformationMessage('Code inserted successfully!');
                    } else {
                        vscode.window.showWarningMessage('No active editor to insert code into.');
                    }
                    break;
                case 'openFile':
                    const openPath = data.value;
                    if (openPath) {
                        try {
                            let uri: vscode.Uri;
                            // Check if path is absolute
                            const isAbsolute = openPath.startsWith('/') || /^[a-zA-Z]:\\/.test(openPath);

                            if (isAbsolute) {
                                uri = vscode.Uri.file(openPath);
                            } else {
                                // Try to resolve in workspace
                                const matches = await vscode.workspace.findFiles('**/' + openPath, '**/node_modules/**', 1);
                                if (matches.length > 0) {
                                    uri = matches[0];
                                } else {
                                    const root = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file('/');
                                    uri = vscode.Uri.joinPath(root, openPath);
                                }
                            }

                            // Check if it's a folder
                            try {
                                const stat = await vscode.workspace.fs.stat(uri);
                                if (stat.type === vscode.FileType.Directory) {
                                    await vscode.commands.executeCommand('revealInExplorer', uri);
                                } else {
                                    const doc = await vscode.workspace.openTextDocument(uri);
                                    await vscode.window.showTextDocument(doc);
                                }
                            } catch (e) {
                                // Fallback
                                const doc = await vscode.workspace.openTextDocument(uri);
                                await vscode.window.showTextDocument(doc);
                            }
                        } catch (e) {
                            vscode.window.showErrorMessage(`Could not open file: ${openPath}`);
                        }
                    }
                    break;
                case 'getFiles':
                    const query = data.query ? data.query.toLowerCase() : '';
                    // Search for files (limit to 1000 to keep it fast but broad)
                    const allFiles = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/.bytecoder/**,**/.bytecoder}', 1000);

                    // Extract unique directories and filter .bytecoder
                    const dirs = new Set<string>();
                    const validFiles = allFiles.filter(f => !f.fsPath.includes('.bytecoder'));

                    validFiles.forEach(f => {
                        const relativePath = vscode.workspace.asRelativePath(f);
                        const parts = relativePath.split('/');
                        // Add all parent directories
                        for (let i = 0; i < parts.length - 1; i++) {
                            const dirPath = parts.slice(0, i + 1).join('/');
                            dirs.add(dirPath);
                        }
                    });

                    const scoredFiles = allFiles.map(f => {
                        const relativePath = vscode.workspace.asRelativePath(f);
                        const fileName = relativePath.split('/').pop() || '';
                        const lowerPath = relativePath.toLowerCase();
                        const lowerName = fileName.toLowerCase();

                        let score = 0;
                        if (!query) {
                            score = 1; // Default visibility
                        } else {
                            // Exact filename match
                            if (lowerName === query) score = 100;
                            // Exact path match
                            else if (lowerPath === query) score = 90;
                            // Filename starts with query
                            else if (lowerName.startsWith(query)) score = 80;
                            // Path contains query
                            else if (lowerPath.includes(query)) score = 50;
                            else {
                                // Fuzzy match
                                let qIdx = 0;
                                let pIdx = 0;
                                let matchCount = 0;
                                while (qIdx < query.length && pIdx < lowerPath.length) {
                                    if (lowerPath[pIdx] === query[qIdx]) {
                                        matchCount++;
                                        qIdx++;
                                    }
                                    pIdx++;
                                }
                                if (matchCount === query.length) score = 20;
                            }
                        }
                        return { file: f, path: relativePath, score, isFolder: false };
                    });

                    // Score folders
                    const scoredFolders = Array.from(dirs).map(dir => {
                        const lowerPath = dir.toLowerCase();
                        const dirName = dir.split('/').pop() || '';
                        const lowerName = dirName.toLowerCase();

                        let score = 0;
                        if (!query) {
                            score = 1;
                        } else {
                            if (lowerName === query) score = 95; // High priority for exact folder name
                            else if (lowerPath === query) score = 90;
                            else if (lowerName.startsWith(query)) score = 75;
                            else if (lowerPath.includes(query)) score = 45;
                            else {
                                // Fuzzy
                                let qIdx = 0; let pIdx = 0; let matchCount = 0;
                                while (qIdx < query.length && pIdx < lowerPath.length) {
                                    if (lowerPath[pIdx] === query[qIdx]) { matchCount++; qIdx++; }
                                    pIdx++;
                                }
                                if (matchCount === query.length) score = 15;
                            }
                        }
                        // Create a fake URI for the folder
                        const root = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file('/');
                        return {
                            file: vscode.Uri.joinPath(root, dir),
                            path: dir,
                            score,
                            isFolder: true
                        };
                    });

                    // Combine and Sort
                    const combined = [...scoredFiles, ...scoredFolders];

                    const filteredFiles = combined
                        .filter(x => x.score > 0)
                        .filter(x => !x.path.includes('.bytecoder') && !x.path.includes('.git') && !x.path.includes('node_modules'))
                        .sort((a, b) => {
                            if (a.score !== b.score) return b.score - a.score;
                            if (a.path.length !== b.path.length) return a.path.length - b.path.length;
                            return a.path.localeCompare(b.path);
                        })
                        .slice(0, 50)
                        .map(x => ({
                            path: x.path,
                            fullPath: x.file.fsPath,
                            isFolder: x.isFolder
                        }));

                    // Add Special Items
                    const specialItems = [
                        { path: 'problems', fullPath: 'Current Problems & Errors', isFolder: false },
                        { path: 'clipboard', fullPath: 'Clipboard Content', isFolder: false }
                    ];

                    specialItems.forEach(item => {
                        if (item.path.includes(query) || item.path === query) {
                            filteredFiles.unshift(item);
                        }
                    });

                    this._view?.webview.postMessage({ type: 'fileList', files: filteredFiles });
                    break;
                case 'stopGeneration':
                    this._client.disconnect();
                    break;
                case 'exportChat':
                    await this.exportChatAsMarkdown();
                    break;
                case 'regenerate':
                    await this.handleRegenerate(data.index);
                    break;
                case 'editMessage':
                    await this.handleEditMessage(data.index);
                    break;
                case 'executeCommand':
                    await this.runCommand(data.command);
                    break;
                case 'error':
                    vscode.window.showErrorMessage('Webview Error: ' + data.value);
                    break;
                case 'getSettings':
                    await this.handleGetSettings();
                    break;
                case 'saveSettings':
                    await this.handleSaveSettings(data.value);
                    break;
            }
    }

    public async clearChat() {
        this._client.resetSession();
        this._currentSessionId = Date.now().toString();
        this._history = [];
        this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
        // Don't save empty sessions - they'll be saved when user sends first message
    }

    private async downloadLocalModel() {
        const models = ['llama3', 'mistral', 'codellama', 'phi3', 'deepseek-coder'];
        const selected = await vscode.window.showQuickPick(models, {
            placeHolder: 'Select a model to download (requires Ollama installed)'
        });
        
        if (selected) {
            const terminal = vscode.window.createTerminal('ByteAI Model Download');
            terminal.show();
            terminal.sendText(`ollama pull ${selected}`);
            
            // Inform the client which model to use locally
            this._client.setLocalModelName(selected);
        }
    }

    public async runCommand(command: string) {
        if (!this._view) {
            await vscode.commands.executeCommand('byteAI.chatView.focus');
        }

        const editor = vscode.window.activeTextEditor;
        let text = "";
        if (editor) {
            const selection = editor.selection;
            if (!selection.isEmpty) {
                text = editor.document.getText(selection);
            }
        }

        const prompts: { [key: string]: string } = {
            'explain': "Act as a Senior Software Architect. Deeply analyze the following code. Explain its logical flow, architectural pattern, potential side effects, and any performance bottlenecks. Use clear headings and bullet points.\n\nCode:\n```\n" + text + "\n```",
            'fix': "Act as an Expert Debugger. Analyze the following code for bugs, race conditions, memory leaks, and logical errors. Fix the issues and explain the root cause of each bug. Provide the corrected code block.\n\nCode:\n```\n" + text + "\n```",
            'refactor': "Act as a Clean Code Expert. Refactor the following code to strictly follow SOLID principles, DRY, and modern best practices (ES6+ for JS/TS). Improve readability, maintainability, and efficiency. Explain the key improvements made.\n\nCode:\n```\n" + text + "\n```",
            'test': "Generate comprehensive unit tests for the following code. Cover happy paths, edge cases, and potential failure modes. Use modern testing frameworks (e.g., Jest/Vitest for JS, Pytest for Python). Mock external dependencies where appropriate.\n\nCode:\n```\n" + text + "\n```",
            'doc': "Generate professional, industry-standard documentation (e.g., JSDoc/TSDoc/Docstring) for the following code. Include parameter descriptions, return values, exceptions, and usage examples.\n\nCode:\n```\n" + text + "\n```",
            'optimize': "Act as a Performance Engineer. Analyze this code for performance issues including time complexity, memory usage, unnecessary computations, and caching opportunities. Provide an optimized version with benchmarking suggestions.\n\nCode:\n```\n" + text + "\n```",
            'security': "Act as a Security Expert. Perform a thorough security audit on this code. Check for: XSS, SQL injection, CSRF, authentication flaws, data exposure, insecure dependencies, and other OWASP Top 10 vulnerabilities. Provide fixes for each issue found.\n\nCode:\n```\n" + text + "\n```",
            'review': "Act as a Senior Code Reviewer. Provide a comprehensive code review covering: code quality, best practices, potential bugs, edge cases, error handling, naming conventions, and architecture concerns. Rate the code quality 1-10 and provide actionable feedback.\n\nCode:\n```\n" + text + "\n```",
            'convert': "Convert this code to a different programming language while maintaining the same logic and structure. Ask me which language to convert to if not specified.\n\nCode:\n```\n" + text + "\n```"
        };

        const message = text ? prompts[command] : `/${command}`;

        if (message) {
            this._view?.webview.postMessage({ type: 'setAndSendMessage', value: message });
        }
    }

    public async quickAsk(question: string) {
        if (!this._view) {
            await vscode.commands.executeCommand('byteAI.chatView.focus');
        }

        const editor = vscode.window.activeTextEditor;
        let text = "";
        if (editor) {
            const selection = editor.selection;
            if (!selection.isEmpty) {
                text = editor.document.getText(selection);
            }
        }

        if (text) {
            const message = `${question}\n\nCode:\n\`\`\`\n${text}\n\`\`\``;
            this._view?.webview.postMessage({ type: 'setAndSendMessage', value: message });
        } else {
            this._view?.webview.postMessage({ type: 'setAndSendMessage', value: question });
        }
    }

    private async handleRegenerate(index?: number) {
        if (this._history.length === 0) return;

        // If index is provided, we need to remove everything from that index onwards
        // But we need to find the user message before it to re-run
        let userMsgText = "";
        let files: any[] = [];
        let commands: any[] = [];

        if (index !== undefined) {
            // Validate index
            if (index < 0 || index >= this._history.length) return;

            const msg = this._history[index];
            if (msg.role === 'assistant') {
                if (index > 0 && this._history[index - 1].role === 'user') {
                    const userMsg = this._history[index - 1];
                    userMsgText = userMsg.text;
                    files = userMsg.files || [];
                    commands = userMsg.commands || [];
                    this._history = this._history.slice(0, index - 1);
                } else {
                    return; // Can't regenerate if no preceding user message
                }
            }
        } else {
            // Fallback to old behavior (last message)
            const lastMsg = this._history[this._history.length - 1];
            if (lastMsg.role === 'assistant') {
                this._history.pop();
            }
            const lastUserMsg = this._history[this._history.length - 1];
            if (lastUserMsg && lastUserMsg.role === 'user') {
                userMsgText = lastUserMsg.text;
                files = lastUserMsg.files || [];
                commands = lastUserMsg.commands || [];
                // Remove user message as it will be re-added by handleUserMessage
                this._history.pop();
            }
        }

        if (userMsgText) {
            // Update view to reflect history change
            this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
            // Trigger generation
            await this.handleUserMessage(userMsgText, files, commands, true);
        }
    }

    private async handleEditMessage(index: number) {
        if (this._history.length === 0) return;
        if (index < 0 || index >= this._history.length) return;

        const msg = this._history[index];
        if (msg.role === 'user') {
            // We want to edit this user message.
            // Remove this message and everything after it.
            this._history = this._history.slice(0, index);

            // Reload session view (to reflect removed messages)
            this._view?.webview.postMessage({ type: 'loadSession', history: this._history });

            // Set input box
            this._view?.webview.postMessage({
                type: 'setAndSendMessage',
                value: msg.text,
                justSet: true,
                files: msg.files,
                commands: msg.commands
            });
        }
    }

    private async handleUserMessage(message: string, files: any[] = [], commands: any[] = [], shouldUpdateView: boolean = false) {
        if (!this._view) return;

        try {
            this._view?.webview.postMessage({ type: 'agentStatusReset' });
            this._view?.webview.postMessage({
                type: 'agentStatus',
                phase: 'Analyzing',
                message: 'Analyzing your request and recent context'
            });

            this._history.push({ role: 'user', text: message, files, commands });
            await this.saveCurrentSession();

            if (shouldUpdateView) {
                this._view.webview.postMessage({ type: 'addMessage', role: 'user', value: message, files, commands });
                this._view.webview.postMessage({ type: 'setGenerating' }); // Show typing indicator
            }

            let contextMsg = message;

            // Append commands to contextMsg if they exist
            if (commands && commands.length > 0) {
                contextMsg = `[User Commands: ${commands.map(c => '/' + c).join(' ')}]\n` + contextMsg;
            }

            // Append attached files content
            if (files && files.length > 0) {
                let fileContextBlock = "\n\n--- ATTACHED FILES ---\n";
                for (const f of files) {
                    if (f.isFolder) continue;

                    try {
                        let uri: vscode.Uri;
                        if (f.fullPath) {
                            uri = vscode.Uri.file(f.fullPath);
                        } else if (f.path) {
                            const root = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file('/');
                            uri = vscode.Uri.joinPath(root, f.path);
                        } else {
                            continue;
                        }

                        const content = await vscode.workspace.fs.readFile(uri);
                        const textContent = new TextDecoder().decode(content);
                        const relativePath = vscode.workspace.asRelativePath(uri);
                        const ext = relativePath.split('.').pop() || 'text';

                        const contextItem = this._contextManager.addFileWithQuery(
                            relativePath,
                            textContent,
                            ext,
                            message
                        );

                        fileContextBlock += `File: ${relativePath}\n\`\`\`${ext}\n${contextItem.content}\n\`\`\`\n\n`;
                    } catch (e) {
                        console.error('Error reading attached file:', f, e);
                    }
                }
                contextMsg += fileContextBlock;
            }

            const conversationSummary = this._contextManager.getConversationSummary();
            if (conversationSummary) {
                contextMsg = conversationSummary + '\n\n' + contextMsg;
            }

            // === LONG-TERM MEMORY SEARCH ===
            // Search for relevant memories from past sessions
            this._view?.webview.postMessage({
                type: 'agentStatus',
                phase: 'Memory',
                message: 'Searching long-term memory...'
            });

            const memoryContext = await this._longTermMemory.getRelevantContext(message);
            if (memoryContext) {
                contextMsg = memoryContext + contextMsg;
            }

            // Extract and store entities from user message
            await this._longTermMemory.extractAndStore(message, this._currentSessionId);

            // === AGENTIC WORKFLOW ===
            // 1. Analyze Intent & Plan
            this._view?.webview.postMessage({
                type: 'agentStatus',
                phase: 'Thinking',
                message: 'Manager Agent analyzing request...'
            });

            const activeEditor = vscode.window.activeTextEditor;
            const activeFilePath = activeEditor ? vscode.workspace.asRelativePath(activeEditor.document.uri) : undefined;
            const selectionText = activeEditor && !activeEditor.selection.isEmpty ? activeEditor.document.getText(activeEditor.selection) : undefined;

            // Set context for Orchestrator (handles "that file" references)
            this._agentOrchestrator.setContextFromMessage(message, activeFilePath);

            // Execute Manager Agent to decide what to do
            const decision = await this._managerAgent.execute({
                query: message,
                activeFilePath,
                hasSelection: !!selectionText,
                selectionText
            });

            const detectedPersona = this._agentOrchestrator.detectPersona(message, decision.payload.intent);
            this._view?.webview.postMessage({
                type: 'agentStatus',
                phase: 'Thinking',
                message: `Manager Agent identified intent: ${decision.payload.intent} (Persona: ${detectedPersona})`
            });

            // 2. Execute Pipeline if needed
            let pipelineContext = "";
            let pipelineResults: any = null;

            if (decision.payload.confidence > 0.6) {
                this._view?.webview.postMessage({
                    type: 'agentStatus',
                    phase: 'Planning',
                    message: `Intent: ${decision.payload.intent} (${(decision.payload.confidence * 100).toFixed(0)}%) - Executing Pipeline`
                });

                const pipelineOutput = await this._pipelineEngine.execute(
                    decision.payload,
                    message,
                    activeFilePath,
                    selectionText,
                    (status) => {
                        // Send basic status update
                        this._view?.webview.postMessage({
                            type: 'agentStatus',
                            phase: status.phase,
                            message: status.message
                        });

                        // Send plan update if available
                        if (status.plan) {
                            this._view?.webview.postMessage({
                                type: 'planUpdate',
                                plan: status.plan,
                                activeTaskId: status.activeTaskId
                            });
                        }
                    }
                );

                pipelineContext = pipelineOutput.context;
                pipelineResults = pipelineOutput.results;

                // Prepend context to message
                contextMsg = pipelineContext + '\n\n' + contextMsg;

            } else {
                // Fallback to simple search if confidence is low
                this._view?.webview.postMessage({
                    type: 'agentStatus',
                    phase: 'Searching',
                    message: 'Low confidence in detailed plan - falling back to broad search'
                });

                const searchContext = await this._searchAgent.search(message, activeFilePath);
                if (searchContext) {
                    // Prepend search context to ensure it's seen first
                    contextMsg = searchContext + '\n\n' + contextMsg;
                }

                const projectMap = await this._searchAgent.getProjectMap();
                contextMsg += '\n\n' + projectMap;
            }

            this._contextManager.addConversationTurn('user', message);

            this._view?.webview.postMessage({
                type: 'agentStatus',
                phase: 'Answering',
                message: 'Generating answer with gathered context'
            });

            let fullResponse = "";
            await this._client.streamResponse(contextMsg, (chunk) => {
                fullResponse += chunk;
                this._view?.webview.postMessage({ type: 'addResponse', value: fullResponse, isStream: true });
            }, (err) => {
                this._view?.webview.postMessage({ type: 'error', value: err.message });
            });

            this._history.push({ role: 'assistant', text: fullResponse });
            this._contextManager.addConversationTurn('assistant', fullResponse);
            await this.saveCurrentSession();

            // === AGENTIC EXECUTION ===
            // Parse AI response for executable instructions
            console.log('[ByteCoder] Parsing AI response for actions...');
            const instructions = this._agentOrchestrator.parseAIResponse(fullResponse, detectedPersona);
            console.log('[ByteCoder] Found instructions:', instructions.length);

            // If we have instructions, we are NOT done yet. 
            // Send isStream: true to keep the UI in generating state.
            // Otherwise, send isStream: false to finish.
            const hasInstructions = instructions.length > 0;
            this._view.webview.postMessage({ type: 'addResponse', value: fullResponse, isStream: hasInstructions });

            if (hasInstructions) {
                // Log what we found
                console.log('[ByteCoder] Instructions details:', JSON.stringify(instructions, null, 2));

                this._view?.webview.postMessage({
                    type: 'agentStatus',
                    phase: 'Executing',
                    message: `Found ${instructions.length} action(s) to execute`
                });

                // Check if auto-execute is enabled (default: true for simple tasks)
                const autoExecute = vscode.workspace.getConfiguration('byteAI').get<boolean>('autoExecute', true);

                // Check if all actions are safe (file creation, modification, deletion, folders, or safe git commands)
                const safeCommands = [
                    'git add', 'git commit', 'git status', 'git init', 'git log', 'git diff',
                    'ls', 'dir', 'cat', 'grep', 'pwd', 'echo', 'touch', 'mkdir', 'rmdir',
                    'npm test', 'npm run build', 'npm run test', 'npm start', 'node -v', 'npm -v'
                ];
                const isSafe = instructions.length <= 10 &&
                    instructions.every(i =>
                        i.type === 'create_file' ||
                        i.type === 'create_folder' ||
                        i.type === 'modify_file' ||
                        i.type === 'delete_file' ||
                        i.type === 'partial_edit' ||
                        (i.type === 'run_command' && safeCommands.some(c => i.command?.startsWith(c)))
                    );

                if (autoExecute && isSafe) {
                    // Auto-execute safe actions without confirmation
                    console.log('[ByteCoder] Auto-executing safe actions...');
                    const result = await this._agentOrchestrator.executeInstructions(
                        instructions,
                        (progress) => {
                            this._view?.webview.postMessage({
                                type: 'agentStatus',
                                phase: 'Executing',
                                message: progress
                            });
                        }
                    );

                    const summaryMsg = `\n\n---\n**🤖 Actions Executed**\n${result.actions.map(a => a.result).join('\n')}`;
                    const updatedResponse = fullResponse + summaryMsg;
                    this._history[this._history.length - 1].text = updatedResponse;
                    this._view?.webview.postMessage({ type: 'addResponse', value: updatedResponse, isStream: false });

                    await this.saveCurrentSession();
                    vscode.window.showInformationMessage(`✅ Created ${result.actions.filter(a => a.success).length} file(s)`);
                } else {
                    // Not safe or auto-execute disabled - ask user
                    // End stream so user can see buttons (handled by promptForExecution)
                    this._view?.webview.postMessage({ type: 'addResponse', value: fullResponse, isStream: false });
                    await this.promptForExecution(instructions, fullResponse);
                }
            } else {
                console.log('[ByteCoder] No executable actions found in response');
                // No instructions, so ensure stream prevents processing
                this._view?.webview.postMessage({ type: 'addResponse', value: fullResponse, isStream: false });
            }

            this._view?.webview.postMessage({ type: 'agentStatusDone' });

        } catch (error: any) {
            console.error('Chat Error:', error);
            this._view?.webview.postMessage({ type: 'error', value: error.message || "Unknown error" });
            this._view?.webview.postMessage({ type: 'agentStatusDone' });
        }
    }


    private async handleNewChat() {
        this.clearChat();
    }

    private async saveCurrentSession() {
        // Only save sessions that have actual user messages
        if (this._history.length === 0) {
            return;
        }

        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        const existingIdx = sessions.findIndex(s => s.id === this._currentSessionId);

        // Get first user message for title, skip empty sessions
        const firstUserMessage = this._history.find(m => m.role === 'user')?.text;
        if (!firstUserMessage) {
            return; // Don't save sessions without user messages
        }

        const sessionData = {
            id: this._currentSessionId,
            title: firstUserMessage.slice(0, 50),
            timestamp: Date.now(),
            history: this._history
        };

        if (existingIdx !== -1) {
            sessions[existingIdx] = sessionData;
        } else {
            sessions.unshift(sessionData);
        }

        while (sessions.length > 20) sessions.pop(); // Limit to 20
        await this._context.globalState.update('byteAI_sessions', sessions);
    }

    private async getSessions() {
        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        // Filter out any sessions that have no history or empty titles
        const validSessions = sessions.filter(s =>
            s.history && s.history.length > 0 && s.title && s.title !== 'New Session'
        );
        this._view?.webview.postMessage({
            type: 'sessionList',
            sessions: validSessions.map(s => ({ id: s.id, title: s.title, timestamp: s.timestamp })),
            currentSessionId: this._currentSessionId
        });
    }

    private async loadSession(id: string) {
        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        const session = sessions.find(s => s.id === id);
        if (session) {
            this._currentSessionId = session.id;
            this._history = session.history || [];
            this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
            // Ensure settings are synced when session is restored
            await this.handleGetSettings();
        }
    }

    private async deleteSession(id: string) {
        let sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        sessions = sessions.filter(s => s.id !== id);
        await this._context.globalState.update('byteAI_sessions', sessions);
        await this.getSessions();
        if (id === this._currentSessionId) this.handleNewChat();
    }

    private async renameSession(id: string, currentTitle: string) {
        const newTitle = await vscode.window.showInputBox({
            prompt: 'Rename Session',
            value: currentTitle,
            placeHolder: 'Enter new session name'
        });

        if (newTitle && newTitle !== currentTitle) {
            const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
            const idx = sessions.findIndex(s => s.id === id);
            if (idx !== -1) {
                sessions[idx].title = newTitle;
                await this._context.globalState.update('byteAI_sessions', sessions);
                await this.getSessions();
            }
        }
    }

    private async clearAllSessions() {
        await this._context.globalState.update('byteAI_sessions', []);
        this.handleNewChat();
    }

    private async restoreLastSession() {
        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        const lastSession = sessions.find(s =>
            s.history && s.history.length > 0 && s.title && s.title !== 'New Session'
        );

        if (lastSession) {
            this._currentSessionId = lastSession.id;
            this._history = lastSession.history || [];
            this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
        }
    }

    private async exportChatAsMarkdown() {
        if (this._history.length === 0) {
            vscode.window.showWarningMessage('No messages to export.');
            return;
        }

        let markdown = `# Byte AI Chat Export\n\n`;
        markdown += `**Date:** ${new Date().toLocaleString()}\n\n`;
        markdown += `---\n\n`;

        for (const msg of this._history) {
            if (msg.role === 'user') {
                markdown += `## 👤 User\n\n${msg.text}\n\n`;
            } else {
                markdown += `## 🤖 Byte AI\n\n${msg.text}\n\n`;
            }
            markdown += `---\n\n`;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`byte-ai-chat-${Date.now()}.md`),
            filters: { 'Markdown': ['md'], 'All Files': ['*'] }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
            vscode.window.showInformationMessage(`Chat exported to ${uri.fsPath}`);
        }
    }


    private _getHtmlForWebview(webview: vscode.Webview) {
        const icons = {
            user: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            bot: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>',
            send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
            plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
            history: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
            copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
            check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
            zap: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
            trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
            stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>',
            download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            thumbsUp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>',
            thumbsDown: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>',
            file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
            edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
            refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
            settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
            close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
            code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>'
        };

        return ChatViewHtml.getHtml(webview, this._extensionUri, icons);
    }
    private async handleGetSettings() {
        const config = vscode.workspace.getConfiguration('byteAI');
        const settings = {
            customInstructions: config.get<string>('customInstructions'),
            autoContext: config.get<boolean>('autoContext'),
            useLocalModel: config.get<boolean>('useLocalModel', false),
            localModelName: config.get<string>('localModelName', 'llama3')
        };
        this._view?.webview.postMessage({ type: 'updateSettings', value: settings });
    }

    private async handleSaveSettings(settings: any) {
        try {
            const config = vscode.workspace.getConfiguration('byteAI');
            await config.update('customInstructions', settings.customInstructions, vscode.ConfigurationTarget.Global);
            await config.update('autoContext', settings.autoContext, vscode.ConfigurationTarget.Global);
            
            // Fix: Persist model selection settings
            if (settings.useLocalModel !== undefined) {
                await config.update('useLocalModel', settings.useLocalModel, vscode.ConfigurationTarget.Global);
            }
            if (settings.localModelName) {
                await config.update('localModelName', settings.localModelName, vscode.ConfigurationTarget.Global);
            }

            // Refresh settings to ensure UI is in sync
            await this.handleGetSettings();

            vscode.window.showInformationMessage('Byte AI Settings saved successfully');
        } catch (error) {
            console.error('Error saving settings:', error);
            vscode.window.showErrorMessage('Failed to save settings. Please check the output console for details.');
        }
    }

    /**
     * Prompt user for execution confirmation
     */
    private async promptForExecution(instructions: any[], fullResponse: string) {
        // Build preview
        const preview = instructions.map(i => {
            if (i.type === 'create_file') return `📝 Create: ${i.path}`;
            if (i.type === 'create_folder') return `📁 Create dir: ${i.path}`;
            if (i.type === 'run_command') return `🔧 Run: ${i.command}`;
            return `${i.type}: ${i.path || i.command}`;
        }).join('\n');

        console.log('[ByteCoder] Prompting for execution:', preview);

        const choice = await vscode.window.showInformationMessage(
            `Byte Coder wants to execute ${instructions.length} action(s):\n${preview.substring(0, 200)}`,
            'Execute All',
            'Cancel'
        );

        if (choice === 'Execute All') {
            console.log('[ByteCoder] User approved execution');
            const result = await this._agentOrchestrator.executeInstructions(
                instructions,
                (progress) => {
                    this._view?.webview.postMessage({
                        type: 'agentStatus',
                        phase: 'Executing',
                        message: progress
                    });
                }
            );

            // Show execution summary
            const summaryMsg = `\n\n---\n**🤖 Agentic Execution Complete**\n${result.summary}\n${result.actions.map(a => a.result).join('\n')}`;
            const updatedResponse = fullResponse + summaryMsg;
            this._history[this._history.length - 1].text = updatedResponse;
            this._view?.webview.postMessage({ type: 'addResponse', value: updatedResponse, isStream: false });
            await this.saveCurrentSession();

            if (result.checkpointId) {
                vscode.window.showInformationMessage(
                    `✅ Done! Checkpoint: ${result.checkpointId}`
                );
            } else {
                vscode.window.showInformationMessage(
                    `✅ Executed ${result.actions.filter(a => a.success).length}/${result.actions.length} actions`
                );
            }
        } else {
            console.log('[ByteCoder] User cancelled execution');
        }
    }
}
