import * as vscode from 'vscode';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';

export interface AnalysisResult {
    intent: 'coding' | 'chat' | 'command' | 'unknown';
    complexity: 'simple' | 'complex';
    needsFiles: boolean;
    relevantKeywords: string[];
}

export interface EvaluationResult {
    contextFiles: vscode.Uri[];
    missingInfo: string[];
}

export class AgentPipeline {
    private analyzer: WorkspaceAnalyzer;

    constructor() {
        this.analyzer = new WorkspaceAnalyzer();
    }

    // Agent 1: Input Analyzer
    public async analyzeInput(input: string): Promise<AnalysisResult> {
        const lower = input.toLowerCase();
        const intent = /(create|update|fix|refactor|write|code|function|class)/.test(lower) ? 'coding'
            : /(run|execute|install|command)/.test(lower) ? 'command' : 'chat';

        const complexity = input.length > 50 || lower.includes('project') ? 'complex' : 'simple';
        const needsFiles = intent === 'coding' || intent === 'command';

        return { intent, complexity, needsFiles, relevantKeywords: input.split(' ') };
    }

    // Agent 2: Context Evaluator
    public async evaluateContext(analysis: AnalysisResult): Promise<EvaluationResult> {
        let contextFiles: vscode.Uri[] = [];

        if (analysis.needsFiles) {
            // Include active editor
            if (vscode.window.activeTextEditor) {
                contextFiles.push(vscode.window.activeTextEditor.document.uri);
            }

            // Try to find mentioned files
            // (In a real advanced agent, we would do embedding search here)
        }

        return { contextFiles, missingInfo: [] };
    }

    // Agent 3: Context Builder (Final Prompt Prep)
    public buildContext(evaluation: EvaluationResult, analysis: AnalysisResult): string {
        let context = `[AGENT ANALYSIS]\nIntent: ${analysis.intent}\nComplexity: ${analysis.complexity}\n`;

        if (evaluation.contextFiles.length > 0) {
            context += `\n[RELEVANT FILES]:\n${evaluation.contextFiles.map(u => u.fsPath).join('\n')}`;
        }

        return context;
    }
}
