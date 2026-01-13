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
    private _history: Array<{ role: 'user' | 'assistant', text: string }> = [];
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
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
    }

    public async runCommand(command: 'explain' | 'fix' | 'doc') {
        if (!this._view) {
            await vscode.commands.executeCommand('byteAI.chatView.focus');
        }

        let message = "";
        switch (command) {
            case 'explain': message = "/explain"; break;
            case 'fix': message = "/fix"; break;
            case 'doc': message = "/doc"; break;
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
                    --danger-color: #f48771;
                }
                body {
                    font-family: var(--vscode-font-family);
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    display: flex; flex-direction: column; height: 100vh;
                    margin: 0; padding: 0;
                }
                .header {
                    padding: 12px 15px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex; align-items: center; gap: 10px;
                    background: var(--bg-color);
                }
                .logo { width: 24px; height: 24px; object-fit: contain; }
                .header h3 { margin: 0; font-size: 14px; font-weight: 600; text-transform: uppercase; }
                
                .action-icon {
                    margin-left: auto; cursor: pointer; opacity: 0.6; font-size: 16px;
                }
                .action-icon:hover { opacity: 1; color: var(--danger-color); }

                .chat-container {
                    flex: 1; overflow-y: auto; padding: 15px;
                    display: flex; flex-direction: column; gap: 16px;
                }
                .message {
                    padding: 12px 16px; border-radius: 8px; max-width: 90%;
                    font-size: 13px; line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    word-wrap: break-word;
                }
                .user { background: var(--accent-color); color: var(--accent-fg); align-self: flex-end; }
                .assistant { background: var(--vscode-editor-background); border: 1px solid var(--border-color); align-self: flex-start; }
                
                .code-block {
                    margin-top: 10px; background: var(--vscode-textBlockQuote-background);
                    border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden;
                }
                .code-header {
                    display: flex; justify-content: flex-end; padding: 4px 8px;
                    background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-color); gap: 8px;
                }
                .code-header button {
                    background: transparent; border: none; color: var(--text-color);
                    font-size: 11px; cursor: pointer; opacity: 0.7;
                }
                .code-header button:hover { opacity: 1; color: var(--accent-color); }
                .code-content {
                    padding: 10px; overflow-x: auto; font-family: 'Courier New', monospace; white-space: pre;
                }

                .input-area {
                    padding: 10px 15px 15px; border-top: 1px solid var(--border-color);
                    display: flex; flex-direction: column; gap: 10px;
                }
                .chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; }
                .chip {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none; padding: 4px 10px; border-radius: 12px;
                    font-size: 11px; cursor: pointer; white-space: nowrap;
                }
                .chip:hover { opacity: 0.9; }

                .input-container {
                    display: flex; background: var(--input-bg);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px; padding: 4px;
                }
                input {
                    flex: 1; padding: 10px; background: transparent; color: var(--input-fg);
                    border: none; outline: none; font-size: 13px;
                }
                
                .controls { display: flex; align-items: center; justify-content: space-between; min-height: 20px; }
                .loading {
                    font-size: 11px; color: var(--text-color); opacity: 0.7; font-style: italic; display: none;
                }
                .stop-btn {
                    background: var(--danger-color); color: white; border: none;
                    border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;
                    display: none;
                }

                ::-webkit-scrollbar { width: 4px; }
                ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
            </style>
        </head>
        <body>
            <div class="header">
                <img src="${logoUri}" class="logo" />
                <h3>Byte Coder v1.1.0</h3>
                <span class="action-icon" onclick="clearChat()" title="Clear Chat">🗑️</span>
            </div>
            <div class="chat-container" id="chat">
                 <div class="message assistant">
                    <strong>Byte Coder v1.1.0 Ready.</strong><br>
                    Optimized for efficiency.
                </div>
            </div>
            <div class="input-area">
                 <div class="controls">
                    <div id="loadingIndicator" class="loading">Thinking...</div>
                    <button id="stopBtn" class="stop-btn" onclick="stopGeneration()">🛑 STOP</button>
                 </div>
                <div class="chips">
                    <button class="chip" onclick="setInput('/plan ')">Plan</button>
                    <button class="chip" onclick="setInput('/fix ')">Fix</button>
                    <button class="chip" onclick="setInput('/explain ')">Explain</button>
                </div>
                <div class="input-container">
                    <input type="text" id="input" placeholder="Type a message..." autocomplete="off"/>
                    <button onclick="sendMessage()" style="background:none;border:none;cursor:pointer;">➤</button>
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
                history.forEach(msg => addMessage(msg.role, msg.text));

                function setInput(text) { input.value = text; input.focus(); }
                
                function clearChat() {
                    chat.innerHTML = '';
                    vscode.postMessage({ type: 'clearChat' });
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
                            loadingIndicator.style.display = isLoading ? 'block' : 'none';
                            stopBtn.style.display = isLoading ? 'block' : 'none';
                            break;
                    }
                });

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
