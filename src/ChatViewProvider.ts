import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';
import { TerminalManager } from './terminalAccess';
import { SYSTEM_PROMPT } from './prompts';

const MAX_FILE_SIZE = 50000; // 50KB limit for context files to prevent lag

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _terminalManager: TerminalManager;
    private _history: Array<{ role: 'user' | 'assistant' | 'system', text: string }> = [];
    private _isGenerating: boolean = false;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._client = new ByteAIClient();
        this._terminalManager = new TerminalManager();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
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
                case 'insertCode':
                    await this.handleInsertCode(data.value);
                    break;
                case 'clearChat':
                    this.clearChat();
                    break;
                case 'newChat':
                    this.handleNewChat();
                    break;
                case 'stopGeneration':
                    this.stopGeneration();
                    break;
            }
        });
    }

    private stopGeneration() {
        if (this._isGenerating) {
            this._client.disconnect();
            this._isGenerating = false;
            this._view?.webview.postMessage({ type: 'setLoading', value: false });
            this._view?.webview.postMessage({ type: 'addResponse', value: "\n\n*[Stopped by user]*", isStream: false });

            // Add truncated response to history if needed, or just marking stopped
            this._history.push({ role: 'assistant', text: "*[Stopped by user]*" });
        }
    }

    private async handleInsertCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Code inserted!');
        } else {
            vscode.window.showErrorMessage('No active editor found to insert code.');
        }
    }

    public clearChat() {
        this._history = [];
        this._client.resetSession();
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
    }

    public handleNewChat() {
        this._client.resetSession();
        this._history.push({ role: 'system', text: '--- New Session ---' });
        if (this._view) {
            this._view.webview.postMessage({ type: 'newChat' });
        }
    }

    public async runCommand(command: 'explain' | 'fix' | 'doc' | 'refactor' | 'test') {
        if (!this._view) {
            await vscode.commands.executeCommand('byteAI.chatView.focus');
        }

        let message = "";
        switch (command) {
            case 'explain': message = "/explain"; break;
            case 'fix': message = "/fix"; break;
            case 'doc': message = "/doc"; break;
            case 'refactor': message = "/refactor"; break;
            case 'test': message = "/test"; break;
        }

        if (this._view) {
            await this.handleUserMessage(message);
        }
    }

    private async handleUserMessage(message: string) {
        if (!this._view) { return; }

        this._history.push({ role: 'user', text: message });

        // --- 1. Efficient Context Gathering ---
        let fullContext = "";
        const fileRegex = /@([a-zA-Z0-9_\-\.\/]+)/g;
        const matches = message.match(fileRegex);

        if (matches) {
            for (const match of matches) {
                const filename = match.substring(1);
                const files = await vscode.workspace.findFiles(`**/${filename}*`, '**/node_modules/**', 1);
                if (files.length > 0) {
                    const docUri = files[0];
                    // Check file size (approx check)
                    const stat = await vscode.workspace.fs.stat(docUri);
                    if (stat.size > MAX_FILE_SIZE) {
                        fullContext += `\n\n[CONTEXT FILE: ${docUri.fsPath}]\n*(File too large > 50KB, ignored for performance)*\n`;
                    } else {
                        const doc = await vscode.workspace.openTextDocument(docUri);
                        fullContext += `\n\n[CONTEXT FILE: ${docUri.fsPath}]\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\`\n`;
                    }
                }
            }
        }

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const text = editor.selection.isEmpty ? document.getText() : document.getText(editor.selection);

            // Truncate active editor context too if massive
            if (text.length > MAX_FILE_SIZE) {
                fullContext += `\n\n[ACTIVE EDITOR: ${document.fileName}]\n*(Content truncated... showing first 1000 chars)*\n\`\`\`${document.languageId}\n${text.substring(0, 1000)}...\n\`\`\``;
            } else {
                fullContext += `\n\n[ACTIVE EDITOR: ${document.fileName}]\n\`\`\`${document.languageId}\n${text}\n\`\`\``;
            }

            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            if (diagnostics.length > 0) {
                const errorMsg = diagnostics.map(d => `Line ${d.range.start.line + 1}: ${d.message}`).join('\n');
                fullContext += `\n\n[ERRORS DETECTED]:\n${errorMsg}`;
            }
        }

        // --- 2. Send Request ---
        const prompt = `${SYSTEM_PROMPT}\n\n[USER CONTEXT]:\n${fullContext}\n\n[USER REQUEST]: ${message}`;

        try {
            this._isGenerating = true;
            this._view.webview.postMessage({ type: 'setLoading', value: true });

            const fullResponse = await this._client.streamResponse(
                prompt,
                (chunk) => {
                    // If user stopped, don't update UI
                    if (!this._isGenerating) return;
                    this._view?.webview.postMessage({ type: 'addResponse', value: chunk, isStream: true });
                },
                (err) => {
                    this._isGenerating = false;
                    this._view?.webview.postMessage({ type: 'setLoading', value: false });
                    this._view?.webview.postMessage({ type: 'addResponse', value: "Error: " + err, isStream: false });
                }
            );

            if (this._isGenerating) {
                this._history.push({ role: 'assistant', text: fullResponse });

                // Auto-Execute Logic (optional, but keeping simple for now)
                if (fullResponse) {
                    // Check for commands?
                }
            }

        } catch (error: any) {
            // If manual disconnect, it throws error usually
            if (this._isGenerating) {
                this._view.webview.postMessage({ type: 'addResponse', value: "Error: " + error.message, isStream: false });
            }
        } finally {
            this._isGenerating = false;
            this._view?.webview.postMessage({ type: 'setLoading', value: false });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));
        const escapedHistory = JSON.stringify(this._history).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Byte AI</title>
            <style>
                :root {
                    --bg-color: var(--vscode-sideBar-background);
                    --text-color: var(--vscode-sideBar-foreground);
                    --input-bg: var(--vscode-input-background);
                    --input-fg: var(--vscode-input-foreground);
                    --border-color: var(--vscode-panel-border);
                    --accent-color: var(--vscode-button-background);
                    --accent-fg: var(--vscode-button-foreground);
                    --hover-color: var(--vscode-button-hoverBackground);
                    --danger-color: #ff5555;
                    --separator-color: var(--vscode-descriptionForeground);
                }
                body {
                    font-family: var(--vscode-font-family);
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    display: flex; flex-direction: column; height: 100vh;
                    margin: 0; padding: 0;
                }
                .header {
                    padding: 10px 15px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex; align-items: center; justify-content: space-between;
                    background: var(--bg-color);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    z-index: 10;
                }
                .brand { display: flex; align-items: center; gap: 10px; }
                .logo { width: 22px; height: 22px; object-fit: contain; }
                .brand h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; opacity: 0.9; }
                
                .actions { display: flex; gap: 10px; }
                .action-icon {
                    cursor: pointer; opacity: 0.6; font-size: 16px; transition: all 0.2s;
                    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
                    border-radius: 4px;
                }
                .action-icon:hover { opacity: 1; background: rgba(255,255,255,0.1); }
                .action-icon.danger:hover { color: var(--danger-color); }

                .chat-container {
                    flex: 1; overflow-y: auto; padding: 15px;
                    display: flex; flex-direction: column; gap: 18px;
                }
                .message {
                    padding: 12px 14px; border-radius: 8px; max-width: 88%;
                    font-size: 13px; line-height: 1.5;
                    word-wrap: break-word; position: relative;
                }
                .user { 
                    background: var(--accent-color); color: var(--accent-fg); 
                    align-self: flex-end; border-bottom-right-radius: 2px;
                }
                .assistant { 
                    background: var(--input-bg); border: 1px solid var(--border-color); 
                    align-self: flex-start; border-bottom-left-radius: 2px;
                }
                .system-separator {
                    align-self: center; font-size: 11px; color: var(--separator-color);
                    margin: 10px 0; display: flex; align-items: center; gap: 10px; width: 100%; justify-content: center;
                }
                .system-separator::before, .system-separator::after {
                    content: ""; height: 1px; background: var(--border-color); flex: 1;
                }
                
                .code-block {
                    margin-top: 10px; background: var(--vscode-editor-background);
                    border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden;
                }
                .code-header {
                    display: flex; justify-content: flex-end; padding: 4px 8px;
                    background: var(--vscode-editor-inactiveSelectionBackground); 
                    border-bottom: 1px solid var(--border-color); gap: 8px;
                }
                .code-header button {
                    background: transparent; border: none; color: var(--text-color);
                    font-size: 11px; cursor: pointer; opacity: 0.7; padding: 2px 6px; border-radius: 3px;
                }
                .code-header button:hover { opacity: 1; background: rgba(255,255,255,0.1); }
                .code-content {
                    padding: 12px; overflow-x: auto; font-family: 'Menlo', 'Monaco', 'Courier New', monospace; 
                    white-space: pre; font-size: 12px;
                }

                .input-area {
                    padding: 12px 15px 15px; border-top: 1px solid var(--border-color);
                    display: flex; flex-direction: column; gap: 10px;
                    background: var(--bg-color);
                }
                .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
                .chips::-webkit-scrollbar { display: none; }
                
                .chip {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--border-color);
                    padding: 4px 12px; border-radius: 100px;
                    font-size: 11px; cursor: pointer; white-space: nowrap; transition: all 0.2s;
                }
                .chip:hover { 
                    transform: translateY(-1px); 
                    background: var(--vscode-button-secondaryHoverBackground);
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                .input-container {
                    display: flex; background: var(--input-bg);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 8px; padding: 4px 4px 4px 10px;
                    transition: border-color 0.2s;
                }
                .input-container:focus-within { border-color: var(--accent-color); }
                
                input {
                    flex: 1; padding: 8px 0; background: transparent; color: var(--input-fg);
                    border: none; outline: none; font-size: 13px; font-family: inherit;
                }
                
                .controls { display: flex; align-items: center; justify-content: space-between; min-height: 20px; }
                .loading {
                    font-size: 11px; color: var(--text-color); opacity: 0.7; display: flex; align-items: center; gap: 6px;
                    display: none;
                }
                .loading::before {
                    content: ""; width: 8px; height: 8px; border: 2px solid var(--text-color);
                    border-top-color: transparent; border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }

                .stop-btn {
                    background: var(--danger-color); color: white; border: none;
                    border-radius: 4px; padding: 4px 10px; font-size: 10px; cursor: pointer;
                    display: none; font-weight: 600; letter-spacing: 0.5px;
                }

                .send-btn {
                    background: transparent; border: none; cursor: pointer;
                    color: var(--accent-color); padding: 0 10px; display: flex; align-items: center;
                    opacity: 0.8; transition: opacity 0.2s;
                }
                .send-btn:hover { opacity: 1; transform: scale(1.1); }

                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 3px; }
                ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.5); }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="brand">
                    <img src="${logoUri}" class="logo" />
                    <h3>Byte Coder</h3>
                </div>
                <div class="actions">
                    <span class="action-icon" onclick="newChat()" title="New Chat (+)">➕</span>
                    <span class="action-icon danger" onclick="clearChat()" title="Clear History">🗑️</span>
                </div>
            </div>
            <div class="chat-container" id="chat">
                 <div class="message assistant">
                    <strong>Byte Coder v1.3 Online.</strong><br>
                    I'm ready to help you code.
                </div>
            </div>
            <div class="input-area">
                 <div class="controls">
                    <div id="loadingIndicator" class="loading">Thinking...</div>
                    <button id="stopBtn" class="stop-btn" onclick="stopGeneration()">STOP</button>
                 </div>
                <div class="chips">
                    <button class="chip" onclick="setInput('/plan ')">⚡ Plan</button>
                    <button class="chip" onclick="setInput('/fix ')">🐛 Fix</button>
                    <button class="chip" onclick="setInput('/refactor ')">🛠️ Refactor</button>
                    <button class="chip" onclick="setInput('/test ')">🧪 Test</button>
                    <button class="chip" onclick="setInput('/explain ')">❓ Explain</button>
                </div>
                <div class="input-container">
                    <input type="text" id="input" placeholder="Ask anything..." autocomplete="off"/>
                    <button class="send-btn" onclick="sendMessage()">➤</button>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const input = document.getElementById('input');
                const loadingIndicator = document.getElementById('loadingIndicator');
                const stopBtn = document.getElementById('stopBtn');
                let currentAssistantMessageDiv = null;

                const history = ${escapedHistory};
                history.forEach(msg => {
                    if (msg.role === 'system') {
                        addSeparator(msg.text);
                    } else {
                        addMessage(msg.role, msg.text);
                    }
                });

                function setInput(text) { input.value = text; input.focus(); }
                
                function clearChat() {
                    chat.innerHTML = '';
                    vscode.postMessage({ type: 'clearChat' });
                }

                function newChat() {
                    addSeparator('--- New Session ---');
                    vscode.postMessage({ type: 'newChat' });
                }

                function stopGeneration() {
                    vscode.postMessage({ type: 'stopGeneration' });
                }

                function sendMessage() {
                    const text = input.value;
                    if (!text) return;
                    addMessage('user', text);
                    vscode.postMessage({ type: 'sendMessage', value: text });
                    input.value = '';
                    currentAssistantMessageDiv = null;
                }

                input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'addResponse':
                            updateAssistantMessage(message.value);
                            break;
                        case 'setLoading':
                            const isLoading = message.value;
                            loadingIndicator.style.display = isLoading ? 'flex' : 'none';
                            stopBtn.style.display = isLoading ? 'block' : 'none';
                            break;
                        case 'clearChat':
                             chat.innerHTML = ''; 
                             break;
                        case 'newChat':
                             // Separator already added by local function for immediate feedback
                             break;
                    }
                });

                function addSeparator(text) {
                    const div = document.createElement('div');
                    div.className = 'system-separator';
                    div.innerText = text;
                    chat.appendChild(div);
                    chat.scrollTop = chat.scrollHeight;
                }

                function addMessage(role, text) {
                    const div = document.createElement('div');
                    div.className = 'message ' + role;
                    div.innerHTML = formatText(text);
                    chat.appendChild(div);
                    chat.scrollTop = chat.scrollHeight;
                }

                function updateAssistantMessage(text) {
                    if (!currentAssistantMessageDiv) {
                        currentAssistantMessageDiv = document.createElement('div');
                        currentAssistantMessageDiv.className = 'message assistant';
                        chat.appendChild(currentAssistantMessageDiv);
                    }
                    currentAssistantMessageDiv.innerHTML = formatText(text); 
                    chat.scrollTop = chat.scrollHeight;
                }

                function formatText(text) {
                    return text.replace(/\`\`\`([\s\S]*?)\`\`\`/g, (match, code) => {
                        const cleanCode = code.replace(/^[a-z]+\n/, '')
                                           .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        return \`<div class="code-block">
                                    <div class="code-header">
                                        <button onclick="copyCode(this)">Copy</button>
                                        <button onclick="insertCode(this)">Insert</button>
                                        <div style="display:none">\${cleanCode}</div>
                                    </div>
                                    <div class="code-content">\${cleanCode}</div>
                                </div>\`;
                    }).replace(/\\n/g, '<br>');
                }

                window.copyCode = (btn) => {
                    const code = btn.nextElementSibling.nextElementSibling.innerText;
                    navigator.clipboard.writeText(code);
                    btn.innerText = "Copied!";
                    setTimeout(() => btn.innerText = "Copy", 1500);
                }

                window.insertCode = (btn) => {
                    const code = btn.nextElementSibling.innerText;
                     vscode.postMessage({ type: 'insertCode', value: code });
                }
            </script>
        </body>
        </html>`;
    }
}
