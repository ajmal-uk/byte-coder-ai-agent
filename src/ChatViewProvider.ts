import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _currentSessionId: string;
    private _history: Array<{ role: 'user' | 'assistant', text: string }> = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._client = new ByteAIClient();
        this._currentSessionId = Date.now().toString();
        this._history = [];
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.value);
                    break;
                case 'newChat':
                    this.clearChat();
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
                case 'getFiles':
                    const query = data.query ? data.query.toLowerCase() : '';
                    // Search for files (limit to 1000 to keep it fast but broad)
                    const allFiles = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**}', 1000);

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
                                // Fuzzy match: characters must appear in order
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
                                // Only count if we matched most of the query
                                if (matchCount === query.length) score = 20;
                            }
                        }
                        return { file: f, path: relativePath, score };
                    });

                    // Sort: Descending score, then shorter paths, then alphabetical
                    const filteredFiles = scoredFiles
                        .filter(x => x.score > 0)
                        .sort((a, b) => {
                            if (a.score !== b.score) return b.score - a.score;
                            if (a.path.length !== b.path.length) return a.path.length - b.path.length;
                            return a.path.localeCompare(b.path);
                        })
                        .slice(0, 50) // Return top 50
                        .map(x => ({
                            path: x.path,
                            fullPath: x.file.fsPath
                        }));

                    this._view?.webview.postMessage({ type: 'fileList', files: filteredFiles });
                    break;
                case 'stopGeneration':
                    this._client.disconnect();
                    break;
                case 'error':
                    vscode.window.showErrorMessage('Webview Error: ' + data.value);
                    break;
            }
        });
    }

    public async clearChat() {
        this._client.resetSession();
        this._currentSessionId = Date.now().toString();
        this._history = [];
        this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
        // Don't save empty sessions - they'll be saved when user sends first message
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
            'doc': "Generate professional, industry-standard documentation (e.g., JSDoc/TSDoc/Docstring) for the following code. Include parameter descriptions, return values, exceptions, and usage examples.\n\nCode:\n```\n" + text + "\n```"
        };

        const message = text ? prompts[command] : `/${command}`;

        if (message) {
            this._view?.webview.postMessage({ type: 'setAndSendMessage', value: message });
        }
    }

    private async handleUserMessage(message: string) {
        if (!this._view) return;

        try {
            this._history.push({ role: 'user', text: message });
            await this.saveCurrentSession();

            // 1. Resolve Context from @mentions
            let contextMsg = message;
            const mentionRegex = /@([^\s]+)/g;
            const matches = message.match(mentionRegex);

            if (matches && matches.length > 0) {
                const files = await vscode.workspace.findFiles('**/*');
                let contextBlock = "\n\n--- CONTEXT ---\n";

                for (const match of matches) {
                    const filename = match.substring(1); // remove @
                    // Find best matching file
                    const file = files.find(f => f.fsPath.endsWith(filename) || vscode.workspace.asRelativePath(f) === filename);

                    if (file) {
                        try {
                            const content = await vscode.workspace.fs.readFile(file);
                            const textContent = new TextDecoder().decode(content);
                            // Simple optimization: Limit file size?
                            if (textContent.length < 100000) {
                                contextBlock += `File: ${filename}\n\`\`\`\n${textContent}\n\`\`\`\n\n`;
                            } else {
                                contextBlock += `File: ${filename} (Skipped: Too large)\n\n`;
                            }
                        } catch (e) {
                            console.error('Error reading context file:', file.fsPath, e);
                        }
                    }
                }
                contextMsg += contextBlock;
            }

            // Stream response
            let fullResponse = "";
            await this._client.streamResponse(contextMsg, (chunk) => {
                fullResponse += chunk;
                this._view?.webview.postMessage({ type: 'addResponse', value: fullResponse, isStream: true });
            }, (err) => {
                this._view?.webview.postMessage({ type: 'error', value: err.message });
            });

            this._history.push({ role: 'assistant', text: fullResponse });
            this._view.webview.postMessage({ type: 'addResponse', value: fullResponse, isStream: false });
            await this.saveCurrentSession();

        } catch (error: any) {
            console.error('Chat Error:', error);
            this._view.webview.postMessage({ type: 'error', value: error.message || "Unknown error" });
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
        }
    }

    private async deleteSession(id: string) {
        let sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        sessions = sessions.filter(s => s.id !== id);
        await this._context.globalState.update('byteAI_sessions', sessions);
        await this.getSessions();
        if (id === this._currentSessionId) this.handleNewChat();
    }

    private async clearAllSessions() {
        await this._context.globalState.update('byteAI_sessions', []);
        this.handleNewChat();
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));

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
            stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>'
        };

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; img-src ${webview.cspSource} https: data:; font-src https:;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

            <style>
                :root {
                    /* Base Colors - Directly from VS Code */
                    --bg-app: var(--vscode-sideBar-background);
                    --bg-hover: var(--vscode-list-hoverBackground);
                    --text-primary: var(--vscode-editor-foreground);
                    --text-secondary: var(--vscode-descriptionForeground);
                    --border: var(--vscode-panel-border);
                    --accent: var(--vscode-button-background);
                    --accent-foreground: var(--vscode-button-foreground);
                    --accent-hover: var(--vscode-button-hoverBackground);
                    --input-bg: var(--vscode-input-background);
                    --input-fg: var(--vscode-input-foreground);
                    --input-border: var(--vscode-input-border);
                    
                    /* Code Blocks */
                    --code-bg: var(--vscode-editor-background);
                    --code-header-bg: var(--vscode-editorGroupHeader-tabsBackground);
                    
                    /* Components */
                    --shadow: 0 4px 12px rgba(0,0,0,0.1);
                }

                body {
                    margin: 0; padding: 0;
                    background: var(--bg-app);
                    color: var(--text-primary);
                    font-family: var(--vscode-font-family, 'Inter', system-ui, sans-serif);
                    height: 100vh;
                    display: flex; flex-direction: column;
                    overflow: hidden;
                }

                /* Scrollbar */
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
                ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
                ::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground); }

                /* Premium Header */
                header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 0 16px; height: 52px; min-height: 52px;
                    border-bottom: 1px solid var(--border);
                    background: var(--bg-app);
                    -webkit-user-select: none;
                    backdrop-filter: blur(10px);
                }
                .brand {
                    font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 10px;
                    color: var(--text-primary); letter-spacing: -0.01em;
                }
                .logo-img { width: 22px; height: 22px; object-fit: contain; }
                
                .header-actions {
                    display: flex; align-items: center; gap: 4px;
                }

                .btn-icon {
                    background: transparent; border: 1px solid transparent; color: var(--text-secondary);
                    cursor: pointer; padding: 8px; border-radius: 6px;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .btn-icon:hover { background: var(--bg-hover); color: var(--text-primary); transform: translateY(-1px); }
                .btn-icon:active { transform: translateY(1px); }

                /* Chat Area */
                #chat-container {
                    flex: 1; overflow-y: auto; padding: 24px 20px;
                    display: flex; flex-direction: column; gap: 28px;
                    scroll-behavior: smooth;
                }

                /* Messages */
                .message { display: flex; flex-direction: column; gap: 4px; max-width: 100%; animation: slideIn 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); }
                @keyframes slideIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
                
                .content { position: relative; font-size: 14px; line-height: 1.6; word-wrap: break-word; }
                
                /* User Message Bubble */
                .message.user { align-items: flex-end; }
                .message.user .content {
                    background: var(--accent); color: var(--accent-foreground);
                    padding: 10px 16px; border-radius: 14px;
                    border-top-right-radius: 2px;
                    max-width: 90%;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }

                /* Assistant Message */
                .message.assistant { align-items: flex-start; width: 100%; }
                .message.assistant .content {
                    padding: 0 4px; color: var(--text-primary); width: 100%;
                }

                /* Markdown Content */
                .content p { margin: 10px 0; }
                .content p:first-child { margin-top: 0; }
                .content p:last-child { margin-bottom: 0; }
                .content code {
                    font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px;
                    background: rgba(127,127,127,0.1); padding: 2px 6px; border-radius: 6px; 
                }
                
                /* Code Blocks */
                .content pre {
                    background: var(--code-bg);
                    border: 1px solid var(--border); border-radius: 8px;
                    margin: 14px 0; overflow: hidden;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                }
                
                .code-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 8px 14px; background: var(--code-header-bg);
                    border-bottom: 1px solid var(--border);
                    font-size: 11px; color: var(--text-secondary);
                }
                
                .window-dots { display: flex; gap: 6px; }
                .dot { width: 10px; height: 10px; border-radius: 50%; opacity: 0.8; }
                .dot.red { background: #ff5f56; }
                .dot.yellow { background: #ffbd2e; }
                .dot.green { background: #27c93f; }
                
                .code-lang { font-weight: 600; text-transform: uppercase; opacity: 0.7; font-size: 10px; letter-spacing: 0.5px; }
                
                .content pre code { 
                    display: block; padding: 14px; overflow-x: auto; 
                    background: transparent; border: none; font-family: var(--vscode-editor-font-family, 'monospace');
                    font-size: var(--vscode-editor-font-size, 13px); line-height: 1.5;
                }
                
                .copy-btn {
                    background: transparent; border: 1px solid transparent;
                    border-radius: 4px; padding: 4px 10px; cursor: pointer; color: var(--text-secondary);
                    font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 6px;
                    transition: all 0.2s;
                }
                .copy-btn:hover { background: var(--bg-hover); color: var(--text-primary); border-color: rgba(127,127,127,0.2); }

                /* Typing Indicator */
                .typing-indicator {
                    display: flex; gap: 6px; padding: 12px 20px;
                    background: var(--bg-hover); border-radius: 20px; border-top-left-radius: 4px;
                    width: fit-content; margin-top: 6px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                }
                .typing-dot {
                    width: 6px; height: 6px; background: var(--text-secondary); border-radius: 50%; opacity: 0.5;
                    animation: bounce 1.4s infinite ease-in-out both;
                }
                .typing-dot:nth-child(1) { animation-delay: -0.32s; }
                .typing-dot:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

                /* Input Area */
                .input-section {
                    padding: 20px; background: var(--bg-app);
                    border-top: 1px solid var(--border);
                    position: relative;
                }
                .input-box {
                    background: var(--input-bg); border: 1px solid var(--input-border);
                    border-radius: 10px; padding: 10px 12px;
                    display: flex; flex-direction: column; gap: 8px;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
                }
                .input-box:focus-within { 
                    border-color: var(--accent); 
                    box-shadow: 0 0 0 2px var(--accent-hover), 0 4px 12px rgba(0,0,0,0.1); 
                }
                
                textarea {
                    width: 100%; border: none; background: transparent; color: var(--input-fg);
                    font-family: inherit; font-size: 14px; resize: none; outline: none;
                    max-height: 200px; min-height: 24px; padding: 4px 0; line-height: 1.4;
                }
                
                .input-actions { display: flex; justify-content: flex-end; align-items: center; }
                .btn-send {
                    background: var(--accent); color: var(--accent-foreground); border: none;
                    border-radius: 50%; width: 36px; height: 36px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s;
                }
                /* Hide text in send button and specific styling override */
                .btn-send span { display: none; }
                .btn-send:hover { background: var(--accent-hover); transform: scale(1.05); }

                .btn-stop {
                    background: #ef4444; color: white; border: none;
                    border-radius: 50%; width: 36px; height: 36px;
                    cursor: pointer; display: none; align-items: center; justify-content: center;
                    transition: all 0.2s;
                }
                .btn-stop:hover { background: #dc2626; transform: scale(1.05); }

                /* Session Drawer */
                #session-drawer {
                    position: absolute; top: 0; right: 0; bottom: 0; width: 0;
                    background: var(--bg-app); border-left: 1px solid var(--border);
                    transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
                    overflow: hidden; z-index: 100;
                    display: flex; flex-direction: column;
                }
                #session-drawer.open { width: 280px; box-shadow: -8px 0 32px rgba(0,0,0,0.25); }
                
                .drawer-header {
                    padding: 18px 20px; border-bottom: 1px solid var(--border);
                    display: flex; justify-content: space-between; align-items: center;
                    font-weight: 700; font-size: 12px; letter-spacing: 0.5px;
                    background: var(--bg-app);
                }
                .session-list { flex: 1; overflow-y: auto; padding: 12px; }
                .session-link {
                    padding: 12px 14px; border-radius: 10px; cursor: pointer;
                    font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    border: 1px solid transparent; color: var(--text-secondary);
                    display: flex; justify-content: space-between; group; margin-bottom: 4px;
                    transition: all 0.2s;
                }
                .session-link:hover { background: var(--bg-hover); color: var(--text-primary); transform: translateX(2px); }
                .session-link.active { background: var(--bg-hover); color: var(--accent); font-weight: 500; border: 1px solid var(--border); }
                
                .btn-delete-session { opacity: 0; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s; }
                .btn-delete-session:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
                .session-link:hover .btn-delete-session { opacity: 1; }

                .drawer-footer { padding: 16px; border-top: 1px solid var(--border); background: var(--bg-app); }
                .btn-clear {
                    width: 100%; border: 1px solid var(--border); color: #ef4444; background: transparent;
                    padding: 10px; border-radius: 8px; font-size: 12px; cursor: pointer; font-weight: 500;
                    display: flex; align-items: center; justify-content: center; gap: 8px;
                    transition: all 0.2s;
                }
                .btn-clear:hover { background: rgba(239, 68, 68, 0.08); border-color: #ef4444; transform: translateY(-1px); }

                @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }

                /* Empty State - Clean & Professional */
                .empty-state {
                    display: flex; flex-direction: column; align-items: center;
                    justify-content: center; flex: 1; padding: 24px;
                    text-align: center; animation: fadeIn 0.5s ease-out;
                }
                .empty-greeting {
                    font-size: 20px; font-weight: 600; color: var(--text-primary);
                    margin-bottom: 8px; letter-spacing: -0.02em;
                }
                .empty-subtitle {
                    font-size: 13px; color: var(--text-secondary);
                    margin-bottom: 28px; max-width: 260px; line-height: 1.5;
                }

                /* Quick Action Cards */
                .quick-actions {
                    display: grid; grid-template-columns: 1fr 1fr;
                    gap: 10px; width: 100%; max-width: 320px;
                }
                .action-card {
                    background: var(--bg-hover); border: 1px solid var(--border);
                    border-radius: 12px; padding: 14px; cursor: pointer;
                    text-align: left; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex; flex-direction: column; gap: 6px;
                }
                .action-card:hover {
                    background: var(--input-bg); border-color: var(--accent);
                    transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.12);
                }
                .action-card:active { transform: translateY(0); }
                .action-icon {
                    width: 28px; height: 28px; border-radius: 8px;
                    display: flex; align-items: center; justify-content: center;
                    background: var(--accent); color: var(--accent-foreground);
                    font-size: 14px;
                }
                .action-title { font-size: 12px; font-weight: 600; color: var(--text-primary); }
                .action-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }

                /* Command Popup Styling */
                .command-popup {
                    position: absolute; bottom: 100%; left: 0; right: 0;
                    background: var(--bg-app); border: 1px solid var(--border);
                    border-radius: 12px; padding: 8px; margin-bottom: 8px;
                    box-shadow: 0 -8px 32px rgba(0,0,0,0.2);
                    display: none; animation: slideUp 0.2s ease-out;
                }
                .command-popup.show { display: block; }
                @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                
                .command-item {
                    padding: 10px 12px; border-radius: 8px; cursor: pointer;
                    display: flex; align-items: center; gap: 10px;
                    transition: all 0.15s ease;
                }
                .command-item:hover, .command-item.selected { background: var(--bg-hover); }
                .command-item.selected { outline: 1px solid var(--accent); }
                .cmd-key {
                    font-family: 'JetBrains Mono', monospace; font-size: 12px;
                    font-weight: 600; color: var(--accent); min-width: 70px;
                }
                .cmd-desc { font-size: 12px; color: var(--text-secondary); }

                /* File Popup */
                .file-popup {
                    position: absolute; bottom: 100%; left: 0; right: 0;
                    background: var(--bg-app); border: 1px solid var(--border);
                    border-radius: 12px; padding: 6px; margin-bottom: 8px;
                    box-shadow: 0 -8px 32px rgba(0,0,0,0.2);
                    max-height: 240px; overflow-y: auto;
                    display: none; animation: slideUp 0.15s ease-out;
                }
                .file-popup.show { display: block; }

                .file-item {
                    padding: 6px 10px; border-radius: 6px; cursor: pointer;
                    display: flex; align-items: center; gap: 10px;
                    font-size: 13px; color: var(--text-secondary);
                    transition: all 0.1s ease;
                }
                .file-item:hover, .file-item.selected { background: var(--bg-hover); color: var(--text-primary); }
                .file-item.selected { outline: 1px solid var(--accent); }
                
                .file-icon { 
                    font-size: 16px; width: 16px; height: 16px; 
                    display: flex; align-items: center; justify-content: center;
                    opacity: 0.8;
                }
                
                .file-info {
                    display: flex; flex-direction: column; overflow: hidden;
                }
                .file-name {
                    font-weight: 500; font-size: 13px; color: var(--text-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .file-path {
                    font-size: 10px; color: var(--text-secondary); opacity: 0.7;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                
                /* Icon Colors */
                .icon-ts { color: #3178c6; }
                .icon-js { color: #f7df1e; }
                .icon-json { color: #f1c40f; }
                .icon-md { color: #adadad; }
                .icon-css { color: #264de4; }
                .icon-html { color: #e34c26; }
                .icon-py { color: #3572A5; }

            </style>
        </head>
        <body>
            <header>
                <div class="brand">
                    <img src="${logoUri}" class="logo-img" alt="Logo">
                    Byte AI
                </div>
                <div class="header-actions">
                    <button class="btn-icon" onclick="newChat()" title="New Chat">${icons.plus}</button>
                    <button class="btn-icon" onclick="toggleDrawer()" title="History">${icons.history}</button>
                </div>
            </header>

            <div id="session-drawer">
                <div class="drawer-header">
                    HISTORY
                    <button class="btn-icon" onclick="toggleDrawer()" title="Close">×</button>
                </div>
                <div class="session-list" id="sessionList"></div>
                <div class="drawer-footer">
                    <button class="btn-clear" onclick="clearAllSessions()">${icons.trash} Clear All</button>
                </div>
            </div>

            <div id="chat-container">
                <div id="emptyState" class="empty-state">
                    <div class="empty-greeting">What can I help you build?</div>
                    <div class="empty-subtitle">Ask me anything about your code, or try one of these quick actions</div>
                    <div class="quick-actions">
                        <div class="action-card" onclick="executeCommand('explain')">
                            <div class="action-icon">💡</div>
                            <div class="action-title">Explain</div>
                            <div class="action-desc">Understand code logic</div>
                        </div>
                        <div class="action-card" onclick="executeCommand('fix')">
                            <div class="action-icon">🔧</div>
                            <div class="action-title">Fix Bugs</div>
                            <div class="action-desc">Debug & repair issues</div>
                        </div>
                        <div class="action-card" onclick="executeCommand('refactor')">
                            <div class="action-icon">✨</div>
                            <div class="action-title">Refactor</div>
                            <div class="action-desc">Improve code quality</div>
                        </div>
                        <div class="action-card" onclick="executeCommand('test')">
                            <div class="action-icon">🧪</div>
                            <div class="action-title">Test</div>
                            <div class="action-desc">Generate unit tests</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="input-section">
                <div class="command-popup" id="commandPopup">
                    <div class="command-item" onclick="selectCommand('explain')">
                        <span class="cmd-key">/explain</span> <span class="cmd-desc">Explain selected code</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('fix')">
                        <span class="cmd-key">/fix</span> <span class="cmd-desc">Fix bugs in selection</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('refactor')">
                        <span class="cmd-key">/refactor</span> <span class="cmd-desc">Refactor selection</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('test')">
                        <span class="cmd-key">/test</span> <span class="cmd-desc">Generate unit tests</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('doc')">
                        <span class="cmd-key">/doc</span> <span class="cmd-desc">Generate documentation</span>
                    </div>
                </div>
                
                <div class="input-box">
                     <div class="file-popup" id="filePopup"></div>
                    <textarea id="messageInput" placeholder="Ask anything, @ to mention, / for command..." rows="1"></textarea>
                    <div class="input-actions">
                        <button class="btn-send" id="sendBtn" title="Send">${icons.send}</button>
                        <button class="btn-stop" id="stopBtn" title="Stop Generation">${icons.stop}</button>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chat-container');
                const messageInput = document.getElementById('messageInput');
                const sendBtn = document.getElementById('sendBtn');
                const stopBtn = document.getElementById('stopBtn');
                const sessionDrawer = document.getElementById('session-drawer');
                const sessionList = document.getElementById('sessionList');
                const commandPopup = document.getElementById('commandPopup');
                const filePopup = document.getElementById('filePopup');
                const emptyState = document.getElementById('emptyState');
                
                marked.setOptions({
                    highlight: function(code, lang) {
                        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                        return hljs.highlight(code, { language }).value;
                    },
                    langPrefix: 'hljs language-'
                });

                let isGenerating = false;
                let currentAssistantMessageDiv = null;
                
                // Debounce utility
                function debounce(fn, delay) {
                    let timeoutId;
                    return function(...args) {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(() => fn.apply(this, args), delay);
                    };
                }
                
                // Debounced file search
                // Debounced file search (Faster)
                const debouncedFileSearch = debounce((query) => {
                    vscode.postMessage({ type: 'getFiles', query: query });
                }, 100);

                // Auto-resize & Input Handler
                messageInput.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                    if (this.value === '') this.style.height = '24px';
                    
                    const val = this.value;
                    const cursorPos = this.selectionStart;
                    const textBeforeCursor = val.substring(0, cursorPos);
                    
                    // Find the last word before cursor
                    const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
                    const lastWord = lastSpaceIndex === -1 ? textBeforeCursor : textBeforeCursor.substring(lastSpaceIndex + 1);
                    
                    // Check for slash command - only at start or after space
                    if (lastWord.startsWith('/')) {
                        const search = lastWord.substring(1).toLowerCase();
                        filterCommands(search);
                        commandPopup.classList.add('show');
                        filePopup.classList.remove('show');
                    } else if (lastWord.startsWith('@')) {
                        const search = lastWord.substring(1);
                        debouncedFileSearch(search);
                        filePopup.classList.add('show');
                        commandPopup.classList.remove('show');
                    } else {
                        commandPopup.classList.remove('show');
                        filePopup.classList.remove('show');
                    }
                });

                const commands = [
                    { key: 'explain', desc: 'Explain selected code' },
                    { key: 'fix', desc: 'Fix bugs in selection' },
                    { key: 'refactor', desc: 'Refactor selection' },
                    { key: 'test', desc: 'Generate unit tests' },
                    { key: 'doc', desc: 'Generate documentation' }
                ];

                function filterCommands(search) {
                    const items = commandPopup.querySelectorAll('.command-item');
                    let hasVisible = false;
                    commands.forEach((cmd, i) => {
                        const item = items[i];
                        if (!item) return;
                        if (cmd.key.includes(search) || cmd.desc.toLowerCase().includes(search)) {
                            item.style.display = 'flex';
                            hasVisible = true;
                        } else {
                            item.style.display = 'none';
                        }
                    });
                    if (!hasVisible) {
                        commandPopup.classList.remove('show');
                    }
                }

                function selectCommand(cmd) {
                    // Replace the current /command in the input
                    const val = messageInput.value;
                    const cursorPos = messageInput.selectionStart;
                    const textBeforeCursor = val.substring(0, cursorPos);
                    const textAfterCursor = val.substring(cursorPos);
                    
                    // Find where the slash command starts
                    const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
                    const beforeSlash = lastSpaceIndex === -1 ? '' : textBeforeCursor.substring(0, lastSpaceIndex + 1);
                    
                    messageInput.value = beforeSlash + '/' + cmd + ' ' + textAfterCursor.trim();
                    commandPopup.classList.remove('show');
                    messageInput.focus();
                    
                    // Set cursor position after the inserted command
                    const newPos = beforeSlash.length + cmd.length + 2;
                    messageInput.setSelectionRange(newPos, newPos);
                }
                
                function executeCommand(cmd) {
                     vscode.postMessage({ type: 'setAndSendMessage', value: '/' + cmd });
                }

                // Close popups on click outside
                document.addEventListener('click', (e) => {
                    if (!commandPopup.contains(e.target) && e.target !== messageInput) {
                        commandPopup.classList.remove('show');
                    }
                    if (!filePopup.contains(e.target) && e.target !== messageInput) {
                        filePopup.classList.remove('show');
                    }
                });

                let selectedCommandIndex = -1;
                let selectedFileIndex = -1;

                messageInput.addEventListener('keydown', (e) => {
                    // Handle Escape key for both popups
                    if (e.key === 'Escape') {
                        commandPopup.classList.remove('show');
                        filePopup.classList.remove('show');
                        selectedCommandIndex = -1;
                        selectedFileIndex = -1;
                        return;
                    }
                    
                    // Arrow key navigation for command popup
                    if (commandPopup.classList.contains('show')) {
                        const visibleItems = Array.from(commandPopup.querySelectorAll('.command-item')).filter(i => i.style.display !== 'none');
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            selectedCommandIndex = Math.min(selectedCommandIndex + 1, visibleItems.length - 1);
                            updateCommandSelection(visibleItems);
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            selectedCommandIndex = Math.max(selectedCommandIndex - 1, 0);
                            updateCommandSelection(visibleItems);
                            return;
                        }
                        if (e.key === 'Enter' && selectedCommandIndex >= 0) {
                            e.preventDefault();
                            visibleItems[selectedCommandIndex]?.click();
                            selectedCommandIndex = -1;
                            return;
                        }
                    }
                    
                    // Arrow key navigation for file popup
                    if (filePopup.classList.contains('show')) {
                        const fileItems = Array.from(filePopup.querySelectorAll('.file-item'));
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            selectedFileIndex = Math.min(selectedFileIndex + 1, fileItems.length - 1);
                            updateFileSelection(fileItems);
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            selectedFileIndex = Math.max(selectedFileIndex - 1, 0);
                            updateFileSelection(fileItems);
                            return;
                        }
                        if (e.key === 'Enter' && selectedFileIndex >= 0) {
                            e.preventDefault();
                            fileItems[selectedFileIndex]?.click();
                            selectedFileIndex = -1;
                            return;
                        }
                    }
                    
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commandPopup.classList.remove('show');
                        filePopup.classList.remove('show');
                        sendMessage();
                    }
                });
                
                function updateCommandSelection(items) {
                    items.forEach((item, i) => {
                        item.classList.toggle('selected', i === selectedCommandIndex);
                    });
                }
                
                function updateFileSelection(items) {
                    items.forEach((item, i) => {
                        item.classList.toggle('selected', i === selectedFileIndex);
                    });
                }

                sendBtn.addEventListener('click', sendMessage);
                stopBtn.addEventListener('click', stopGeneration);
                
                function stopGeneration() {
                    vscode.postMessage({ type: 'stopGeneration' });
                    isGenerating = false;
                    sendBtn.style.display = 'flex';
                    stopBtn.style.display = 'none';
                    removeTypingIndicator();
                }

                function setInput(text) {
                    messageInput.value = text;
                    messageInput.style.height = 'auto';
                    messageInput.focus();
                }

                function sendMessage() {
                    const text = messageInput.value.trim();
                    if (!text || isGenerating) return;

                    appendMessage('user', text);
                    messageInput.value = '';
                    messageInput.style.height = 'auto'; // Reset properly
                    
                    isGenerating = true;
                    // Toggle Buttons
                    sendBtn.style.display = 'none';
                    stopBtn.style.display = 'flex';
                    
                    // Show typing indicator
                    showTypingIndicator();
                    
                    vscode.postMessage({ type: 'sendMessage', value: text });
                }

                let typingIndicatorDiv = null;

                function showTypingIndicator() {
                    if (typingIndicatorDiv) return;
                    
                    typingIndicatorDiv = document.createElement('div');
                    typingIndicatorDiv.className = 'typing-indicator';
                    typingIndicatorDiv.innerHTML = \`
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    \`;
                    chatContainer.appendChild(typingIndicatorDiv);
                    scrollToBottom();
                }

                function removeTypingIndicator() {
                    if (typingIndicatorDiv) {
                        typingIndicatorDiv.remove();
                        typingIndicatorDiv = null;
                    }
                }

                function appendMessage(role, text) {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = 'message ' + role;
                    
                    const content = document.createElement('div');
                    content.className = 'content';
                    content.innerHTML = role === 'assistant' 
                        ? (text ? marked.parse(text) : '') 
                        : text.replace(/\\n/g, '<br>');
                    
                    msgDiv.appendChild(content);
                    chatContainer.appendChild(msgDiv);
                    
                    scrollToBottom();
                    
                    // If assistant and text provided, process code blocks immediately
                    if (role === 'assistant' && text) {
                        enhanceCodeBlocks(msgDiv);
                    }

                    return content; // Return content div for updates
                }

                function updateAssistantMessage(text, isStream) {
                    // Remove typing indicator as soon as we have text
                    if (isStream && typingIndicatorDiv) {
                         removeTypingIndicator();
                         // Create the actual message div if it doesn't exist yet
                         if (!currentAssistantMessageDiv) {
                             currentAssistantMessageDiv = appendMessage('assistant', '');
                         }
                    } else if (!isStream && typingIndicatorDiv) {
                        // If we finished without streaming (fast response?), remove it
                        removeTypingIndicator();
                    }

                    if (currentAssistantMessageDiv) {
                        // Use marked to parse
                        currentAssistantMessageDiv.parentElement.querySelector('.content').innerHTML = marked.parse(text);
                        
                        // Enhance Code Blocks
                        enhanceCodeBlocks(currentAssistantMessageDiv.parentElement);
                        
                        scrollToBottom();
                    }
                    
                    if (!isStream) {
                        isGenerating = false;
                        sendBtn.style.display = 'flex';
                        stopBtn.style.display = 'none';
                        currentAssistantMessageDiv = null;
                    }
                }
                
                function enhanceCodeBlocks(container) {
                    const contentDiv = container.querySelector('.content');
                    if (!contentDiv) return;
                    
                    contentDiv.querySelectorAll('pre').forEach((pre) => {
                        // Check if already enhanced
                        if (pre.querySelector('.code-header')) return;
                        
                        const code = pre.querySelector('code');
                        if (!code) return;

                        // Highlight
                        hljs.highlightElement(code);
                        
                        // Detect language
                        const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
                        const lang = langClass ? langClass.replace('language-', '') : 'text';
                        
                        // Create Header
                        const header = document.createElement('div');
                        header.className = 'code-header';
                        header.innerHTML = \`
                            <div class="window-dots">
                                <div class="dot red"></div>
                                <div class="dot yellow"></div>
                                <div class="dot green"></div>
                            </div>
                            <span class="code-lang">\${lang.toUpperCase()}</span>
                        \`;
                        
                        // Copy Button
                        const copyBtn = document.createElement('button');
                        copyBtn.className = 'copy-btn';
                        copyBtn.innerHTML = '${icons.copy} Copy';
                        copyBtn.onclick = () => {
                            vscode.postMessage({ type: 'copyCode', value: code.innerText });
                            copyBtn.innerHTML = '${icons.check} Copied';
                            setTimeout(() => copyBtn.innerHTML = '${icons.copy} Copy', 2000);
                        };
                        header.appendChild(copyBtn);
                        
                        // Insert Button
                        const insertBtn = document.createElement('button');
                        insertBtn.className = 'copy-btn';
                        insertBtn.innerHTML = '${icons.zap} Insert';
                        insertBtn.title = 'Insert code at cursor in editor';
                        insertBtn.onclick = () => {
                            vscode.postMessage({ type: 'insertCode', value: code.innerText });
                            insertBtn.innerHTML = '${icons.check} Inserted';
                            setTimeout(() => insertBtn.innerHTML = '${icons.zap} Insert', 2000);
                        };
                        header.appendChild(insertBtn);
                        
                        // Insert header before code
                        pre.insertBefore(header, code);
                    });
                }

                function scrollToBottom() {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }

                // API handlers
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'addResponse':
                            updateAssistantMessage(message.value, message.isStream);
                            break;
                            
                        case 'newChat':
                            chatContainer.innerHTML = getEmptyStateHtml();
                            break;
                            
                        case 'loadSession':
                            chatContainer.innerHTML = '';
                             if (message.history && message.history.length > 0) {
                                message.history.forEach(m => {
                                    if (m.role !== 'system') appendMessage(m.role, m.text);
                                });
                            } else {
                                chatContainer.innerHTML = getEmptyStateHtml();
                            }
                            break;
                            
                        case 'sessionList':
                            renderSessionList(message.sessions, message.currentSessionId);
                            break;

                        case 'setAndSendMessage':
                            messageInput.value = message.value;
                            messageInput.style.height = 'auto'; // Reset
                            sendMessage();
                            break;
                            
                        case 'fileList':
                           renderFiles(message.files);
                           break;
                    }
                });

                function getEmptyStateHtml() {
                    return \`
                        <div id="emptyState" class="empty-state">
                            <div class="empty-greeting">What can I help you build?</div>
                            <div class="empty-subtitle">Ask me anything about your code, or try one of these quick actions</div>
                            <div class="quick-actions">
                                <div class="action-card" onclick="executeCommand('explain')">
                                    <div class="action-icon">💡</div>
                                    <div class="action-title">Explain</div>
                                    <div class="action-desc">Understand code logic</div>
                                </div>
                                <div class="action-card" onclick="executeCommand('fix')">
                                    <div class="action-icon">🔧</div>
                                    <div class="action-title">Fix Bugs</div>
                                    <div class="action-desc">Debug & repair issues</div>
                                </div>
                                <div class="action-card" onclick="executeCommand('refactor')">
                                    <div class="action-icon">✨</div>
                                    <div class="action-title">Refactor</div>
                                    <div class="action-desc">Improve code quality</div>
                                </div>
                                <div class="action-card" onclick="executeCommand('test')">
                                    <div class="action-icon">🧪</div>
                                    <div class="action-title">Test</div>
                                    <div class="action-desc">Generate unit tests</div>
                                </div>
                            </div>
                        </div>
                    \`;
                }

                function renderFiles(files) {
                    filePopup.innerHTML = '';
                    if (!files || files.length === 0) {
                        filePopup.classList.remove('show');
                        return;
                    }
                    
                    files.forEach((file, index) => {
                        const div = document.createElement('div');
                        div.className = 'file-item';
                        if (index === selectedFileIndex) div.classList.add('selected');

                        // Determine Icon
                        const ext = file.path.split('.').pop().toLowerCase();
                        let iconChar = '📄';
                        let iconClass = 'file-icon';
                        
                        // Simple icon mapping
                        switch(ext) {
                            case 'ts': case 'tsx': iconChar = '{}'; iconClass += ' icon-ts'; break;
                            case 'js': case 'jsx': iconChar = '{}'; iconClass += ' icon-js'; break;
                            case 'json': iconChar = '{}'; iconClass += ' icon-json'; break;
                            case 'md': iconChar = 'M↓'; iconClass += ' icon-md'; break;
                            case 'css': case 'scss': iconChar = '#'; iconClass += ' icon-css'; break;
                            case 'html': iconChar = '<>'; iconClass += ' icon-html'; break;
                            case 'py': iconChar = 'py'; iconClass += ' icon-py'; break;
                            case 'png': case 'svg': case 'jpg': iconChar = '🖼️'; break;
                        }

                        // Split path for display
                        const pathParts = file.path.split('/');
                        const fileName = pathParts.pop();
                        const dirPath = pathParts.join('/');

                        div.innerHTML = \`
                            <span class="\${iconClass}">\${iconChar}</span>
                            <div class="file-info">
                                <span class="file-name">\${fileName}</span>
                                <span class="file-path">\${dirPath || './'}</span>
                            </div>
                        \`;
                        div.onclick = () => {
                            // Use cursor-aware replacement
                            const val = messageInput.value;
                            const cursorPos = messageInput.selectionStart;
                            const textBeforeCursor = val.substring(0, cursorPos);
                            const textAfterCursor = val.substring(cursorPos);
                            
                            // Find where the @ mention starts
                            const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
                            const beforeAt = lastSpaceIndex === -1 ? '' : textBeforeCursor.substring(0, lastSpaceIndex + 1);
                            
                            // Insert formatted file tag: @[path] for cleaner parsing if you want, 
                            // or just @path. User mentioned "@[images/logo.png]" earlier.
                            // Let's stick to simple path for now, or match user preference.
                            // Actually, let's just insert the path, standard logic.
                            messageInput.value = beforeAt + '@' + file.path + ' ' + textAfterCursor.trim();
                            
                            filePopup.classList.remove('show');
                            messageInput.focus();
                            
                            // Set cursor position
                            const newPos = beforeAt.length + file.path.length + 2;
                            messageInput.setSelectionRange(newPos, newPos);
                        };
                        filePopup.appendChild(div);
                    });
                }
                
                // Override appendMessage to hide empty state
                const originalAppendMessage = appendMessage;
                appendMessage = function(role, text) {
                    const es = document.getElementById('emptyState');
                    if (es) es.remove();
                    return originalAppendMessage(role, text);
                };

                function newChat() {
                    vscode.postMessage({ type: 'newChat' });
                }

                function toggleDrawer() { 
                    sessionDrawer.classList.toggle('open');
                    if (sessionDrawer.classList.contains('open')) vscode.postMessage({ type: 'getSessions' });
                }

                function clearAllSessions() { 
                    vscode.postMessage({ type: 'clearAllSessions' }); 
                    toggleDrawer();
                }

                function renderSessionList(sessions, currentId) {
                    sessionList.innerHTML = '';
                    if (sessions.length === 0) {
                        sessionList.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.5; font-size:12px;">No history</div>';
                        return;
                    }

                    const grouped = {
                        'Today': [],
                        'Yesterday': [],
                        'Previous 7 Days': [],
                        'Older': []
                    };

                    const now = new Date();
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    const lastWeek = new Date(now);
                    lastWeek.setDate(lastWeek.getDate() - 7);

                    sessions.forEach(s => {
                        const date = new Date(s.timestamp || Date.now());
                        if (date.toDateString() === now.toDateString()) {
                            grouped['Today'].push(s);
                        } else if (date.toDateString() === yesterday.toDateString()) {
                            grouped['Yesterday'].push(s);
                        } else if (date > lastWeek) {
                            grouped['Previous 7 Days'].push(s);
                        } else {
                            grouped['Older'].push(s);
                        }
                    });

                    Object.keys(grouped).forEach(key => {
                        if (grouped[key].length > 0) {
                            const header = document.createElement('div');
                            header.style.cssText = 'padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin-top: 8px;';
                            header.innerText = key;
                            sessionList.appendChild(header);

                            grouped[key].forEach(s => {
                                const div = document.createElement('div');
                                div.className = 'session-link ' + (s.id === currentId ? 'active' : '');
                                div.innerHTML = \`
                                    <span onclick="loadSession('\${s.id}')">\${s.title}</span>
                                    <span class="btn-delete-session" onclick="deleteSession('\${s.id}')">×</span>
                                \`;
                                sessionList.appendChild(div);
                            });
                        }
                    });
                }
                
                window.loadSession = (id) => {
                    vscode.postMessage({ type: 'loadSession', id: id });
                    sessionDrawer.classList.remove('open');
                };
                
                window.deleteSession = (id) => {
                    event.stopPropagation();
                    vscode.postMessage({ type: 'deleteSession', id: id });
                };

            </script>
        </body>
        </html>`;
    }
}
