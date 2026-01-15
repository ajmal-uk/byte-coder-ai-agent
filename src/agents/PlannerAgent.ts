import * as vscode from 'vscode';
import { IAgent, AgentResponse } from './interfaces';
import { ByteAIClient } from '../byteAIClient';
import { PLAN_PROMPT } from '../agentPrompts';

export class PlannerAgent implements IAgent {
    public name = "PlannerAgent";
    private client: ByteAIClient;

    constructor(client: ByteAIClient) {
        this.client = client;
    }

    public async execute(input: string, context: any, onUpdate: (update: AgentResponse) => void): Promise<void> {
        onUpdate({ type: 'status', value: '📝 Drafting Implementation Plan (Virtual)...', isStream: false });

        const prompt = `${PLAN_PROMPT}\n\n[CONTEXT]:\n${context.fullContext}\n\n[REQUEST]: ${input}\n\n[INSTRUCTION]: Create a detailed implementation plan.`;

        let fullPlan = "";
        await this.client.streamResponse(prompt,
            (chunk) => {
                fullPlan += chunk;
                onUpdate({ type: 'response', value: chunk, isStream: true });
            },
            (err) => onUpdate({ type: 'error', value: err.message })
        );

        // --- VIRTUAL PLAN LOGIC ---
        // Instead of writing to disk, show as an "Untitled" document
        onUpdate({ type: 'status', value: 'Opening Virtual Plan...', isStream: false });

        try {
            const doc = await vscode.workspace.openTextDocument({
                content: fullPlan,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: false
            });

            // Signal that we are ready for review
            onUpdate({ type: 'action', value: 'showPlanReview' });
        } catch (e: any) {
            onUpdate({ type: 'error', value: "Failed to open virtual plan: " + e.message });
        }
    }
}
