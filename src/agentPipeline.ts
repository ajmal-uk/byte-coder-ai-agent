import * as vscode from 'vscode';
import { WorkspaceAnalyzer } from './workspaceAnalyzer';
import { SearcherAgent } from './agents/SearcherAgent';
import { ContextManager } from './agents/ContextManager';

export interface AnalysisResult {
    intent: 'coding' | 'chat' | 'command' | 'unknown';
    complexity: 'simple' | 'complex';
    needsFiles: boolean;
    relevantKeywords: string[];
}

export interface EvaluationResult {
    contextFiles: { uri: vscode.Uri, content: string }[];
    missingInfo: string[];
}

export class AgentPipeline {
    private analyzer: WorkspaceAnalyzer;
    private searcher: SearcherAgent;
    private contextManager: ContextManager;

    constructor() {
        this.analyzer = new WorkspaceAnalyzer();
        this.searcher = new SearcherAgent();
        this.contextManager = new ContextManager();
    }

    // Agent 1: Prompt Enhancer
    public async enhancePrompt(input: string, context: string): Promise<string> {
        // Enforce the mental model of the pipeline
        const enhancement = `
[TASK]: ${input}
[CONTEXT]: ${context}
[INSTRUCTION]: Act as the "Prompt Enhancer Agent". Refine this user request into a precise engineering task for the subsequent agents.
Ensure to:
1. Clarify ambiguous intents.
2. Explicitly state constraints.
3. Reference the System Prompt's behavioral rules.
`;
        return enhancement; // Ideally, this would be an LLM call, but for now we structure it.
    }

    // Agent 2: Input Analyzer
    public async analyzeInput(input: string): Promise<AnalysisResult> {
        const lower = input.toLowerCase();

        // Improved Regex for Intent Classification
        const codingRegex = /(create|update|fix|refactor|write|code|function|class|method|implement|bug|error)/i;
        const commandRegex = /(run|execute|install|command|terminal|shell|npm|build|test)/i;
        const chatRegex = /(explain|how|what|why|help|question)/i;

        // Prioritize specific intents
        let intent: 'coding' | 'chat' | 'command' | 'unknown' = 'chat';

        if (commandRegex.test(lower) && !codingRegex.test(lower)) {
            intent = 'command';
        } else if (codingRegex.test(lower)) {
            intent = 'coding';
        } else if (chatRegex.test(lower)) {
            intent = 'chat';
        }

        const complexity = input.length > 50 || lower.includes('project') || lower.includes('search') ? 'complex' : 'simple';
        const needsFiles = intent === 'coding' || intent === 'command' || intent === 'chat'; // Chat might need context too

        // Extract basic keywords (exclude common stopwords)
        const stopWords = ['make', 'create', 'write', 'this', 'that', 'with', 'from', 'into', 'user', 'agent', 'please', 'code', 'file'];
        const keywords = input.split(/[\s,.]+/)
            .filter(w => w.length > 3 && !stopWords.includes(w.toLowerCase()));

        return { intent, complexity, needsFiles, relevantKeywords: keywords };
    }

    // Agent 2: Context Evaluator (Searcher + Reader)
    public async evaluateContext(analysis: AnalysisResult): Promise<EvaluationResult> {
        let rawFiles: { uri: vscode.Uri, content: string }[] = [];

        if (analysis.needsFiles) {
            // 1. Gather Candidate Files
            let candidateUris: vscode.Uri[] = [];

            // A. Active File
            if (vscode.window.activeTextEditor) {
                candidateUris.push(vscode.window.activeTextEditor.document.uri);
            }

            // B. Search for mentioned keywords if complex or if specific keywords exist
            if (analysis.complexity === 'complex' || analysis.relevantKeywords.length > 0) {
                for (const keyword of analysis.relevantKeywords) {
                    // Use the upgraded SearcherAgent which verifies content!
                    const found = await this.searcher.searchContent(keyword);
                    candidateUris.push(...found);
                }
            }

            // Deduplicate
            const uniqueUris = Array.from(new Set(candidateUris.map(u => u.toString()))).map(s => vscode.Uri.parse(s));

            // 2. Read Content (up to a limit)
            for (const uri of uniqueUris.slice(0, 10)) { // Increased limit (Searcher filters bad ones now)
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    rawFiles.push({ uri, content: doc.getText() });
                } catch (e) { console.error("Failed to read", uri.fsPath); }
            }
        }

        return { contextFiles: rawFiles, missingInfo: [] };
    }

    // Agent 3: Context Builder (Pruner)
    public buildContext(evaluation: EvaluationResult, analysis: AnalysisResult): string {
        let context = `[AGENT ANALYSIS]\nIntent: ${analysis.intent}\nComplexity: ${analysis.complexity}\n`;

        // Prune content using ContextManager
        const filesForContext = evaluation.contextFiles.map(f => ({ path: f.uri.fsPath, content: f.content }));
        const activeFile = vscode.window.activeTextEditor?.document.fileName;

        const prunedFiles = this.contextManager.pruneContext(filesForContext, activeFile);

        if (prunedFiles.length > 0) {
            context += `\n[RELEVANT FILES]:\n`;
            for (const f of prunedFiles) {
                context += `\n--- ${vscode.workspace.asRelativePath(f.path)} ---\n${f.content}\n--- END OF FILE ---\n`;
            }
        }

        return context;
    }

    // Agent 9: Final Safety Evaluator
    public async safetyCheck(plan: string): Promise<boolean> {
        // In a real system, this would use an LLM or regex to look for `rm -rf`, `format C:`, etc.
        const dangerousPatterns = ['rm -rf /', 'format ', ':(){ :|:& };:'];
        for (const pattern of dangerousPatterns) {
            if (plan.includes(pattern)) return false;
        }
        return true;
    }
}
