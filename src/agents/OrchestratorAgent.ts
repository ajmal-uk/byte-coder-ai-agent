import * as vscode from 'vscode';
import { AgentPipeline, AnalysisResult } from '../agentPipeline';
import { ChatAgent } from './ChatAgent';
import { PlannerAgent } from './PlannerAgent';
import { ExecutionAgent } from './ExecutionAgent';
import { ByteAIClient } from '../byteAIClient';
import { TerminalManager } from '../terminalAccess';
import { VersionManager } from './VersionManager';
import { AgentResponse } from './interfaces';

export class OrchestratorAgent {
    private pipeline: AgentPipeline;
    private chatAgent: ChatAgent;
    private plannerAgent: PlannerAgent;
    private executionAgent: ExecutionAgent;

    constructor(
        private client: ByteAIClient,
        private terminal: TerminalManager,
        private gitManager: VersionManager
    ) {
        this.pipeline = new AgentPipeline();
        this.chatAgent = new ChatAgent(client);
        this.plannerAgent = new PlannerAgent(client);
        this.executionAgent = new ExecutionAgent(client, terminal, gitManager);
    }

    public async routeRequest(
        message: string,
        mode: string,
        buildContextCb: (analysis: AnalysisResult) => Promise<string>,
        onUpdate: (update: AgentResponse) => void
    ) {
        // 1. Analyze
        onUpdate({ type: 'status', value: '🧠 Orchestrator Analyzing...', isStream: false });
        const analysis = await this.pipeline.analyzeInput(message);

        // 2. Build Context (Delegated to ChatViewProvider logic for now via callback)
        const fullContext = await buildContextCb(analysis);
        const contextObj = { fullContext };

        const isSimpleChat = (analysis.intent === 'chat' || analysis.intent === 'unknown') && analysis.complexity === 'simple';
        const isAgenticRequest = analysis.intent === 'coding' || analysis.intent === 'command';

        // --- ROUTING LOGIC ---

        // Case A: Plan Mode => Always Chat/Consult (ChatAgent) unless strictly "Agent" tasks demanded? 
        // Actually, user wants "PlannerAgent" behavior in Agent mode, and "ChatAgent" in Plan mode?
        // Let's stick to the "Smart Routing" logic we verified.

        if (mode === 'agent') {
            if (isSimpleChat) {
                // User is in Agent mode but said "Hi". Don't plan. Just chat.
                onUpdate({ type: 'status', value: '💬 Simple Chat (Bypassing Planner)...', isStream: false });
                await this.chatAgent.execute(message, contextObj, onUpdate);
            } else {
                // Complex Coding Task -> Call Planner
                onUpdate({ type: 'status', value: '🏗️ Routing to Planner Agent...', isStream: false });
                await this.plannerAgent.execute(message, contextObj, onUpdate);
            }
        } else {
            // Plan Mode (Consultant)
            if (isAgenticRequest && analysis.complexity === 'complex') {
                // User asked for complex code in Chat mode.
                // Orchestrator Suggestion: "I can implement this. Switch to Agent Mode?"
                // For now, we process as Chat, but add a tip.
                onUpdate({ type: 'status', value: '💡 Tip: Switch to Agent Mode for auto-execution.', isStream: false });
            }
            await this.chatAgent.execute(message, contextObj, onUpdate);
        }
    }

    public async executePlan(message: string, context: string, onUpdate: (update: AgentResponse) => void) {
        await this.executionAgent.execute(message, { fullContext: context }, onUpdate);
    }
}
