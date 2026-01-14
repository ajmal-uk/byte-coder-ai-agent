import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';
import { TerminalManager } from './terminalAccess';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { SystemDetector } from './systemDetector';
import { AgentPipeline } from './agentPipeline';
import { AGENT_PROMPT, PLAN_PROMPT } from './agentPrompts';
import { VersionManager } from './agents/VersionManager';

const MAX_FILE_SIZE = 50000;

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _terminalManager: TerminalManager;
    private _workspaceAnalyzer: WorkspaceAnalyzer;
    private _agentPipeline: AgentPipeline;
    private _gitManager: VersionManager; // Uses Shadow VCS now
    private _history: Array<{ role: 'user' | 'assistant' | 'system', text: string, commitHash?: string }> = [];
    private _isGenerating: boolean = false;
    private _pendingContext: string = "";
    private _pendingUserMessage: string = "";
    private _currentSessionId: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._client = new ByteAIClient();
        this._terminalManager = new TerminalManager();
        this._workspaceAnalyzer = new WorkspaceAnalyzer();
        this._agentPipeline = new AgentPipeline();
        this._gitManager = new VersionManager(); // Shadow VCS
        this._currentSessionId = Date.now().toString();
    }


    private async saveCurrentSession() {
        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        const existingIdx = sessions.findIndex(s => s.id === this._currentSessionId);

        const sessionData = {
            id: this._currentSessionId,
            title: this._history.find(m => m.role === 'user')?.text.slice(0, 50) || 'New Session',
            timestamp: Date.now(),
            history: this._history
        };

        if (existingIdx !== -1) {
            sessions[existingIdx] = sessionData;
        } else {
            sessions.unshift(sessionData); // Newest first
        }

        // Keep only last 20 sessions to save space
        if (sessions.length > 20) sessions.pop();

        await this._context.globalState.update('byteAI_sessions', sessions);
    }

    private async loadSession(id: string) {
        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        const session = sessions.find(s => s.id === id);
        if (session) {
            this._currentSessionId = session.id;
            this._history = session.history;
            this._pendingContext = ""; // Reset pending context on load
            this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
        }
    }

    private async getSessions() {
        const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
        this._view?.webview.postMessage({
            type: 'sessionList',
            sessions: sessions.map(s => ({ id: s.id, title: s.title, timestamp: s.timestamp }))
        });
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
                case 'executePlan':
                    await this.executePendingPlan();
                    break;
                case 'searchFiles':
                    await this.handleFileSearch(data.query);
                    break;
                case 'resetToMessage':
                    this.handleResetToMessage(data.index);
                    break;
                case 'newChat':
                    this.handleNewChat();
                    break;
                case 'getSessions':
                    await this.getSessions();
                    break;
                case 'loadSession':
                    await this.loadSession(data.id);
                    break;
                case 'stopGeneration':
                    this.stopGeneration();
                    break;
                case 'undoLast':
                    this.handleUndoLast();
                    break;
                case 'error':
                    vscode.window.showErrorMessage('Webview Error: ' + data.value);
                    break;
            }
        });
    }

    private async handleResetToMessage(index: number) {
        if (index >= 0 && index < this._history.length) {
            const targetMsg = this._history[index];
            const targetHash = targetMsg.commitHash;

            if (targetHash && this._gitManager) {
                const result = await vscode.window.showWarningMessage(
                    `Resetting to this message will REVERT files to the state they were in at that time (${targetHash.substring(0, 7)}). \n\nALL CHANGES after this point will be LOST.`,
                    { modal: true },
                    "Revert & Reset", "Cancel"
                );
                if (result !== "Revert & Reset") return;

                const success = await this._gitManager.checkout(targetHash);
                if (!success) {
                    vscode.window.showErrorMessage("Failed to checkout commit. Git status might be unclean.");
                    return;
                }
            }

            // Keep messages up to this index (inclusive)
            this._history = this._history.slice(0, index + 1);

            // If it was a user message, we might want to reset potential pending state
            this._pendingContext = "";
            this._pendingUserMessage = "";

            // Refresh the webview to reflect the curtailed history
            if (this._view) {
                this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                this._view.webview.postMessage({ type: 'agentStatus', value: 'Timetravel complete.', status: 'idle' });
            }
            await this.saveCurrentSession();
        }
    }

    private async handleFileSearch(query: string) {
        if (!query || query.length < 2) return;
        const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 10);
        const results = files.map(f => ({
            label: vscode.workspace.asRelativePath(f),
            path: f.fsPath
        }));
        this._view?.webview.postMessage({ type: 'fileSearchResults', results });
    }

    private async executePendingPlan() {
        if (!this._pendingUserMessage || !this._view) return;

        this._view.webview.postMessage({ type: 'agentStatus', value: '⚡ Executing Approved Plan...', status: 'executing' });

        const prompt = `${AGENT_PROMPT}\n\n[CONTEXT]:\n${this._pendingContext}\n\n[USER APPROVED PLAN]: Execute the plan for: ${this._pendingUserMessage}`;

        // --- PIPELINE STEP 9: SAFETY CHECK ---
        const isSafe = await this._agentPipeline.safetyCheck(prompt);  // Check the full prompt/plan
        if (!isSafe) {
            this._view.webview.postMessage({ type: 'addResponse', value: "\n\n**🛑 SAFETY BLOCK**: The request contains potentially unsafe commands (like `rm -rf` or heavy deletions). Execution aborted.", isStream: false });
            this._view.webview.postMessage({ type: 'setLoading', value: false });
            this._history.push({ role: 'assistant', text: "**🛑 SAFETY BLOCK**: Unsafe command detected." });
            return;
        }

        await this.streamResponse(prompt, 'agent', true); // true = execute actions
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
        this._currentSessionId = Date.now().toString(); // New Session ID
        this._history = [];
        this._history.push({ role: 'system', text: '--- New Session ---' });
        this._view?.webview.postMessage({ type: 'newChat' });
        this.saveCurrentSession();
    }

    private async handleUserMessage(message: string, mode: string = 'agent') {
        if (!this._view) { return; }
        // Capture current state BEFORE processing
        const currentHash = await this._gitManager.getCurrentCommit();
        this._history.push({ role: 'user', text: message, commitHash: currentHash || undefined });
        await this.saveCurrentSession(); // Save user message immediately

        let fullContext = "";
        this._isGenerating = true;
        this._view.webview.postMessage({ type: 'setLoading', value: true });
        this._view.webview.postMessage({ type: 'agentStatus', value: 'Initializing Agents...', status: 'init' });

        // --- PIPELINE STEP 1: PROMPT ENHANCER ---
        this._view.webview.postMessage({ type: 'agentStatus', value: '✨ Enhancing Request...', status: 'analyzing' });
        const enhancedPrompt = await this._agentPipeline.enhancePrompt(message, SystemDetector.getContextString());

        // --- PIPELINE STEP 2 & 3: ANALYZE & PLAN ---
        this._view.webview.postMessage({ type: 'agentStatus', value: '🔍 Analyzing & Searching...', status: 'analyzing' });
        const analysis = await this._agentPipeline.analyzeInput(enhancedPrompt); // Use enhanced prompt
        const evaluation = await this._agentPipeline.evaluateContext(analysis);

        this._view.webview.postMessage({ type: 'agentStatus', value: '🏗️ Building Context...', status: 'planning' });
        fullContext = this._agentPipeline.buildContext(evaluation, analysis);
        fullContext += `\n\n${SystemDetector.getContextString()}`;

        // Store for execution phase
        this._pendingContext = fullContext;
        this._pendingUserMessage = message;

        // If Agent Mode -> PROPOSE PLAN FIRST (Don't execute yet)
        if (mode === 'agent') {
            const prompt = `${PLAN_PROMPT}\n\n[CONTEXT]:\n${fullContext}\n\n[REQUEST]: ${message}\n\n[INSTRUCTION]: Create a detailed implementation plan. DO NOT execute files yet. Wait for approval.`;
            await this.streamResponse(prompt, 'plan_review', false);
        } else {
            // Plan Mode -> Just chat
            const prompt = `${PLAN_PROMPT}\n\n[CONTEXT]:\n${fullContext}\n\n[REQUEST]: ${message}`;
            await this.streamResponse(prompt, 'plan', false);
        }
    }

    private async streamResponse(prompt: string, mode: string, executeActions: boolean) {
        if (!this._view) return;

        try {
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
                await this.saveCurrentSession(); // Save after response

                // If this was a Plan Proposal in Agent Mode, show "Proceed" button AND write to file
                if (mode === 'plan_review') {
                    // Write to file
                    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        const planUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'implementation_plan.md');
                        await vscode.workspace.fs.writeFile(planUri, Buffer.from(fullResponse, 'utf8'));

                        // Open file side-by-side
                        try {
                            const doc = await vscode.workspace.openTextDocument(planUri);
                            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
                        } catch (e) {
                            console.error("Could not open plan file:", e);
                        }
                    }

                    this._view.webview.postMessage({ type: 'showPlanReview' });
                }

                // Only execute if explicitly authorized (Phase 2 of Agent Mode)
                if (executeActions && fullResponse) {
                    await this._terminalManager.processAndExecute(fullResponse);
                    await this.processAndCreateFiles(fullResponse);
                    await this.processAndEditFiles(fullResponse);

                    // Update the Assistant Message with the new Post-Execution Commit Hash
                    const newHash = await this._gitManager.getCurrentCommit();
                    const lastMsgIndex = this._history.length - 1;
                    if (lastMsgIndex >= 0 && this._history[lastMsgIndex].role === 'assistant') {
                        this._history[lastMsgIndex].commitHash = newHash || undefined;
                    }

                    await this.saveCurrentSession(); // Save after execution
                }
            }
        } catch (error: any) {
            this._view.webview.postMessage({ type: 'addResponse', value: "Error: " + error.message, isStream: false });
        } finally {
            this._isGenerating = false;
            this._view.webview.postMessage({ type: 'setLoading', value: false });
            await this.saveCurrentSession();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));
        const escapedHistory = JSON.stringify(this._history).replace(/</g, '\\u003c');
        const icons = {
            undo: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>`,
            add: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 7v1H9v5H8V8H3V7h5V2h1v5h5z"/></svg>`,
            history: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>`,
            trash: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11 2H9c0-.55-.45-1-1-1H8c-.55 0-1 .45-1 1H5c-.55 0-1 .45-1 1H5c-.55 0-1 .45-1 1H5c-.55 0-1 .45-1 1H5c-.55 0-1 .45-1 1v1H3v1h1v9c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V5h1V4h-1V3c0-.55-.45-1-1-1zM8 2h.5l-.5.5h-1l.5.5H8V2zm4 11H4V5h8v8z"/></svg>`,
            send: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M1.5 1.5l13.25 5.75L1.5 13V9l9-1.75-9-.75V1.5z"/></svg>`,
            stop: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2 2h12v12H2V2z"/></svg>`,
            copy: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M4 4h8v8H4V4zm-1-1v10h10V3H3zm12 11h-9v1h9V14z"/></svg>`,
            user: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`,
            bot: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H4v6h2v3h4v-3h2V5h-2V4a2 2 0 0 0-2-2zm0 1a1 1 0 0 1 1 1v1H7V4a1 1 0 0 1 1-1zm-3 8V6h6v5H5z"/></svg>`,
            check: `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.485 1.431a.625.625 0 0 1 .884.884l-7.5 7.5a.625.625 0 0 1-.884 0l-3.5-3.5a.625.625 0 0 1 .884-.884L6.5 8.432l6.985-6.985z"/></svg>`,
            reset: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>`,
            chat: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2.5 3A1.5 1.5 0 0 1 4 1.5h8A1.5 1.5 0 0 1 13.5 3v7.5a1.5 1.5 0 0 1-1.5 1.5H8l-4 4V12H4a1.5 1.5 0 0 1-1.5-1.5V3z"/></svg>`,
            robot: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H4v6h2v3h4v-3h2V5h-2V4a2 2 0 0 0-2-2zm0 1a1 1 0 0 1 1 1v1H7V4a1 1 0 0 1 1-1zm-3 8V6h6v5H5zM3 5h-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5H3V5zm10 0v3h.5a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5H13z"/></svg>`
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
                    --success-color: #4ec9b0;
                }
                body { font-family: var(--vscode-font-family); background-color: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; height: 100vh; margin: 0; }
                
                .chat-container { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; scroll-behavior: smooth; }
                .message-wrapper { animation: fadeIn 0.3s ease; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

                .message { padding: 12px; border-radius: 8px; max-width: 90%; line-height: 1.5; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; }
                .user-msg { background: var(--accent-color); color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
                .assistant-msg { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; border: 1px solid var(--border-color); border-bottom-left-radius: 2px; }
                
                .header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px; opacity: 0.7; }
                .action-icon { cursor: pointer; opacity: 0.5; transition: all 0.2s; display: flex; align-items: center; padding: 2px; border-radius: 4px; }
                .action-icon:hover { opacity: 1; background: rgba(255,255,255,0.2); }

                .avatar { width: 16px; height: 16px; border-radius: 50%; background: rgba(127,127,127,0.3); display: flex; align-items: center; justify-content: center; }

                /* Status & Reasoning */
                .status-indicator { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-color); opacity: 0.8; margin-left: 4px; margin-bottom: 8px; animation: pulse 1.5s infinite; }
                @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
                .status-row { display: flex; align-items: center; gap: 6px; }
                
                /* Code Blocks & Markdown */
                .code-block { margin: 10px 0; background: var(--vscode-editor-background); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-color); }
                .code-header { background: rgba(0,0,0,0.1); padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; }
                .code-lang { font-size: 10px; font-weight: bold; opacity: 0.8; text-transform: uppercase; }
                .copy-btn { border: none; background: transparent; cursor: pointer; color: inherit; opacity: 0.7; display: flex; gap: 4px; font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid transparent; }
                .copy-btn:hover { background: rgba(255,255,255,0.1); opacity: 1; border-color: var(--border-color); }
                .code-content { padding: 10px; overflow-x: auto; font-family: 'Menlo', monospace; font-size: 12px; white-space: pre; }
                p { margin: 8px 0; }
                strong { color: #4ec9b0; } 

                /* Input Area */
                .input-area { padding: 15px; border-top: 1px solid var(--border-color); background: var(--bg-color); position: relative; }
                .input-wrapper { display: flex; flex-direction: column; gap: 8px; background: var(--input-bg); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); transition: border 0.2s; }
                .input-wrapper:focus-within { border-color: var(--accent-color); }
                
                .top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
                
                /* Segmented Mode Control */
                .mode-toggle { display: flex; background: rgba(0,0,0,0.1); border-radius: 4px; padding: 2px; gap: 2px; }
                .mode-btn { 
                    flex: 1; border: none; background: transparent; color: var(--text-color); 
                    font-size: 11px; font-weight: 500; cursor: pointer; padding: 4px 8px; 
                    border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 4px;
                    opacity: 0.6; transition: all 0.2s;
                }
                .mode-btn:hover { opacity: 0.9; background: rgba(255,255,255,0.05); }
                .mode-btn.active { background: var(--vscode-button-background); color: white; opacity: 1; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }

                textarea { width: 100%; background: transparent; border: none; color: var(--text-color); outline: none; font-family: inherit; resize: none; min-height: 24px; max-height: 200px; }
                
                .action-row { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 4px; }
                .send-btn, .stop-btn { border: none; border-radius: 4px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
                .send-btn { background: var(--accent-color); color: white; }
                .stop-btn { background: #d9534f; color: white; display: none; }
                .send-btn:hover, .stop-btn:hover { opacity: 0.9; transform: scale(1.05); }

                /* Autocomplete Popup */
                .autocomplete-popup {
                    position: absolute; bottom: 80px; left: 15px; width: 300px; max-height: 150px;
                    background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3); overflow-y: auto; display: none; z-index: 100;
                }
                .ac-item { padding: 6px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
                .ac-item:hover { background: var(--accent-color); color: white; }

                /* Plan Review Actions */
                .plan-actions { display: flex; gap: 10px; padding: 10px; justify-content: center; margin-bottom: 10px; }
                .plan-btn { padding: 8px 16px; border-radius: 4px; border: none; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; }
                .accent-btn { background: var(--success-color); color: #1e1e1e; }
                .secondary-btn { background: rgba(255,255,255,0.1); color: var(--text-color); }
                .accent-btn:hover { opacity: 0.9; transform: scale(1.02); }

            </style>
        </head>
        <body>
            <div class="chat-container" id="chat">
                 <div class="message-wrapper">
                    <div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div>
                    <div class="message assistant-msg"><strong>System Ready. v3.0.0</strong><br>History & Checkpoints Enabled.</div>
                 </div>
            </div>

            <!-- Status Indicator Floating Area -->
            <div id="statusArea" style="display:none; padding: 0 20px; margin-bottom: 10px;"></div>

            <!-- Review Actions (Hidden by default) -->
            <div id="reviewArea" class="plan-actions" style="display:none;">
                <button class="plan-btn secondary-btn" onclick="cancelPlan()">Modify Plan</button>
                <button class="plan-btn accent-btn" onclick="executePlan()">Proceed to Execute ${icons.send}</button>
            </div>

            <div class="input-area">
                <div id="acPopup" class="autocomplete-popup"></div>
                <div id="sessionList" class="session-list"></div>
                
                <div class="input-wrapper">
                    <div class="top-row">
                        <div class="mode-toggle">
                            <button class="mode-btn active" id="modePlan" onclick="setMode('plan')">${icons.chat} Consultant</button>
                            <button class="mode-btn" id="modeAgent" onclick="setMode('agent')">${icons.robot} Agent</button>
                        </div>
                        <div class="right-actions">
                             <button class="action-icon" id="undoBtn" title="Undo Last Change" onclick="undoLast()">${icons.undo}</button>
                             <button class="action-icon" id="historyBtn" title="History" onclick="toggleHistory()">${icons.history}</button>
                             <button class="action-icon" id="clearBtn" title="Clear Chat" onclick="clearChat()">${icons.trash}</button>
                        </div>
                    </div>
                    <textarea id="promptInput" rows="1" placeholder="Type a message or command..."></textarea>
                    <div class="action-row">
                        <button id="stopBtn" class="stop-btn" title="Stop">${icons.stop}</button>
                        <button id="sendBtn" class="send-btn" title="Send">${icons.send}</button>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                // ... (existing vars)
                const undoBtn = document.getElementById('undoBtn');

                // ... (existing code)

                function undoLast() {
                    if(confirm("Are you sure you want to revert the last commit? This acts like 'git reset --hard HEAD~1'.")) {
                        vscode.postMessage({ type: 'undoLast' });
                    }
                }

                function toggleHistory() {
                    // ... (existing)
                    if (sessionList.style.display === 'block') {
                        sessionList.style.display = 'none';
                    } else {
                        vscode.postMessage({ type: 'getSessions' });
                    }
                }
               
               // ...


        function setMode(mode) {
            currentMode = mode;
            if (mode === 'plan') {
                modePlanBtn.classList.add('active');
                modeAgentBtn.classList.remove('active');
                promptInput.placeholder = "Ask a question or discuss code...";
            } else {
                modeAgentBtn.classList.add('active');
                modePlanBtn.classList.remove('active');
                promptInput.placeholder = "Describe a task for the Agent to execute...";
            }
        }

        // Auto-resize
        promptInput.addEventListener('input', function (e) {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            handleAutocomplete(e);
        });

        // Autocomplete Logic
        function handleAutocomplete(e) {
            const val = promptInput.value;
            const cursor = promptInput.selectionStart;
            const lastAt = val.lastIndexOf('@', cursor);
            if (lastAt !== -1 && cursor - lastAt > 0 && cursor - lastAt < 20) {
                const query = val.substring(lastAt + 1, cursor);
                vscode.postMessage({ type: 'searchFiles', query });
            } else {
                acPopup.style.display = 'none';
            }
        }

        // Send Logic
        function sendMessage() {
            const text = promptInput.value.trim();
            if (!text) return;

            // Optimistically add message with null index (will be fixed on reload)
            addMessage('user', text, null);

            currentBotMessageDiv = null;
            reviewArea.style.display = 'none';
            vscode.postMessage({ type: 'sendMessage', value: text, mode: currentMode });

            promptInput.value = '';
            promptInput.style.height = 'auto';
            setLoading(true);
            acPopup.style.display = 'none';
        }

        function executePlan() {
            const btn = document.querySelector('.plan-btn.accent-btn');
            if (btn) {
                btn.innerText = "⏳ Executing...";
                btn.disabled = true;
                btn.style.opacity = "0.7";
            }

            addMessage('user', "✅ Proceed with Execution");
            currentBotMessageDiv = null;
            // Keep review area open for a moment or until response starts
            setTimeout(() => { reviewArea.style.display = 'none'; }, 500);

            vscode.postMessage({ type: 'executePlan' });
            setLoading(true);
        }

        function cancelPlan() {
            reviewArea.style.display = 'none';
            promptInput.focus();
            promptInput.value = "Actually, change the plan to: ";
        }

        function stopGeneration() {
            vscode.postMessage({ type: 'stopGeneration' });
            setLoading(false);
            currentBotMessageDiv = null;
            statusArea.style.display = 'none';
            reviewArea.style.display = 'none';
        }

        function resetTo(index) {
            if (index === null) return; // Cannot reset to pending message
            vscode.postMessage({ type: 'resetToMessage', index: index });
        }

        sendBtn.addEventListener('click', sendMessage);
        stopBtn.addEventListener('click', stopGeneration);
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });

        function setLoading(isLoading) {
            sendBtn.style.display = isLoading ? 'none' : 'flex';
            stopBtn.style.display = isLoading ? 'flex' : 'none';
            promptInput.disabled = isLoading;
            if (!isLoading) statusArea.style.display = 'none';
        }

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'addResponse') {
                statusArea.style.display = 'none';
                updateBotMessage(msg.value);
            }
            if (msg.type === 'setLoading') setLoading(msg.value);
            if (msg.type === 'agentStatus') updateStatus(msg.value);

            if (msg.type === 'showPlanReview') {
                reviewArea.style.display = 'flex';
                chat.scrollTop = chat.scrollHeight;
            }

            if (msg.type === 'fileSearchResults') {
                showAutocomplete(msg.results);
            }

            if (msg.type === 'clearChat') { chat.innerHTML = ''; currentBotMessageDiv = null; statusArea.style.display = 'none'; reviewArea.style.display = 'none'; }
            if (msg.type === 'newChat') { currentBotMessageDiv = null; statusArea.style.display = 'none'; reviewArea.style.display = 'none'; }

            if (msg.type === 'sessionList') {
                renderSessionList(msg.sessions);
            }
            if (msg.type === 'loadSession') {
                chat.innerHTML = '';
                const history = msg.history;
                history.forEach((m, i) => addMessage(m.role, m.text, i));
                chat.scrollTop = chat.scrollHeight;
                reviewArea.style.display = 'none';
                statusArea.style.display = 'none';
            }
        });

        function renderSessionList(sessions) {
            sessionList.innerHTML = '';
            if (!sessions || sessions.length === 0) {
                sessionList.innerHTML = '<div style="padding:10px; opacity:0.6; font-size:11px;">No history found.</div>';
            } else {
                sessions.forEach(s => {
                    const div = document.createElement('div');
                    div.className = 'session-item';
                    div.innerHTML = '<div class="session-title">' + s.title + '</div><div class="session-date">' + new Date(s.timestamp).toLocaleString() + '</div>';
                    div.onclick = () => loadSession(s.id);
                    sessionList.appendChild(div);
                });
            }
            sessionList.style.display = 'block';
        }

        function showAutocomplete(results) {
            if (!results || results.length === 0) { acPopup.style.display = 'none'; return; }
            acPopup.innerHTML = '';
            results.forEach(f => {
                const div = document.createElement('div');
                div.className = 'ac-item';
                div.textContent = f.label;
                div.onclick = () => insertAutocomplete(f.label);
                acPopup.appendChild(div);
            });
            acPopup.style.display = 'block';
        }

        function insertAutocomplete(text) {
            const val = promptInput.value;
            const cursor = promptInput.selectionStart;
            const lastAt = val.lastIndexOf('@', cursor);
            const newVal = val.substring(0, lastAt) + text + ' ' + val.substring(cursor);
            promptInput.value = newVal;
            acPopup.style.display = 'none';
            promptInput.focus();
        }

        function updateStatus(text) {
            statusArea.style.display = 'block';
            statusArea.innerHTML = '<div class="status-indicator"><div class="status-row"><span>' + text + '</span></div></div>';
            chat.scrollTop = chat.scrollHeight;
        }

        function addMessage(role, text, index) {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper';

            let headerHtml = '';
            if (role === 'user') {
                const showReset = (index !== undefined && index !== null);
                headerHtml = \`<div class="header-row" style="justify-content: flex-end; gap: 10px;">
                            \${showReset ? \`<div class="action-icon" title="Reset to this version" onclick="resetTo(\${index})">${icons.reset}</div>\` : ''}
                            You <span class="avatar">${icons.user}</span></div>\`;
            } else {
                headerHtml = '<div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div>';
            }

            wrapper.innerHTML = headerHtml + '<div class="message ' + (role === 'user' ? 'user-msg' : 'assistant-msg') + '">' + formatMarkdown(text) + '</div>';
            chat.appendChild(wrapper);
            chat.scrollTop = chat.scrollHeight;
        }

        function updateBotMessage(text) {
            if (!currentBotMessageDiv) {
                const wrapper = document.createElement('div');
                wrapper.className = 'message-wrapper';
                wrapper.innerHTML = '<div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div><div class="message assistant-msg"></div>';
                chat.appendChild(wrapper);
                currentBotMessageDiv = wrapper;
            }
            const msgContent = currentBotMessageDiv.querySelector('.message');
            msgContent.innerHTML = formatMarkdown(text);
            chat.scrollTop = chat.scrollHeight;
        }

        function formatMarkdown(text) {
            if(!text) return '';
            return text
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/\`\`\`([\\w\\-\\+\\.]*)[^\\n]*\\n([\\s\\S]*?)\`\`\`/g, 
                    (match, lang, code) => \`<div class="code-block"><div class="code-header"><span class="code-lang">\${lang||'CODE'}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText)">Copy</button></div><div class="code-content">\${code}</div></div>\`)
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\n/g, '<br>');
        }
    </script>
</body>
</html>`;
    }

    private async handleUndoLast() {
        if (!this._gitManager) {
            vscode.window.showErrorMessage("Git Manager not initialized.");
            return;
        }

        this._view?.webview.postMessage({ type: 'agentStatus', value: 'Reverting last commit...', status: 'working' });

        const success = await this._gitManager.undoLastCommit();

        if (success) {
            this._view?.webview.postMessage({ type: 'agentStatus', value: 'Suggesting next step...', status: 'idle' });
            this._history.push({ role: 'assistant', text: "✅ **Undo Successful**\nI've reverted the last commit (reset to HEAD~1)." });
            await this.saveCurrentSession();
            this._view?.webview.postMessage({ type: 'addResponse', value: "✅ **Undo Successful**\nI've reverted the last commit.", isStream: false });
        } else {
            this._view?.webview.postMessage({ type: 'agentStatus', value: 'Undo Failed', status: 'error' });
            vscode.window.showErrorMessage("Failed to undo last commit. Check Git status.");
        }
    }
}
