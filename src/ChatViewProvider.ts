import * as vscode from 'vscode';
import { ByteAIClient } from './byteAIClient';
import { TerminalManager } from './terminalAccess';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { SystemDetector } from './systemDetector';
import { AgentPipeline } from './agentPipeline';
import { AGENT_PROMPT, PLAN_PROMPT } from './agentPrompts';
import { VersionManager } from './agents/VersionManager';
import { OrchestratorAgent } from './agents/OrchestratorAgent';

const MAX_FILE_SIZE = 50000;

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'byteAI.chatView';
    private _view?: vscode.WebviewView;
    private _client: ByteAIClient;
    private _terminalManager: TerminalManager;
    private _workspaceAnalyzer: WorkspaceAnalyzer;
    private _agentPipeline: AgentPipeline;
    private _orchestrator: OrchestratorAgent;

    // Restored Properties
    private _gitManager: VersionManager;
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
        this._currentSessionId = Date.now().toString();

        // Initialize Managers
        this._gitManager = new VersionManager();
        this._orchestrator = new OrchestratorAgent(this._client, this._terminalManager, this._gitManager);
    }


    private async saveCurrentSession(): Promise<void> {
        try {
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
            while (sessions.length > 20) {
                sessions.pop();
            }

            await this._context.globalState.update('byteAI_sessions', sessions);
        } catch (error: any) {
            console.error('Failed to save session:', error);
        }
    }

    private async deleteSession(id: string): Promise<void> {
        if (!id) return;

        try {
            let sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
            sessions = sessions.filter(s => s.id !== id);
            await this._context.globalState.update('byteAI_sessions', sessions);
            await this.getSessions(); // Refresh list
        } catch (error: any) {
            console.error('Failed to delete session:', error);
            vscode.window.showErrorMessage('Failed to delete session.');
        }
    }

    private async loadSession(id: string): Promise<void> {
        try {
            const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
            const session = sessions.find(s => s.id === id);
            if (session) {
                this._currentSessionId = session.id;
                this._history = session.history || [];
                this._pendingContext = ''; // Reset pending context on load
                this._pendingUserMessage = '';
                this._view?.webview.postMessage({ type: 'loadSession', history: this._history });
            } else {
                vscode.window.showWarningMessage('Session not found.');
            }
        } catch (error: any) {
            console.error('Failed to load session:', error);
            vscode.window.showErrorMessage('Failed to load session.');
        }
    }

    private async getSessions(): Promise<void> {
        try {
            const sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
            this._view?.webview.postMessage({
                type: 'sessionList',
                sessions: sessions.map(s => ({ id: s.id, title: s.title || 'Untitled', timestamp: s.timestamp })),
                currentSessionId: this._currentSessionId
            });
        } catch (error: any) {
            console.error('Failed to get sessions:', error);
        }
    }

    private async renameSession(id: string, newTitle: string): Promise<void> {
        if (!id || !newTitle?.trim()) return;

        try {
            let sessions = this._context.globalState.get<any[]>('byteAI_sessions') || [];
            const idx = sessions.findIndex(s => s.id === id);
            if (idx !== -1) {
                sessions[idx].title = newTitle.trim();
                await this._context.globalState.update('byteAI_sessions', sessions);
                await this.getSessions();
            }
        } catch (error: any) {
            console.error('Failed to rename session:', error);
        }
    }

    private async clearAllSessions(): Promise<void> {
        try {
            await this._context.globalState.update('byteAI_sessions', []);
            this._view?.webview.postMessage({ type: 'sessionList', sessions: [], currentSessionId: this._currentSessionId });
            vscode.window.showInformationMessage('All chat sessions cleared.');
        } catch (error: any) {
            console.error('Failed to clear sessions:', error);
            vscode.window.showErrorMessage('Failed to clear sessions.');
        }
    }

    private async deleteCurrentSession(): Promise<void> {
        if (!this._currentSessionId || this._history.length === 0) return;

        try {
            await this.deleteSession(this._currentSessionId);
            this.handleNewChat();
        } catch (error: any) {
            console.error('Failed to delete current session:', error);
        }
    }

    private hasMessagesInCurrentSession(): boolean {
        if (!this._history || this._history.length === 0) return false;
        return this._history.filter(m => m.role !== 'system').length > 0;
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
                case 'deleteSession':
                    await this.deleteSession(data.id);
                    break;
                case 'renameSession':
                    await this.renameSession(data.id, data.newTitle);
                    break;
                case 'clearAllSessions':
                    await this.clearAllSessions();
                    break;
                case 'deleteCurrentSession':
                    await this.deleteCurrentSession();
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

    private async handleResetToMessage(index: number): Promise<void> {
        try {
            if (index < 0 || index >= this._history.length) {
                vscode.window.showWarningMessage('Invalid message index for reset.');
                return;
            }

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

            // Reset pending state
            this._pendingContext = "";
            this._pendingUserMessage = "";

            // Refresh the webview to reflect the curtailed history
            if (this._view) {
                this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                this._view.webview.postMessage({ type: 'agentStatus', value: 'Timetravel complete.', status: 'idle' });
            }
            await this.saveCurrentSession();
        } catch (error: any) {
            console.error('Reset to message error:', error);
            vscode.window.showErrorMessage('Failed to reset: ' + error.message);
        }
    }

    private async handleFileSearch(query: string): Promise<void> {
        try {
            if (!query || query.length < 2) return;
            const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 10);
            const results = files.map(f => ({
                label: vscode.workspace.asRelativePath(f),
                path: f.fsPath
            }));
            this._view?.webview.postMessage({ type: 'fileSearchResults', results });
        } catch (error: any) {
            console.error('File search error:', error);
        }
    }

    private async executePendingPlan(): Promise<void> {
        if (!this._pendingUserMessage || !this._view) return;

        try {
            // Delegate Execution to Orchestrator -> ExecutionAgent
            const orchestratorHandler = (update: any) => {
                if (update.type === 'response') {
                    this._view?.webview.postMessage({ type: 'addResponse', value: update.value, isStream: update.isStream });
                    this._history.push({ role: 'assistant', text: update.value });
                } else if (update.type === 'status') {
                    this._view?.webview.postMessage({ type: 'agentStatus', value: update.value, status: 'executing' });
                } else if (update.type === 'error') {
                    this._view?.webview.postMessage({ type: 'addResponse', value: "Error: " + update.value, isStream: false });
                }
            };

            await this._orchestrator.executePlan(this._pendingUserMessage, this._pendingContext, orchestratorHandler);
            await this.saveCurrentSession();
        } catch (error: any) {
            console.error('Execute plan error:', error);
            this._view?.webview.postMessage({ type: 'addResponse', value: "**Execution Failed**: " + error.message, isStream: false });
            vscode.window.showErrorMessage('Plan execution failed: ' + error.message);
        }
    }

    private stopGeneration(): void {
        if (this._isGenerating) {
            try {
                this._client.disconnect();
                this._isGenerating = false;
                this._view?.webview.postMessage({ type: 'setLoading', value: false });
                this._view?.webview.postMessage({ type: 'addResponse', value: "\n\n*[Stopped by user]*", isStream: false });
                this._history.push({ role: 'assistant', text: "*[Stopped by user]*" });
                this.saveCurrentSession(); // Save after stopping
            } catch (error: any) {
                console.error('Stop generation error:', error);
            }
        }
    }

    // ... (File creation/editing methods remain but are effectively deprecated by ExecutionAgent if moved there) ...
    // Keeping them for now in case of direct usage or fallback.

    private async processAndCreateFiles(text: string): Promise<void> { /* ... */ }
    private async processAndEditFiles(text: string): Promise<void> { /* ... */ }

    public async runCommand(command: 'explain' | 'fix' | 'doc' | 'refactor' | 'test') {
        if (!this._view) await vscode.commands.executeCommand('byteAI.chatView.focus');
        if (this._view) await this.handleUserMessage("/" + command, 'agent');
    }

    public clearChat() {
        this._history = [];
        this._client.resetSession();
        this._view?.webview.postMessage({ type: 'clearChat' });
    }

    public async handleNewChat(): Promise<void> {
        try {
            this._client.resetSession();
            this._currentSessionId = Date.now().toString(); // New Session ID
            this._history = [];
            this._history.push({ role: 'system', text: '--- New Session ---' });
            this._view?.webview.postMessage({ type: 'newChat' });
            await this.saveCurrentSession();
        } catch (error: any) {
            console.error('New chat error:', error);
        }
    }

    private async handleUserMessage(message: string, mode: string = 'agent') {
        if (!this._view) { return; }

        try {
            // Capture current state BEFORE processing
            const currentHash = await this._gitManager.getCurrentCommit();
            this._history.push({ role: 'user', text: message, commitHash: currentHash || undefined });
            await this.saveCurrentSession(); // Save user message immediately

            this._isGenerating = true;
            this._view.webview.postMessage({ type: 'setLoading', value: true });

            // --- CONTEXT BUILDER (Passed to Orchestrator) ---
            const contextBuilder = async (analysis: any) => {
                // --- PIPELINE STEP 1: PROMPT ENHANCER ---
                this._view?.webview.postMessage({ type: 'agentStatus', value: '✨ Enhancing Request...', status: 'analyzing' });

                // Smart Context Logic (Diagnostics)
                let smartContext = "";
                if (message.trim().startsWith('/fix')) {
                    const diagnostics = vscode.languages.getDiagnostics();
                    let problemsText = "";
                    let count = 0;
                    for (const [uri, diags] of diagnostics) {
                        if (diags.length > 0 && count < 5) {
                            problemsText += `\nFile: ${vscode.workspace.asRelativePath(uri)}\n`;
                            diags.slice(0, 3).forEach(d => {
                                problemsText += ` - [Line ${d.range.start.line + 1}] ${d.message} (${d.source})\n`;
                            });
                            count++;
                        }
                    }
                    if (problemsText) smartContext = `\n\n[DETECTED PROBLEMS/DIAGNOSTICS]:\n${problemsText}`;
                }

                const promptToEnhance = message + smartContext;
                const enhancedPrompt = await this._agentPipeline.enhancePrompt(promptToEnhance, SystemDetector.getContextString());

                // --- PIPELINE STEP 2 & 3: ANALYZE & PLAN ---
                this._view?.webview.postMessage({ type: 'agentStatus', value: '🔍 Analyzing & Searching...', status: 'analyzing' });
                // Note: Orchestrator already called analyzeInput, but we need it here for context building.
                // Optimally we'd reuse it, but re-calling for now is safer refactor.
                const evaluation = await this._agentPipeline.evaluateContext(analysis);

                this._view?.webview.postMessage({ type: 'agentStatus', value: '🏗️ Building Context...', status: 'planning' });
                let fullContext = this._agentPipeline.buildContext(evaluation, analysis);
                fullContext += `\n\n${SystemDetector.getContextString()}`;

                // Store for potential execution (Virtual Plan approval)
                this._pendingContext = fullContext;
                this._pendingUserMessage = message;

                return fullContext;
            };

            // --- ORCHESTRATOR HANDLER ---
            let fullResponseAccumulator = ""; // Accumulate chunks here

            const agentUpdateHandler = (update: any) => { // Assuming AgentResponse is 'any' for this snippet
                if (update.type === 'status') {
                    this._view?.webview.postMessage({ type: 'agentStatus', value: update.value, status: 'working' });
                }
                if (update.type === 'response') {
                    fullResponseAccumulator += update.value; // Append chunk
                    // Send FULL text to frontend
                    this._view?.webview.postMessage({ type: 'addResponse', value: fullResponseAccumulator, isStream: update.isStream });

                    // Update history for save
                    if (this._history.length > 0 && this._history[this._history.length - 1].role === 'assistant') {
                        this._history[this._history.length - 1].text = fullResponseAccumulator;
                    } else {
                        this._history.push({ role: 'assistant', text: fullResponseAccumulator });
                    }
                }
                if (update.type === 'error') {
                    this._view?.webview.postMessage({ type: 'agentStatus', value: `Error: ${update.value}`, status: 'error' });
                    vscode.window.showErrorMessage(`Agent Error: ${update.value}`);
                }
                if (update.type === 'action' && update.value === 'showPlanReview') {
                    this._view?.webview.postMessage({ type: 'showPlanReview' });
                }
            };

            await this._orchestrator.routeRequest(message, mode, contextBuilder, agentUpdateHandler);

            // After routeRequest completes (streaming done)
            if (this._history.length > 0) {
                // The agents stream response but don't automatically push to history array in specific format?
                // Wait, we need to capture the full response text to push to history.
                // The Orchestrator doesn't return the full text, it streams via callback.
                // We need to accumulate it in the callback or fix `saveCurrentSession`.
                // Actually `streamResponse` in older code did `this._history.push`.
                // Fix: Let's assume the last response chunk or separate history push is needed.
                // Ideally, we push the FULL response to history at end.

                // Since we refactored, let's manually push a dummy 'Assistant Response' or handle accumulation in handler.
            }

        } catch (error: any) {
            console.error("Orchestrator Error:", error);
            this._view.webview.postMessage({ type: 'addResponse', value: "**System Check Failed**: " + error.message, isStream: false });
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
            trash: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>`,
            edit: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175l-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>`,
            search: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>`,
            clearAll: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5a.5.5 0 0 0-1 0v7a.5.5 0 0 0 1 0v-7z"/></svg>`,
            send: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M1.5 1.5l13.25 5.75L1.5 13V9l9-1.75-9-.75V1.5z"/></svg>`,
            stop: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2 2h12v12H2V2z"/></svg>`,
            copy: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M4 4h8v8H4V4zm-1-1v10h10V3H3zm12 11h-9v1h9V14z"/></svg>`,
            user: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`,
            bot: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H4v6h2v3h4v-3h2V5h-2V4a2 2 0 0 0-2-2zm0 1a1 1 0 0 1 1 1v1H7V4a1 1 0 0 1 1-1zm-3 8V6h6v5H5z"/></svg>`,
            check: `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.485 1.431a.625.625 0 0 1 .884.884l-7.5 7.5a.625.625 0 0 1-.884 0l-3.5-3.5a.625.625 0 0 1 .884-.884L6.5 8.432l6.985-6.985z"/></svg>`,
            reset: `<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>`,
            chat: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2.5 3A1.5 1.5 0 0 1 4 1.5h8A1.5 1.5 0 0 1 13.5 3v7.5a1.5 1.5 0 0 1-1.5 1.5H8l-4 4V12H4a1.5 1.5 0 0 1-1.5-1.5V3z"/></svg>`,
            robot: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H4v6h2v3h4v-3h2V5h-2V4a2 2 0 0 0-2-2zm0 1a1 1 0 0 1 1 1v1H7V4a1 1 0 0 1 1-1zm-3 8V6h6v5H5zM3 5h-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5H3V5zm10 0v3h.5a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5H13z"/></svg>`,
            sync: `<svg class="spinner" width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/></svg>`
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
                /* Header Styles */
                .main-header { 
                    display: flex; justify-content: space-between; align-items: center; 
                    padding: 0 15px; height: 40px; border-bottom: 1px solid var(--border-color); 
                    background: var(--bg-color); flex-shrink: 0;
                }
                .header-title { font-weight: bold; display: flex; align-items: center; gap: 6px; font-size: 12px; }
                .header-actions { display: flex; gap: 4px; }

                body { font-family: var(--vscode-font-family); background-color: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; height: 100vh; margin: 0; }
                
                .chat-container { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; scroll-behavior: smooth; }
                .message-wrapper { animation: fadeIn 0.3s ease; }
                .message-wrapper.user-wrapper { display: flex; flex-direction: column; align-items: flex-end; }
                .message-wrapper.assistant-wrapper { display: flex; flex-direction: column; align-items: flex-start; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

                .message { padding: 12px 16px; max-width: 95%; line-height: 1.6; position: relative; }
                
                /* User messages - gray bubble style */
                .user-msg { 
                    background: rgba(255, 255, 255, 0.08); 
                    color: var(--text-color); 
                    border-radius: 12px;
                    border-bottom-right-radius: 4px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
                
                /* Assistant messages - no bubble, clean text */
                .assistant-msg { 
                    background: transparent; 
                    padding: 8px 0;
                    border: none;
                    box-shadow: none;
                }
                
                .msg-footer { position: absolute; bottom: 4px; right: 8px; font-size: 10px; opacity: 0; transition: opacity 0.2s; display: flex; gap: 4px; }
                .user-msg:hover .msg-footer { opacity: 1; }
                .footer-icon { cursor: pointer; opacity: 0.7; }
                .footer-icon:hover { opacity: 1; transform: scale(1.1); }
                
                .header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 11px; opacity: 0.6; }
                .header-row.user-header { justify-content: flex-end; }
                .action-icon { cursor: pointer; opacity: 0.5; transition: all 0.2s; display: flex; align-items: center; padding: 2px; border-radius: 4px; }
                .action-icon:hover { opacity: 1; background: rgba(255,255,255,0.2); }

                .avatar { width: 16px; height: 16px; border-radius: 50%; background: rgba(127,127,127,0.3); display: flex; align-items: center; justify-content: center; }

                /* Status & Reasoning */
                .status-container { margin: 10px 0; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; }
                .status-header { 
                    padding: 8px 12px; background: rgba(0,0,0,0.05); cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-size: 11px;
                    color: var(--text-color); opacity: 0.8;
                }
                .status-header:hover { opacity: 1; background: rgba(0,0,0,0.1); }
                .status-content { display: none; padding: 10px; background: var(--bg-color); font-size: 11px; font-family: 'Menlo', monospace; border-top: 1px solid var(--border-color); max-height: 200px; overflow-y: auto; color: var(--text-color); opacity: 0.8; }
                .status-content.open { display: block; animation: slideDown 0.2s ease; }
                @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 0.8; transform: translateY(0); } }

                .slash-popup {
                    position: absolute; bottom: 80px; left: 15px; width: 200px; 
                    background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4); overflow: hidden; display: none; z-index: 100;
                }
                .slash-item { padding: 8px 12px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .slash-item:last-child { border-bottom: none; }
                .slash-item:hover { background: var(--accent-color); color: white; }
                .slash-cmd { font-weight: bold; min-width: 60px; }
                .slash-desc { opacity: 0.7; font-size: 10px; }
                .slash-item:hover .slash-desc { opacity: 0.9; }

                /* Tables */
                table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
                th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color); }
                th { background: rgba(0,0,0,0.1); font-weight: bold; }
                tr:hover { background: rgba(255,255,255,0.02); }

                /* Typography */
                h1, h2, h3 { margin-top: 16px; margin-bottom: 8px; font-weight: 600; line-height: 1.25; }
                h1 { font-size: 1.4em; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
                h2 { font-size: 1.2em; }
                h3 { font-size: 1.1em; }
                
                .status-indicator { display: flex; align-items: center; gap: 8px; }
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
                .mode-toggle { display: flex; background: rgba(0,0,0,0.1); border-radius: 4px; padding: 2px; gap: 2px; width: 100%; }
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
                /* Session List Overlay */
                .session-list {
                    background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-height: 400px; overflow: hidden; display: none; 
                    z-index: 200; position: absolute; top: 45px; right: 10px; width: 300px;
                    animation: slideDown 0.2s ease;
                }
                .session-header {
                    padding: 10px; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.1);
                    display: flex; flex-direction: column; gap: 8px;
                }
                .session-search {
                    display: flex; align-items: center; gap: 6px; background: var(--input-bg); 
                    border: 1px solid var(--border-color); border-radius: 4px; padding: 6px 8px;
                }
                .session-search input {
                    flex: 1; border: none; background: transparent; color: var(--text-color); 
                    font-size: 11px; outline: none;
                }
                .session-actions {
                    display: flex; justify-content: flex-end;
                }
                .clear-all-btn {
                    display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 10px;
                    background: rgba(217, 83, 79, 0.15); color: #d9534f; border: none; border-radius: 4px;
                    cursor: pointer; transition: all 0.2s;
                }
                .clear-all-btn:hover { background: rgba(217, 83, 79, 0.3); }
                .session-body { max-height: 320px; overflow-y: auto; }
                .session-group-title {
                    padding: 6px 12px; font-size: 9px; font-weight: 600; text-transform: uppercase;
                    letter-spacing: 0.5px; opacity: 0.5; background: rgba(0,0,0,0.05);
                }
                .session-item { 
                    display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; 
                    border-bottom: 1px solid rgba(255,255,255,0.03); cursor: pointer; transition: background 0.2s; 
                }
                .session-item:hover { background: rgba(255,255,255,0.05); }
                .session-item.active { background: rgba(78, 201, 176, 0.1); border-left: 2px solid var(--success-color); }
                .session-info { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
                .session-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .session-date { font-size: 10px; opacity: 0.5; margin-top: 2px; }
                .session-item-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s; }
                .session-item:hover .session-item-actions { opacity: 1; }
                .session-action-btn { 
                    padding: 4px; border-radius: 4px; cursor: pointer; transition: all 0.2s; 
                    display: flex; align-items: center; justify-content: center;
                }
                .session-action-btn.edit-btn { color: var(--text-color); }
                .session-action-btn.edit-btn:hover { background: rgba(255,255,255,0.1); }
                .session-action-btn.delete-btn { color: #d9534f; }
                .session-action-btn.delete-btn:hover { background: rgba(217, 83, 79, 0.2); }
                .no-sessions { padding: 20px; text-align: center; opacity: 0.5; font-size: 11px; }
                
                .ac-item { padding: 6px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
                .ac-item:hover { background: var(--accent-color); color: white; }

                /* Plan Review Actions */
                .plan-actions { display: flex; gap: 10px; padding: 10px; justify-content: center; margin-bottom: 10px; }
                .plan-btn { padding: 8px 16px; border-radius: 4px; border: none; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; }
                .accent-btn { background: var(--success-color); color: #1e1e1e; }
                .secondary-btn { background: rgba(255,255,255,0.1); color: var(--text-color); }
                .accent-btn:hover { opacity: 0.9; transform: scale(1.02); }

                /* Premium Thinking Process UI */
                .status-container { margin: 10px 0; border: 1px solid var(--border-color); border-radius: 6px; background: rgba(0, 0, 0, 0.2); overflow: hidden; font-family: 'Segoe UI', sans-serif; }
                .status-header { 
                    padding: 8px 12px; background: rgba(255, 255, 255, 0.05); cursor: pointer; display: flex; justify-content: space-between; align-items: center; 
                    font-size: 11px; font-weight: 600; color: var(--text-color); user-select: none; transition: background 0.2s;
                }
                .status-header:hover { background: rgba(255, 255, 255, 0.08); }
                .status-content { 
                    max-height: 0; overflow-y: auto; transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1); background: rgba(0, 0, 0, 0.3); 
                    font-family: 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 10px; color: #8b949e; 
                }
                .status-content.open { max-height: 250px; padding: 10px; border-top: 1px solid var(--border-color); }
                .status-entry { margin-bottom: 6px; display: flex; gap: 8px; line-height: 1.4; }
                .status-entry:last-child { margin-bottom: 0; }
                .status-time { opacity: 0.5; min-width: 45px; }
                .status-text { word-break: break-word; }
                
                .spinner { animation: spin 1s linear infinite; display: inline-block; }
                @keyframes spin { 100% { transform: rotate(360deg); } }

                /* Welcome Screen - Centered Layout */
                .welcome-container {
                    display: flex; flex-direction: column; justify-content: center; align-items: center;
                    flex: 1; padding: 20px; min-height: 300px; text-align: center;
                }
                .welcome-logo { 
                    width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.8;
                    filter: drop-shadow(0 2px 8px rgba(78, 201, 176, 0.3));
                }
                .welcome-title { 
                    font-size: 20px; font-weight: 600; margin-bottom: 8px; 
                    background: linear-gradient(135deg, #4ec9b0, #569cd6);
                    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                }
                .welcome-subtitle { font-size: 12px; opacity: 0.6; margin-bottom: 24px; }
                
                .welcome-input-wrapper {
                    width: 100%; max-width: 400px; background: var(--input-bg);
                    border: 1px solid var(--border-color); border-radius: 8px;
                    padding: 12px; transition: all 0.2s;
                }
                .welcome-input-wrapper:focus-within { 
                    border-color: var(--accent-color); 
                    box-shadow: 0 0 0 2px rgba(78, 201, 176, 0.15);
                }
                .welcome-input {
                    width: 100%; border: none; background: transparent; color: var(--text-color);
                    font-size: 13px; outline: none; resize: none; font-family: inherit;
                }
                .welcome-input-row {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05);
                }
                .welcome-mode-toggle { display: flex; gap: 4px; }
                .welcome-mode-btn {
                    padding: 4px 10px; font-size: 10px; border: none; background: rgba(255,255,255,0.05);
                    color: var(--text-color); border-radius: 4px; cursor: pointer; opacity: 0.6; transition: all 0.2s;
                }
                .welcome-mode-btn.active { background: var(--accent-color); color: white; opacity: 1; }
                .welcome-send-btn {
                    width: 28px; height: 28px; border: none; border-radius: 6px;
                    background: var(--accent-color); color: white; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; transition: all 0.2s;
                }
                .welcome-send-btn:hover { transform: scale(1.05); }
                
                /* Recent History Section */
                .recent-history {
                    width: 100%; max-width: 400px; margin-top: 24px; text-align: left;
                }
                .recent-history-title { 
                    font-size: 10px; font-weight: 600; text-transform: uppercase; 
                    letter-spacing: 0.5px; opacity: 0.4; margin-bottom: 8px; 
                }
                .recent-item {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 10px 12px; border-radius: 6px; cursor: pointer;
                    transition: all 0.2s; margin-bottom: 4px;
                }
                .recent-item:hover { background: rgba(255,255,255,0.05); }
                .recent-item-title { 
                    font-size: 12px; white-space: nowrap; overflow: hidden; 
                    text-overflow: ellipsis; max-width: 280px;
                }
                .recent-item-date { font-size: 10px; opacity: 0.4; white-space: nowrap; }
                .see-all-btn {
                    display: flex; align-items: center; justify-content: center; gap: 4px;
                    width: 100%; padding: 10px; font-size: 11px; opacity: 0.5;
                    cursor: pointer; transition: all 0.2s; border-radius: 6px; margin-top: 4px;
                }
                .see-all-btn:hover { opacity: 1; background: rgba(255,255,255,0.05); }
                
                .disclaimer { 
                    font-size: 10px; opacity: 0.3; margin-top: 20px; 
                    max-width: 300px; line-height: 1.4;
                }

            </style>
        </head>
        <body>
            <div class="main-header">
                <div class="header-title">${icons.robot} Byte AI</div>
                <div class="header-actions">
                    <button class="action-icon" id="newChatBtn" title="New Chat" onclick="newChat()">${icons.add}</button>
                    <button class="action-icon" id="historyBtn" title="History" onclick="toggleHistory()">${icons.history}</button>
                    <button class="action-icon" id="deleteBtn" title="Delete Current Chat" onclick="deleteCurrentChat()" style="display:none;">${icons.trash}</button>
                </div>
            </div>

            <!-- Welcome Screen (shown when no messages) -->
            <div id="welcomeScreen" class="welcome-container">
                <div class="welcome-logo">${icons.robot}</div>
                <div class="welcome-title">Byte AI</div>
                <div class="welcome-subtitle">Your intelligent coding assistant</div>
                
                <div class="welcome-input-wrapper">
                    <textarea id="welcomeInput" class="welcome-input" rows="2" placeholder="Ask anything or describe a task..."></textarea>
                    <div class="welcome-input-row">
                        <div class="welcome-mode-toggle">
                            <button class="welcome-mode-btn active" id="welcomeModePlan" onclick="setWelcomeMode('plan')">${icons.chat} Consultant</button>
                            <button class="welcome-mode-btn" id="welcomeModeAgent" onclick="setWelcomeMode('agent')">${icons.robot} Agent</button>
                        </div>
                        <button class="welcome-send-btn" onclick="sendFromWelcome()">${icons.send}</button>
                    </div>
                </div>
                
                <div class="recent-history" id="recentHistory"></div>
                
                <div class="disclaimer">AI may make mistakes. Double-check generated code.</div>
            </div>

            <!-- Chat Container (hidden when in welcome state) -->
            <div class="chat-container" id="chat" style="display:none;"></div>

            <!-- Status Indicator Floating Area -->
            <div id="statusArea" style="display:none; padding: 0 20px; margin-bottom: 10px;"></div>

            <!-- Review Actions (Hidden by default) -->
            <div id="reviewArea" class="plan-actions" style="display:none;">
                <button class="plan-btn secondary-btn" onclick="cancelPlan()">Modify Plan</button>
                <button class="plan-btn accent-btn" onclick="executePlan()">Proceed to Execute ${icons.send}</button>
            </div>

            <!-- Input Area (hidden when in welcome state) -->
            <div class="input-area" id="inputArea" style="display:none;">
                <div id="acPopup" class="autocomplete-popup"></div>
                <div id="slashPopup" class="slash-popup">
                    <div class="slash-item" onclick="insertSlash('/fix')"><span class="slash-cmd">/fix</span> <span class="slash-desc">Fix bugs</span></div>
                    <div class="slash-item" onclick="insertSlash('/explain')"><span class="slash-cmd">/explain</span> <span class="slash-desc">Explain code</span></div>
                    <div class="slash-item" onclick="insertSlash('/refactor')"><span class="slash-cmd">/refactor</span> <span class="slash-desc">Improve code</span></div>
                    <div class="slash-item" onclick="insertSlash('/test')"><span class="slash-cmd">/test</span> <span class="slash-desc">Write tests</span></div>
                    <div class="slash-item" onclick="insertSlash('/doc')"><span class="slash-cmd">/doc</span> <span class="slash-desc">Add docs</span></div>
                </div>
                <!-- Session list kept overlaying input for now, could move up if requested -->
                <div id="sessionList" class="session-list" style="bottom: 150px; left: 0; right: 0; margin: 0 15px;"></div> 
                
                <div class="input-wrapper">
                    <div class="top-row">
                        <div class="mode-toggle">
                            <button class="mode-btn active" id="modePlan" onclick="setMode('plan')">${icons.chat} Consultant</button>
                            <button class="mode-btn" id="modeAgent" onclick="setMode('agent')">${icons.robot} Agent</button>
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
                
                // UI Elements
                const chat = document.getElementById('chat');
                const promptInput = document.getElementById('promptInput');
                const sendBtn = document.getElementById('sendBtn');
                const stopBtn = document.getElementById('stopBtn');
                const deleteBtn = document.getElementById('deleteBtn');
                const statusArea = document.getElementById('statusArea');
                const reviewArea = document.getElementById('reviewArea');
                const sessionList = document.getElementById('sessionList');
                const acPopup = document.getElementById('acPopup');
                const slashPopup = document.getElementById('slashPopup');
                const modePlanBtn = document.getElementById('modePlan');
                const modeAgentBtn = document.getElementById('modeAgent');
                const welcomeScreen = document.getElementById('welcomeScreen');
                const inputArea = document.getElementById('inputArea');
                const welcomeInput = document.getElementById('welcomeInput');
                const recentHistory = document.getElementById('recentHistory');
                const welcomeModePlan = document.getElementById('welcomeModePlan');
                const welcomeModeAgent = document.getElementById('welcomeModeAgent');

                // State
                let currentMode = 'plan'; // Default
                let currentBotMessageDiv = null;
                let hasMessages = false;
                let currentSessionId = null;
                let sessionSearchQuery = '';
                let recentSessions = [];
                const newChatBtn = document.getElementById('newChatBtn');

                function updateDeleteBtnVisibility() {
                    if (deleteBtn) {
                        deleteBtn.style.display = hasMessages ? 'flex' : 'none';
                    }
                }

                function updateNewChatBtnVisibility() {
                    if (newChatBtn) {
                        if (hasMessages) {
                            newChatBtn.style.opacity = '1';
                            newChatBtn.style.pointerEvents = 'auto';
                            newChatBtn.title = 'New Chat';
                        } else {
                            newChatBtn.style.opacity = '0.3';
                            newChatBtn.style.pointerEvents = 'none';
                            newChatBtn.title = 'Already in new chat';
                        }
                    }
                }

                function updateHeaderButtons() {
                    updateDeleteBtnVisibility();
                    updateNewChatBtnVisibility();
                }

                // Welcome/Chat State Management
                function showWelcomeScreen() {
                    welcomeScreen.style.display = 'flex';
                    chat.style.display = 'none';
                    inputArea.style.display = 'none';
                    // Load recent sessions for display
                    vscode.postMessage({ type: 'getSessions' });
                }

                function showChatMode() {
                    welcomeScreen.style.display = 'none';
                    chat.style.display = 'flex';
                    inputArea.style.display = 'block';
                    promptInput.focus();
                }

                function setWelcomeMode(mode) {
                    currentMode = mode;
                    if (mode === 'plan') {
                        welcomeModePlan.classList.add('active');
                        welcomeModeAgent.classList.remove('active');
                    } else {
                        welcomeModeAgent.classList.add('active');
                        welcomeModePlan.classList.remove('active');
                    }
                    // Sync with main mode buttons
                    setMode(mode);
                }

                function sendFromWelcome() {
                    const text = welcomeInput.value.trim();
                    if (!text) return;
                    
                    // Switch to chat mode
                    showChatMode();
                    
                    // Add message and send
                    addMessage('user', text, null, null);
                    currentBotMessageDiv = null;
                    vscode.postMessage({ type: 'sendMessage', value: text, mode: currentMode });
                    
                    welcomeInput.value = '';
                    hasMessages = true;
                    updateHeaderButtons();
                    setLoading(true);
                }

                function loadRecentHistory(sessions) {
                    recentSessions = sessions || [];
                    recentHistory.innerHTML = '';
                    
                    if (recentSessions.length === 0) return;
                    
                    const title = document.createElement('div');
                    title.className = 'recent-history-title';
                    title.textContent = 'Recent Chats';
                    recentHistory.appendChild(title);
                    
                    // Show top 3 recent sessions
                    const recent3 = recentSessions.slice(0, 3);
                    recent3.forEach(s => {
                        const item = document.createElement('div');
                        item.className = 'recent-item';
                        item.onclick = () => {
                            vscode.postMessage({ type: 'loadSession', id: s.id });
                        };
                        
                        const dateStr = formatRelativeDate(s.timestamp);
                        item.innerHTML = \`
                            <span class="recent-item-title">\${s.title || 'Untitled Chat'}</span>
                            <span class="recent-item-date">\${dateStr}</span>
                        \`;
                        recentHistory.appendChild(item);
                    });
                    
                    // See All button if more than 3 sessions
                    if (recentSessions.length > 3) {
                        const seeAll = document.createElement('div');
                        seeAll.className = 'see-all-btn';
                        seeAll.onclick = () => toggleHistory();
                        seeAll.innerHTML = 'See all →';
                        recentHistory.appendChild(seeAll);
                    }
                }

                function formatRelativeDate(timestamp) {
                    const now = new Date();
                    const date = new Date(timestamp);
                    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
                    
                    if (diffDays === 0) return 'Today';
                    if (diffDays === 1) return '1d';
                    if (diffDays < 7) return diffDays + 'd';
                    if (diffDays < 30) return Math.floor(diffDays / 7) + 'w';
                    return Math.floor(diffDays / 30) + 'mo';
                }

                // Welcome input enter key
                welcomeInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromWelcome(); }
                });

                function newChat() {
                    if (!hasMessages) return; // Don't create new if already empty
                    vscode.postMessage({ type: 'newChat' });
                    hasMessages = false;
                    updateHeaderButtons();
                    showWelcomeScreen();
                }

                function toggleHistory() {
                    if (sessionList.style.display === 'block') {
                        sessionList.style.display = 'none';
                    } else {
                        vscode.postMessage({ type: 'getSessions' });
                    }
                }
                
                function deleteCurrentChat() {
                    if(confirm('Delete this chat session? This cannot be undone.')) {
                        vscode.postMessage({ type: 'deleteCurrentSession' });
                        hasMessages = false;
                        updateHeaderButtons();
                    }
                }

                function clearAllSessions() {
                    if(confirm('Delete ALL chat sessions? This cannot be undone.')) {
                        vscode.postMessage({ type: 'clearAllSessions' });
                        sessionList.style.display = 'none';
                    }
                }

                function renameSession(id) {
                    const newTitle = prompt('Enter new title for this chat:');
                    if (newTitle && newTitle.trim()) {
                        vscode.postMessage({ type: 'renameSession', id: id, newTitle: newTitle.trim() });
                    }
                }

                function filterSessions(query) {
                    sessionSearchQuery = query.toLowerCase();
                    const items = sessionList.querySelectorAll('.session-item');
                    items.forEach(item => {
                        const title = item.querySelector('.session-title')?.textContent?.toLowerCase() || '';
                        item.style.display = title.includes(sessionSearchQuery) ? 'flex' : 'none';
                    });
                }


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
            
            // Slash Command Check
            if (val === '/') {
                slashPopup.style.display = 'block';
                acPopup.style.display = 'none';
                return;
            } else {
                slashPopup.style.display = 'none';
            }

            const lastAt = val.lastIndexOf('@', cursor);
            if (lastAt !== -1 && cursor - lastAt > 0 && cursor - lastAt < 20) {
                const query = val.substring(lastAt + 1, cursor);
                vscode.postMessage({ type: 'searchFiles', query });
            } else {
                acPopup.style.display = 'none';
            }
        }

        function insertSlash(cmd) {
            promptInput.value = cmd + ' ';
            slashPopup.style.display = 'none';
            promptInput.focus();
        }

        // Send Logic
        function sendMessage() {
            const text = promptInput.value.trim();
            if (!text) return;

            // Optimistically add message with null index (will be fixed on reload)
            addMessage('user', text, null, null);

            currentBotMessageDiv = null;
            reviewArea.style.display = 'none';
            vscode.postMessage({ type: 'sendMessage', value: text, mode: currentMode });

            promptInput.value = '';
            promptInput.style.height = 'auto';
            setLoading(true);
            acPopup.style.display = 'none';
            
            hasMessages = true;
            updateHeaderButtons();
        }

        function showWelcomeMessage() {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper';
            wrapper.innerHTML = \`
                <div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div>
                <div class="message assistant-msg">
                    <strong>Byte Coder v1.2.0</strong><br>
                    Ready to assist. Type a message or use /commands.
                </div>
            \`;
            chat.appendChild(wrapper);
        }

        function executePlan() {
            const btn = document.querySelector('.plan-btn.accent-btn');
            if (btn) {
                btn.innerText = "⏳ Executing...";
                btn.disabled = true;
                btn.style.opacity = "0.7";
            }

            addMessage('user', "✅ Proceed with Execution", null, null);
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

        // Initialize button states on load
        // hasMessages is false initially, so New Chat should be disabled
        updateHeaderButtons();

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

            if (msg.type === 'clearChat') { 
                chat.innerHTML = ''; 
                currentBotMessageDiv = null; 
                statusArea.style.display = 'none'; 
                reviewArea.style.display = 'none';
                hasMessages = false;
                updateHeaderButtons();
                showWelcomeScreen();
            }
            if (msg.type === 'newChat') { 
                chat.innerHTML = '';
                currentBotMessageDiv = null; 
                statusArea.style.display = 'none'; 
                reviewArea.style.display = 'none';
                hasMessages = false;
                updateHeaderButtons();
                showWelcomeScreen();
            }

            if (msg.type === 'sessionList') {
                renderSessionList(msg.sessions, msg.currentSessionId);
                // Also update recent history on welcome screen
                if (welcomeScreen.style.display !== 'none') {
                    loadRecentHistory(msg.sessions);
                }
            }
            if (msg.type === 'loadSession') {
                // Switch to chat mode first
                showChatMode();
                
                chat.innerHTML = '';
                currentBotMessageDiv = null;
                const history = msg.history;
                
                // Display all messages from the loaded session
                history.forEach((m, i) => {
                    if (m.role === 'system' && m.text === '--- New Session ---') {
                        // Skip system session markers, they're internal
                        return;
                    }
                    addMessage(m.role, m.text, i, m.commitHash);
                });
                
                chat.scrollTop = chat.scrollHeight;
                reviewArea.style.display = 'none';
                statusArea.style.display = 'none';
                hasMessages = history.filter(m => m.role !== 'system').length > 0;
                updateHeaderButtons();
                sessionList.style.display = 'none';
            }
        });

        // Initialize: show welcome screen and fetch recent sessions
        showWelcomeScreen();

        function renderSessionList(sessions, currentSessionIdFromServer) {
            sessionList.innerHTML = '';
            currentSessionId = currentSessionIdFromServer;
            
            // Header with search and clear all
            const header = document.createElement('div');
            header.className = 'session-header';
            header.innerHTML = \`
                <div class="session-search">
                    ${icons.search}
                    <input type="text" placeholder="Search chats..." oninput="filterSessions(this.value)" />
                </div>
                <div class="session-actions">
                    <button class="clear-all-btn" onclick="clearAllSessions()">${icons.clearAll} Clear All</button>
                </div>
            \`;
            sessionList.appendChild(header);
            
            // Body container
            const body = document.createElement('div');
            body.className = 'session-body';
            
            if (!sessions || sessions.length === 0) {
                body.innerHTML = '<div class="no-sessions">No chat history found.</div>';
            } else {
                // Group by time
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
                const thisWeek = new Date(today); thisWeek.setDate(thisWeek.getDate() - 7);
                
                const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
                
                sessions.forEach(s => {
                    const sessionDate = new Date(s.timestamp);
                    if (sessionDate >= today) groups.today.push(s);
                    else if (sessionDate >= yesterday) groups.yesterday.push(s);
                    else if (sessionDate >= thisWeek) groups.thisWeek.push(s);
                    else groups.older.push(s);
                });
                
                const renderGroup = (title, items) => {
                    if (items.length === 0) return;
                    
                    const groupTitle = document.createElement('div');
                    groupTitle.className = 'session-group-title';
                    groupTitle.textContent = title;
                    body.appendChild(groupTitle);
                    
                    items.forEach(s => {
                        const div = document.createElement('div');
                        div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
                        div.onclick = () => { 
                            vscode.postMessage({ type: 'loadSession', id: s.id }); 
                            sessionList.style.display = 'none';
                        };
                        
                        const infoDiv = document.createElement('div');
                        infoDiv.className = 'session-info';
                        const dateStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        infoDiv.innerHTML = '<div class="session-title">' + (s.title || "Untitled Chat") + '</div><div class="session-date">' + dateStr + '</div>';
                        
                        const actionsDiv = document.createElement('div');
                        actionsDiv.className = 'session-item-actions';
                        
                        const editBtn = document.createElement('div');
                        editBtn.className = 'session-action-btn edit-btn';
                        editBtn.title = 'Rename';
                        editBtn.innerHTML = '${icons.edit}';
                        editBtn.onclick = (e) => { 
                            e.stopPropagation();
                            renameSession(s.id);
                        };
                        
                        const delBtn = document.createElement('div');
                        delBtn.className = 'session-action-btn delete-btn';
                        delBtn.title = 'Delete';
                        delBtn.innerHTML = '${icons.trash}';
                        delBtn.onclick = (e) => { 
                            e.stopPropagation();
                            if(confirm('Delete this chat?')) {
                                vscode.postMessage({ type: 'deleteSession', id: s.id });
                            }
                        };
                        
                        actionsDiv.appendChild(editBtn);
                        actionsDiv.appendChild(delBtn);
                        div.appendChild(infoDiv);
                        div.appendChild(actionsDiv);
                        body.appendChild(div);
                    });
                };
                
                renderGroup('Today', groups.today);
                renderGroup('Yesterday', groups.yesterday);
                renderGroup('This Week', groups.thisWeek);
                renderGroup('Older', groups.older);
            }
            
            sessionList.appendChild(body);
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
            // Find or create current status container
            if (!currentBotMessageDiv) {
                // If it's the very first status of a sequence, create a placeholder in the chat
                const wrapper = document.createElement('div');
                wrapper.className = 'message-wrapper';
                wrapper.innerHTML = '<div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div><div class="message assistant-msg"></div>';
                chat.appendChild(wrapper);
                currentBotMessageDiv = wrapper;
            }

            const msgContent = currentBotMessageDiv.querySelector('.message');
            let statusContainer = msgContent.querySelector('.status-container');
            
            if (!statusContainer) {
                // Prepend status container
                const container = document.createElement('div');
                container.className = 'status-container';
                // Default to OPEN if it's the very first thought, or CLOSED? User prefers clean UI, so maybe closed or auto-collapsing.
                // Let's keep it closed by default but show "Thinking..."
                container.innerHTML = \`<div class="status-header" onclick="this.nextElementSibling.classList.toggle('open'); const arrow = this.querySelector('.arrow'); arrow.innerText = this.nextElementSibling.classList.contains('open') ? '▼' : '▶';">
                    <span class="status-indicator">${icons.sync} Thinking Process...</span>
                    <span class="arrow">▶</span>
                </div>
                <div class="status-content" id="currentStatusLog"></div>\`; 
                
                // Insert at top
                if (msgContent.firstChild) {
                    msgContent.insertBefore(container, msgContent.firstChild);
                } else {
                    msgContent.appendChild(container);
                }
                statusContainer = container;
            }

            const log = statusContainer.querySelector('#currentStatusLog');
            if (log) {
                const entry = document.createElement('div');
                entry.className = 'status-entry';
                const time = new Date().toLocaleTimeString().split(' ')[0];
                entry.innerHTML = \`<span class="status-time">[\${time}]</span> <span class="status-text">\${text}</span>\`;
                log.appendChild(entry);
                log.scrollTop = log.scrollHeight;
                
                // Update header text to show latest step
                statusContainer.querySelector('.status-indicator').innerHTML = \`${icons.sync} \${text}\`;
            }
            
            chat.scrollTop = chat.scrollHeight;
        }

        function addMessage(role, text, index, commitHash) {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper ' + (role === 'user' ? 'user-wrapper' : 'assistant-wrapper');

            let headerHtml = '';
            if (role === 'user') {
                headerHtml = \`<div class="header-row user-header">You</div>\`;
            } else {
                headerHtml = '<div class="header-row"><span class="avatar">${icons.bot}</span> Byte AI</div>';
            }

            let wrapperHtml = headerHtml + '<div class="message ' + (role === 'user' ? 'user-msg' : 'assistant-msg') + '">' + formatMarkdown(text);
            
            // Add Footer for User Messages (Reset Icon) - ONLY for agentic tasks with file changes (has commitHash)
            if (role === 'user' && commitHash && index !== undefined && index !== null) {
                wrapperHtml += \`<div class="msg-footer">
                    <span class="footer-icon" title="Reset to this version (revert file changes)" onclick="resetTo(\${index})">${icons.reset}</span>
                </div>\`;
            }
            
            wrapperHtml += '</div>';
            wrapper.innerHTML = wrapperHtml;
            chat.appendChild(wrapper);
            chat.scrollTop = chat.scrollHeight;
        }

        function updateBotMessage(text) {
            if (!currentBotMessageDiv) {
                const wrapper = document.createElement('div');
                wrapper.className = 'message-wrapper assistant-wrapper';
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
