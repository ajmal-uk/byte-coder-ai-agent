/**
 * SearchAgent - Intelligent search orchestrator for finding relevant code context
 * Coordinates sub-agents to analyze queries, find files, and extract relevant code
 */

import * as vscode from 'vscode';
import {
    IntentAnalyzer,
    FileFinderAgent,
    CodeExtractorAgent,
    RelevanceScorerAgent,
    ContextSearchAgent,
    ContextSearchResult,
    SearchIntent,
    ScoredResult,
    ScoredChunk
} from './agents';

export interface SearchStatus {
    phase: string;
    message: string;
    progress?: number;
}

export class SearchAgent {
    // Sub-agents
    private intentAnalyzer: IntentAnalyzer;
    private fileFinder: FileFinderAgent;
    private codeExtractor: CodeExtractorAgent;
    private relevanceScorer: RelevanceScorerAgent;
    private contextSearch: ContextSearchAgent;

    // Caching
    private projectMapCache: { value: string; time: number } | null = null;
    private readonly PROJECT_MAP_TTL = 60000;

    constructor() {
        this.intentAnalyzer = new IntentAnalyzer();
        this.fileFinder = new FileFinderAgent();
        this.codeExtractor = new CodeExtractorAgent();
        this.relevanceScorer = new RelevanceScorerAgent();
        this.contextSearch = new ContextSearchAgent();
    }

    /**
     * Full search pipeline: analyze → find → extract → score → format
     */
    public async search(
        query: string,
        activeFilePath?: string,
        onStatus?: (phase: string, message: string) => void
    ): Promise<string> {
        const startTime = Date.now();

        try {
            // Phase 1: Analyze intent
            this.emitStatus(onStatus, 'Analyzing', 'Understanding your query...');
            const intent = await this.intentAnalyzer.analyze(query);

            const keywordPreview = intent.keywords.slice(0, 4).join(', ');
            this.emitStatus(onStatus, 'Analyzing', `Found keywords: ${keywordPreview}`);

            // Phase 1.5: Search Context & Knowledge
            this.emitStatus(onStatus, 'Context Search', 'Checking knowledge base...');
            const contextResult = await this.contextSearch.execute({
                query,
                lookForPreviousFixes: intent.queryType === 'fix'
            });

            // Phase 2: Find relevant files
            this.emitStatus(onStatus, 'Searching', 'Scanning workspace for relevant files...');
            const fileMatches = await this.fileFinder.find(intent, activeFilePath);

            // If no files AND no context found, return empty
            if (fileMatches.length === 0 && contextResult.payload.memories.length === 0) {
                this.emitStatus(onStatus, 'No Results', 'No relevant files or knowledge found.');
                return '';
            }

            this.emitStatus(onStatus, 'Searching', `Found ${fileMatches.length} files and ${contextResult.payload.memories.length} memories`);

            // Phase 3: Extract code from files (parallel)
            let extractions: any[] = [];
            if (fileMatches.length > 0) {
                this.emitStatus(onStatus, 'Extracting', 'Reading and analyzing code...');
                const extractionPromises = fileMatches.map(file =>
                    this.codeExtractor.extract(file.uri.fsPath, file.relativePath, intent)
                );
                extractions = await Promise.all(extractionPromises);
            }

            // Phase 4: Score and rank results
            let scoredResults: ScoredResult[] = [];
            let selection = new Map<string, ScoredChunk[]>();
            
            if (extractions.length > 0) {
                this.emitStatus(onStatus, 'Ranking', 'Scoring relevance...');
                scoredResults = this.relevanceScorer.score(extractions, fileMatches, intent);

                // Phase 5: Select best chunks within budget
                selection = this.relevanceScorer.selectForContext(scoredResults);
            }

            // Phase 6: Format output
            this.emitStatus(onStatus, 'Formatting', 'Building context...');
            const context = this.formatContext(scoredResults, selection, intent, startTime, contextResult.payload);

            const elapsed = Date.now() - startTime;
            this.emitStatus(onStatus, 'Done', `Context ready (${elapsed}ms)`);

            return context;
        } catch (error) {
            console.error('SearchAgent: Error during search', error);
            this.emitStatus(onStatus, 'Error', 'Search failed');
            return '';
        }
    }

    /**
     * Emit status update
     */
    private emitStatus(
        onStatus: ((phase: string, message: string) => void) | undefined,
        phase: string,
        message: string
    ): void {
        if (onStatus) {
            onStatus(phase, message);
        }
    }

