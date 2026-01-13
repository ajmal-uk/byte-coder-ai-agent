import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';
import { TerminalManager } from './terminalAccess';
import { AGENT_PERSONAS } from './agents';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _terminalManager: TerminalManager;

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
            }
        });
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
            this._view.webview.postMessage({ type: 'addResponse', value: `*Running command: ${message}*` });
            await this.handleUserMessage(message);
        }
    }

    private async handleUserMessage(message: string) {
        if (!this._view) { return; }
        let fullContext = "";

        // 1. Resolve @ Mentions
        const fileRegex = /@([a-zA-Z0-9_\-\.\/]+)/g;
        const matches = message.match(fileRegex);

        if (matches) {
            for (const match of matches) {
                const filename = match.substring(1);
                const files = await vscode.workspace.findFiles(`**/${filename}*`, '**/node_modules/**', 1);
                if (files.length > 0) {
                    const doc = await vscode.workspace.openTextDocument(files[0]);
                    fullContext += `\n\n[CONTEXT FILE: ${files[0].fsPath}]\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\`\n`;
                }
            }
        }

        // 2. Active Editor Context
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const text = selection.isEmpty ? document.getText() : document.getText(selection);

            fullContext += `\n\n[ACTIVE EDITOR: ${document.fileName}]\n\`\`\`${document.languageId}\n${text}\n\`\`\``;

            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            if (diagnostics.length > 0) {
                const errorMsg = diagnostics.map(d => `Line ${d.range.start.line + 1}: ${d.message}`).join('\n');
                fullContext += `\n\n[ERRORS DETECTED]:\n${errorMsg}`;
            }
        }

        // 3. Agent Routing
        let systemPrompt = AGENT_PERSONAS.ORCHESTRATOR;
        if (message.startsWith('/plan')) {
            systemPrompt = AGENT_PERSONAS.PLANNER;
            message = message.replace('/plan', '').trim();
        } else if (message.startsWith('/fix') || message.includes('fix')) {
            systemPrompt = AGENT_PERSONAS.REVIEWER;
        }

        const prompt = `${systemPrompt}\n\n[USER CONTEXT]:\n${fullContext}\n\n[USER REQUEST]: ${message}`;

        // 4. Send
        try {
            const fullResponse = await this._client.streamResponse(
                prompt,
                (chunk) => {
                    this._view?.webview.postMessage({ type: 'addResponse', value: chunk });
                },
                (err) => {
                    this._view?.webview.postMessage({ type: 'addResponse', value: "Error: " + err });
                }
            );

            if (fullResponse) {
                this._terminalManager.processAndExecute(fullResponse);
            }

        } catch (error: any) {
            this._view?.webview.postMessage({ type: 'addResponse', value: "Error: " + error.message });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
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
                }
                body {
                    font-family: var(--vscode-font-family);
                    padding: 0;
                    margin: 0;
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }
                .header {
                    padding: 15px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: var(--bg-color);
                    z-index: 10;
                }
                .header h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .status-badge {
                    font-size: 10px;
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 2px 6px;
                    border-radius: 4px;
                }
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 15px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                .message {
                    padding: 12px 16px;
                    border-radius: 8px;
                    position: relative;
                    word-wrap: break-word;
                    line-height: 1.5;
                    font-size: 13px;
                    max-width: 90%;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
                .user {
                    background: var(--accent-color);
                    color: var(--accent-fg);
                    align-self: flex-end;
                    border-bottom-right-radius: 2px;
                }
                .assistant {
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--border-color);
                    align-self: flex-start;
                    border-bottom-left-radius: 2px;
                }
                
                /* Code Blocks */
                .code-block {
                    margin-top: 10px;
                    background: var(--vscode-textBlockQuote-background);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    overflow: hidden;
                }
                .code-header {
                    display: flex;
                    justify-content: flex-end;
                    padding: 4px 8px;
                    background: rgba(0,0,0,0.1);
                    border-bottom: 1px solid var(--border-color);
                    gap: 8px;
                }
                .code-header button {
                    background: transparent;
                    border: none;
                    color: var(--text-color);
                    font-size: 11px;
                    cursor: pointer;
                    opacity: 0.7;
                }
                .code-header button:hover { opacity: 1; color: var(--accent-color); }
                .code-content {
                    padding: 10px;
                    overflow-x: auto;
                    font-family: 'Courier New', Courier, monospace;
                    white-space: pre;
                }

                .input-area {
                    padding: 15px;
                    background: var(--bg-color);
                    border-top: 1px solid var(--border-color);
                }
                .input-container {
                    display: flex;
                    background: var(--input-bg);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    padding: 4px;
                }
                .input-container:focus-within {
                    border-color: var(--vscode-focusBorder);
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                }
                input {
                    flex: 1;
                    padding: 10px;
                    background: transparent;
                    color: var(--input-fg);
                    border: none;
                    outline: none;
                    font-family: inherit;
                    font-size: 13px;
                }
                .btn-send {
                    background: transparent;
                    border: none;
                    color: var(--text-color);
                    cursor: pointer;
                    padding: 0 10px;
                    opacity: 0.7;
                    display: flex;
                    align-items: center;
                }
                .btn-send:hover { opacity: 1; color: var(--accent-color); }
                ::-webkit-scrollbar { width: 4px; }
                ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
                ::-webkit-scrollbar-track { background: transparent; }
            </style>
        </head>
        <body>
            <div class="header">
                <h3>Byte Coder v2.1</h3>
                <span class="status-badge">ONLINE</span>
            </div>
            <div class="chat-container" id="chat">
                <div class="message assistant">
                    <strong>👋 Byte Coder v2.1 Online.</strong><br><br>
                    <strong>Interactive Mode:</strong><br>
                    • Mention files: <code>@filename</code><br>
                    • Agents: <code>/plan</code>, <code>/fix</code><br>
                    • <strong>NEW:</strong> One-click Insert Code! ⚡
                </div>
            </div>
            <div class="input-area">
                <div class="input-container">
                    <input type="text" id="input" placeholder="Ask anything... (@filename for context)" autocomplete="off"/>
                    <button class="btn-send" id="sendBtn">➤</button>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const input = document.getElementById('input');
                const sendBtn = document.getElementById('sendBtn');
                let currentAssistantMessageDiv = null;
                let buffer = "";

                function sendMessage() {
                    const text = input.value;
                    if (!text) return;
                    addMessage('user', text);
                    vscode.postMessage({ type: 'sendMessage', value: text });
                    input.value = '';
                    currentAssistantMessageDiv = null;
                    buffer = "";
                }

                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') sendMessage();
                });
                
                sendBtn.addEventListener('click', sendMessage);

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'addResponse':
                            buffer += message.value;
                            updateAssistantMessage(buffer);
                            break;
                        case 'clearChat':
                            chat.innerHTML = '';
                            buffer = "";
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
                    // Detect Code Blocks
                    const codeBlockRegex = /\`\`\`([\s\S]*?)\`\`\`/g;
                    
                    return text.replace(codeBlockRegex, (match, code) => {
                        const cleanCode = code.replace(/^[a-z]+\n/, ''); // Remove language identifier if present
                        // Escape HTML in code
                        const safeCode = cleanCode.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        const rawCode = cleanCode.replace(/"/g, "&quot;");
                        
                        return \`<div class="code-block">
                                    <div class="code-header">
                                        <button onclick="copyCode(this)">Copy</button>
                                        <button onclick="insertCode(this)">Insert</button>
                                        <div style="display:none" class="raw-code">\${safeCode}</div>
                                    </div>
                                    <div class="code-content">\${safeCode}</div>
                                </div>\`;
                    }).replace(/\\n/g, '<br>');
                }

                window.copyCode = (btn) => {
                    const code = btn.nextElementSibling.nextElementSibling.innerText;
                    navigator.clipboard.writeText(code);
                    const original = btn.innerText;
                    btn.innerText = "Copied!";
                    setTimeout(() => btn.innerText = original, 2000);
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
