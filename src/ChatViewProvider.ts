import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';
import { TerminalManager } from './terminalAccess';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { SystemDetector } from './systemDetector';
import { AgentPipeline } from './agentPipeline';
import { AGENT_PROMPT, PLAN_PROMPT } from './prompts';

const MAX_FILE_SIZE = 50000;

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _terminalManager: TerminalManager;
    private _workspaceAnalyzer: WorkspaceAnalyzer;
    private _agentPipeline: AgentPipeline;
    private _history: Array<{ role: 'user' | 'assistant' | 'system', text: string }> = [];
    private _isGenerating: boolean = false;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._client = new ByteAIClient();
        this._terminalManager = new TerminalManager();
        this._workspaceAnalyzer = new WorkspaceAnalyzer();
        this._agentPipeline = new AgentPipeline(); // Initialize the pipeline
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
                    await this.handleUserMessage(data.value, data.mode || 'agent');
                    break;
                case 'newChat':
                    this.handleNewChat();
                    break;
                case 'stopGeneration':
                    this.stopGeneration();
                    break;
                case 'error':
                    vscode.window.showErrorMessage('Webview Error: ' + data.value);
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
            this._history.push({ role: 'assistant', text: "*[Stopped by user]*" });
        }
    }

    // ... (File creation/editing methods remain the same, ensuring they are robust) ...
    private async processAndCreateFiles(text: string): Promise<void> {
        const fileRegex = /\$\$ FILE: ([^\$]+?) \$\$\s*```[\w]*\n([\s\S]*?)```/g;
        let match;
        while ((match = fileRegex.exec(text)) !== null) {
            const filepath = match[1].trim();
            const code = match[2];
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) continue;
            const fullPath = vscode.Uri.joinPath(workspaceFolders[0].uri, filepath);

            // Auto-create in Agent mode if verified (Concept) - sticking to Prompt for safety
            const selection = await vscode.window.showInformationMessage(
                `Byte AI wants to create file: "${filepath}"`, { modal: true }, "Create", "Cancel"
            );
            if (selection === "Create") {
                try {
                    await vscode.workspace.fs.writeFile(fullPath, Buffer.from(code, 'utf8'));
                    vscode.window.showInformationMessage(`Created: ${filepath}`);
                } catch (err: any) { vscode.window.showErrorMessage(`Failed to create: ${err.message}`); }
            }
        }
    }

    private async processAndEditFiles(text: string): Promise<void> {
        const editRegex = /\$\$ EDIT: ([^\$]+?) \$\$\s*<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE/g;
        let match;
        while ((match = editRegex.exec(text)) !== null) {
            const filepath = match[1].trim();
            const searchContent = match[2];
            const replaceContent = match[3];
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) continue;

            const fullPath = vscode.Uri.joinPath(workspaceFolders[0].uri, filepath);
            try { await vscode.workspace.fs.stat(fullPath); } catch { continue; }

            const selection = await vscode.window.showInformationMessage(
                `Byte AI wants to edit: "${filepath}"`,
                { modal: true, detail: `Replacing content in ${filepath}` },
                "Accept", "Preview", "Reject"
            );

            if (selection === "Accept" || selection === "Preview") {
                try {
                    const doc = await vscode.workspace.openTextDocument(fullPath);
                    const originalContent = doc.getText();
                    let newContent = originalContent.replace(searchContent.trimEnd(), replaceContent.trimEnd());

                    // Fallback regex search
                    if (newContent === originalContent) {
                        const regexSearch = searchContent.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
                        const regex = new RegExp(regexSearch, '');
                        const regexMatch = originalContent.match(regex);
                        if (regexMatch) newContent = originalContent.replace(regexMatch[0], replaceContent.trim());
                    }

                    if (selection === "Preview") {
                        const tempUri = vscode.Uri.parse(`untitled:${filepath}.proposed`);
                        const tempDoc = await vscode.workspace.openTextDocument(tempUri);
                        const tempEditor = await vscode.window.showTextDocument(tempDoc);
                        await tempEditor.edit(edit => edit.insert(new vscode.Position(0, 0), newContent));
                        vscode.commands.executeCommand('vscode.diff', fullPath, tempUri, `${filepath} (Proposed)`);
                    } else {
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(fullPath, new vscode.Range(doc.positionAt(0), doc.positionAt(originalContent.length)), newContent);
                        await vscode.workspace.applyEdit(edit);
                        await doc.save();
                    }
                } catch (e: any) { vscode.window.showErrorMessage("Edit failed: " + e.message); }
            }
        }
    }

    public async runCommand(command: 'explain' | 'fix' | 'doc' | 'refactor' | 'test') {
        if (!this._view) await vscode.commands.executeCommand('byteAI.chatView.focus');
        if (this._view) await this.handleUserMessage("/" + command, 'agent');
    }

    public clearChat() {
        this._history = [];
        this._client.resetSession();
        this._view?.webview.postMessage({ type: 'clearChat' });
    }

    public handleNewChat() {
        this._client.resetSession();
        this._history.push({ role: 'system', text: '--- New Session ---' });
        this._view?.webview.postMessage({ type: 'newChat' });
    }

    private async handleUserMessage(message: string, mode: string = 'agent') {
        if (!this._view) { return; }
        this._history.push({ role: 'user', text: message });

        let fullContext = "";

        // --- MULTI-AGENT PIPELINE EXECUTION ---
        if (mode === 'agent') {
            // 1. Analyzer
            const analysis = await this._agentPipeline.analyzeInput(message);
            // 2. Evaluator
            const evaluation = await this._agentPipeline.evaluateContext(analysis);
            // 3. Context Builder
            fullContext = this._agentPipeline.buildContext(evaluation, analysis);

            // Add File Structure if complex
            if (analysis.complexity === 'complex') {
                fullContext += `\n[WORKSPACE STRUCTURE]:\n${await this._workspaceAnalyzer.getFileStructure()}`;
            }
        } else {
            // Plan mode: Simple context
            const editor = vscode.window.activeTextEditor;
            if (editor) fullContext += `\n[ACTIVE FILE]:\n${editor.document.getText()}`;
        }

        fullContext += `\n\n${SystemDetector.getContextString()}`;
        const prompt = `${mode === 'plan' ? PLAN_PROMPT : AGENT_PROMPT}\n\n[CONTEXT]:\n${fullContext}\n\n[REQUEST]: ${message}`;

        try {
            this._isGenerating = true;
            this._view.webview.postMessage({ type: 'setLoading', value: true });

            const fullResponse = await this._client.streamResponse(prompt,
                (chunk) => {
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
                if (mode === 'agent' && fullResponse) {
                    await this._terminalManager.processAndExecute(fullResponse);
                    await this.processAndCreateFiles(fullResponse);
                    await this.processAndEditFiles(fullResponse);
                }
            }
        } catch (error: any) {
            this._view.webview.postMessage({ type: 'addResponse', value: "Error: " + error.message, isStream: false });
        } finally {
            this._isGenerating = false;
            this._view?.webview.postMessage({ type: 'setLoading', value: false });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));
        const escapedHistory = JSON.stringify(this._history).replace(/</g, '\\u003c');
        const icons = {
            add: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 7v1H9v5H8V8H3V7h5V2h1v5h5z"/></svg>`,
            trash: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11 2H9c0-.55-.45-1-1-1H8c-.55 0-1 .45-1 1H5c-.55 0-1 .45-1 1H5c-.55 0-1 .45-1 1v1H3v1h1v9c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V5h1V4h-1V3c0-.55-.45-1-1-1zM8 2h.5l-.5.5h-1l.5.5H8V2zm4 11H4V5h8v8z"/></svg>`,
            send: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M1.5 1.5l13.25 5.75L1.5 13V9l9-1.75-9-.75V1.5z"/></svg>`,
            stop: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2 2h12v12H2V2z"/></svg>`,
            copy: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M4 4h8v8H4V4zm-1-1v10h10V3H3zm12 11h-9v1h9V14z"/></svg>`,
            user: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`,
            bot: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H4v6h2v3h4v-3h2V5h-2V4a2 2 0 0 0-2-2zm0 1a1 1 0 0 1 1 1v1H7V4a1 1 0 0 1 1-1zm-3 8V6h6v5H5z"/></svg>`
        };

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${webview.cspSource} https: data:;">
            <style>
                :root { 
                    --bg-color: var(--vscode-sideBar-background); 
                    --text-color: var(--vscode-sideBar-foreground); 
                    --input-bg: var(--vscode-input-background); 
                    --accent-color: var(--vscode-button-background); 
                    --border-color: var(--vscode-panel-border);
                }
                body { font-family: var(--vscode-font-family); background-color: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; height: 100vh; margin: 0; }
                
                .chat-container { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
                .message { padding: 12px; border-radius: 8px; max-width: 90%; line-height: 1.5; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .user-msg { background: var(--accent-color); color: white; align-self: flex-end; }
                .assistant-msg { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; border: 1px solid var(--border-color); }
                
                .header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px; opacity: 0.7; }
                .avatar { width: 16px; height: 16px; border-radius: 50%; background: rgba(127,127,127,0.3); display: flex; align-items: center; justify-content: center; }

                /* Code Blocks & Markdown */
                .code-block { margin: 10px 0; background: var(--vscode-editor-background); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-color); }
                .code-header { background: rgba(0,0,0,0.1); padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; }
                .code-lang { font-size: 10px; font-weight: bold; opacity: 0.8; text-transform: uppercase; }
                .copy-btn { border: none; background: transparent; cursor: pointer; color: inherit; opacity: 0.7; display: flex; gap: 4px; font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid transparent; }
                .copy-btn:hover { background: rgba(255,255,255,0.1); opacity: 1; border-color: var(--border-color); }
                .copy-btn:hover { background: rgba(255,255,255,0.1); opacity: 1; }
                .code-content { padding: 10px; overflow-x: auto; font-family: 'Menlo', monospace; font-size: 12px; white-space: pre; }
                p { margin: 8px 0; }
                strong { color: #4ec9b0; } 

                /* Input Area */
                .input-area { padding: 15px; border-top: 1px solid var(--border-color); background: var(--bg-color); }
                .input-wrapper { display: flex; flex-direction: column; gap: 8px; background: var(--input-bg); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); transition: border 0.2s; }
                .input-wrapper:focus-within { border-color: var(--accent-color); }
                
                .top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
                .mode-select { background: transparent; color: var(--text-color); border: none; font-size: 11px; cursor: pointer; opacity: 0.8; }
                
                textarea { width: 100%; background: transparent; border: none; color: var(--text-color); outline: none; font-family: inherit; resize: none; min-height: 24px; max-height: 200px; }
                
                .action-row { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 4px; }
                .send-btn, .stop-btn { border: none; border-radius: 4px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
                .send-btn { background: var(--accent-color); color: white; }
                .stop-btn { background: #d9534f; color: white; display: none; }
                .send-btn:hover, .stop-btn:hover { opacity: 0.9; transform: scale(1.05); }

            </style>
        </head>
        <body>
            <div class="chat-container" id="chat">
                 <div class="message-wrapper">
                    <div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div>
                    <div class="message assistant-msg"><strong>System Ready.</strong><br>Agent v2.3.0 initialized.</div>
                 </div>
            </div>

            <div class="input-area">
                <div class="input-wrapper">
                    <div class="top-row">
                        <select id="modeSelect" class="mode-select">
                            <option value="agent">⚡ Agent (Full Access)</option>
                            <option value="plan">📝 Plan (Chat Only)</option>
                        </select>
                    </div>
                    <textarea id="promptInput" rows="1" placeholder="Type instructions here..."></textarea>
                    <div class="action-row">
                        <button id="stopBtn" class="stop-btn" title="Stop">${icons.stop}</button>
                        <button id="sendBtn" class="send-btn" title="Send">${icons.send}</button>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const promptInput = document.getElementById('promptInput');
                const sendBtn = document.getElementById('sendBtn');
                const stopBtn = document.getElementById('stopBtn');
                const modeSelect = document.getElementById('modeSelect');

                // Auto-resize
                promptInput.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                });

                // Send Logic
                function sendMessage() {
                    const text = promptInput.value.trim();
                    if(!text) return;
                    
                    addMessage('user', text);
                    vscode.postMessage({ type: 'sendMessage', value: text, mode: modeSelect.value });
                    
                    promptInput.value = '';
                    promptInput.style.height = 'auto';
                    setLoading(true);
                }

                function stopGeneration() {
                    vscode.postMessage({ type: 'stopGeneration' });
                    setLoading(false);
                }
                
                sendBtn.addEventListener('click', sendMessage);
                stopBtn.addEventListener('click', stopGeneration);
                promptInput.addEventListener('keydown', (e) => { 
                    if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } 
                });

                function setLoading(isLoading) {
                    sendBtn.style.display = isLoading ? 'none' : 'flex';
                    stopBtn.style.display = isLoading ? 'flex' : 'none';
                    promptInput.disabled = isLoading;
                }

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if(msg.type === 'addResponse') addMessage('bot', msg.value);
                    if(msg.type === 'setLoading') setLoading(msg.value);
                });

                function addMessage(role, text) {
                     // Check if last message is same role to append (optional for better UI)
                     // Simple implementation:
                     const wrapper = document.createElement('div');
                     
                     let headerHtml = '';
                     if(role === 'user') headerHtml = '<div class="header-row" style="justify-content: flex-end;">You <span class="avatar">${icons.user}</span></div>';
                     else headerHtml = '<div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div>';

                     wrapper.innerHTML = headerHtml + '<div class="message ' + (role === 'user' ? 'user-msg' : 'assistant-msg') + '">' + formatMarkdown(text) + '</div>';
                     chat.appendChild(wrapper);
                     chat.scrollTop = chat.scrollHeight;
                }

                function formatMarkdown(text) {
                    if(!text) return '';
                    let html = text
                        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // Escape HTML
                        .replace(/\\\`\\\`\\\`([a-z]*)\\n([\\s\\S]*?)\\\`\\\`\\\`/g,  // Code Blocks
                            (match, lang, code) => \`<div class="code-block"><div class="code-header"><span class="code-lang">\${lang||'CODE'}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText)">Copy</button></div><div class="code-content">\${code}</div></div>\`)
                        .replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>') // Inline Code
                        .replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>') // Bold
                        .replace(/\\n/g, '<br>'); // Newlines
                    return html;
                }
            </script>
        </body>
        </html>`;
    }
}
