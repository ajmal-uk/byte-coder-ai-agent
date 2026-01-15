import * as vscode from 'vscode';
import { IAgent, AgentResponse } from './interfaces';
import { ByteAIClient } from '../byteAIClient';
import { TerminalManager } from '../terminalAccess';
import { VersionManager } from './VersionManager';
import { AGENT_PROMPT } from '../agentPrompts';

export class ExecutionAgent implements IAgent {
    public name = "ExecutionAgent";
    private client: ByteAIClient;
    private terminal: TerminalManager;
    private gitManager: VersionManager;

    constructor(client: ByteAIClient, terminal: TerminalManager, gitManager: VersionManager) {
        this.client = client;
        this.terminal = terminal;
        this.gitManager = gitManager;
    }

    public async execute(input: string, context: any, onUpdate: (update: AgentResponse) => void): Promise<void> {
        onUpdate({ type: 'status', value: '⚡ Executing Approved Plan...', isStream: false });

        const prompt = `${AGENT_PROMPT}\n\n[CONTEXT]:\n${context.fullContext}\n\n[USER APPROVED PLAN]: Execute the plan for: ${input}`;

        let fullResponse = "";
        await this.client.streamResponse(prompt,
            (chunk) => {
                fullResponse += chunk;
                onUpdate({ type: 'response', value: chunk, isStream: true });
            },
            (err) => onUpdate({ type: 'error', value: err.message })
        );

        if (fullResponse) {
            // --- EXECUTION PHASE ---
            await this.terminal.processAndExecute(fullResponse);
            // Note: File creation/editing logic logic needs to be migrated or shared. 
            // checks for `$$ FILE:` and `$$ EDIT:` patterns would go here or be exposed in separate FileAccess utility.
            // For now, we assume simple terminal execution is key, file logic to be moved or duplicated from ChatViewProvider. 
            // (Ideally, refactor duplicate logic into a `FilesystemAgent` or utility).
        }
    }
}