    /**
     * Format the context output for AI consumption
     */
    private formatContext(
        results: ScoredResult[],
        selection: Map<string, ScoredChunk[]>,
        intent: SearchIntent,
        startTime: number,
        contextResult?: ContextSearchResult
    ): string {
        if (selection.size === 0 && (!contextResult || contextResult.memories.length === 0)) {
            return '';
        }

        const lines: string[] = [];
        lines.push('\n--- INTELLIGENT CONTEXT ---');
        lines.push(`Query type: ${intent.queryType} | Complexity: ${intent.complexity}`);
        lines.push(`Keywords: ${intent.keywords.slice(0, 6).join(', ')}`);
        if (intent.symbols.length > 0) {
            lines.push(`Symbols: ${intent.symbols.slice(0, 5).join(', ')}`);
        }
        lines.push(`Files analyzed: ${results.length}`);
        lines.push('');

        // Add Context/Knowledge
        if (contextResult && contextResult.memories.length > 0) {
            lines.push('### 🧠 Knowledge & Memories');
            const knowledge = contextResult.memories.filter(m => m.type === 'knowledge');
            const others = contextResult.memories.filter(m => m.type !== 'knowledge');

            if (knowledge.length > 0) {
                lines.push('**Knowledge Base:**');
                knowledge.slice(0, 5).forEach(m => lines.push(`- ${m.summary}`));
                lines.push('');
            }
            if (others.length > 0) {
                lines.push('**History:**');
                others.slice(0, 3).forEach(m => lines.push(`- ${m.summary}`));
                lines.push('');
            }
        }

        let fileIndex = 0;
        for (const [relativePath, chunks] of selection) {
            const result = results.find(r => r.relativePath === relativePath);
            if (!result) continue;

            fileIndex++;
            lines.push(`### [${fileIndex}] \`${relativePath}\``);
            lines.push(`Score: ${result.overallScore.toFixed(1)} | Mode: ${result.extractionMode} | Lines: ${result.summary.totalLines}`);

            if (result.summary.topMatches.length > 0) {
                lines.push(`Matches: ${result.summary.topMatches.join(', ')}`);
            }
            lines.push('');

            // Add chunks
            for (const chunk of chunks) {
                if (chunk.name) {
                    lines.push(`// ${chunk.type}: ${chunk.name} (Lines ${chunk.startLine + 1}-${chunk.endLine + 1})`);
                } else if (chunk.type === 'imports') {
                    lines.push(`// Imports (Lines ${chunk.startLine + 1}-${chunk.endLine + 1})`);
                } else {
                    lines.push(`// Lines ${chunk.startLine + 1}-${chunk.endLine + 1}`);
                }
                lines.push('```' + result.language);
                lines.push(chunk.content);
                lines.push('```');
                lines.push('');
            }
        }

        const elapsed = Date.now() - startTime;
        lines.push(`--- END CONTEXT (${elapsed}ms) ---\n`);

        // Debug output if enabled
        const debugEnabled = vscode.workspace.getConfiguration('byteAI').get<boolean>('debugSearchAgent');
        if (debugEnabled) {
            lines.push('--- SEARCH DEBUG ---');
            for (const result of results.slice(0, 5)) {
                lines.push(`• ${result.relativePath} (score: ${result.overallScore.toFixed(1)}, ${result.extractionMode})`);
                for (const chunk of result.chunks.slice(0, 2)) {
                    const name = chunk.name || chunk.type;
                    lines.push(`  └ ${name} L${chunk.startLine + 1}-${chunk.endLine + 1} (${chunk.finalScore?.toFixed(1) || chunk.score})`);
                }
            }
            lines.push('--- END DEBUG ---\n');
        }

        return lines.join('\n');
    }

    /**
     * Analyze query (exposed for external use)
     */
    public async analyzeQuery(query: string): Promise<SearchIntent> {
        return await this.intentAnalyzer.analyze(query);
    }

    /**
     * Get project map (tree view of workspace)
     */
    public async getProjectMap(): Promise<string> {
        try {
            const now = Date.now();

            if (this.projectMapCache && (now - this.projectMapCache.time) < this.PROJECT_MAP_TTL) {
                return this.projectMapCache.value;
            }

            const allFiles = await vscode.workspace.findFiles(
                '**/*',
                '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.DS_Store}',
                1000
            );

            if (allFiles.length === 0) {
                return "No files found in workspace.";
            }

            const paths = allFiles.map(f => vscode.workspace.asRelativePath(f)).sort();

            // Build tree structure
            const tree = new Map<string, Set<string>>();

            for (const path of paths) {
                const parts = path.split('/');
                let currentPath = '';

                for (let i = 0; i < parts.length - 1; i++) {
                    const parent = currentPath;
                    currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

                    if (!tree.has(parent)) {
                        tree.set(parent, new Set());
                    }
                    const parentSet = tree.get(parent);
                    if (parentSet) {
                        parentSet.add(currentPath);
                    }
                }

                // Add file
                const parent = parts.slice(0, -1).join('/');
                if (!tree.has(parent)) {
                    tree.set(parent, new Set());
                }
                const fileParentSet = tree.get(parent);
                if (fileParentSet) {
                    fileParentSet.add(path);
                }
            }

            // Format tree
            let map = '\n--- PROJECT STRUCTURE ---\n';
            const visited = new Set<string>();

            const formatNode = (path: string, depth: number): string => {
                if (visited.has(path)) return '';
                visited.add(path);

                const parts = path.split('/');
                const name = parts[parts.length - 1] || path;
                const indent = '  '.repeat(depth);
                const isDir = tree.has(path);

                let result = `${indent}${isDir ? '📁' : '📄'} ${name}\n`;

                if (isDir) {
                    const children = Array.from(tree.get(path) || []).sort();
                    for (const child of children) {
                        result += formatNode(child, depth + 1);
                    }
                }

                return result;
            };

            const rootItems = tree.get('') || new Set();
            for (const item of Array.from(rootItems).sort()) {
                map += formatNode(item, 0);
            }

            map += '--- END PROJECT STRUCTURE ---\n';

            this.projectMapCache = { value: map, time: now };
            return map;

        } catch (e) {
            console.error('SearchAgent: Error generating project map', e);
            return '';
        }
    }

    /**
     * Clear all caches
     */
    public clearCache(): void {
        this.fileFinder.clearCache();
        this.projectMapCache = null;
    }
}

// Re-export types for convenience
export { SearchIntent } from './agents';
