/**
 * ContextAnalyzer - Analyzes found context for relevance and filters results
 * Uses semantic scoring, dependency tracing, and usage analysis
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BaseAgent, AgentOutput } from '../core/AgentTypes';
import { ContextPlan } from './ContextPlanner';

export interface ContextChunk {
    filePath: string;
    content: string;
    startLine: number;
    endLine: number;
    type: 'function' | 'class' | 'import' | 'export' | 'block' | 'full';
    score: number;
    matchedTerms: string[];
}

export interface AnalyzedContext {
    chunks: ContextChunk[];
    totalFiles: number;
    totalChunks: number;
    tokensEstimate: number;
    summary: string;
    dependencies?: { [file: string]: string[] };
}

export interface ContextAnalyzerInput {
    rawContent: Map<string, string>;
    plan: ContextPlan;
    query: string;
}

export class ContextAnalyzer extends BaseAgent<ContextAnalyzerInput, AnalyzedContext> {
    private readonly MAX_TOKENS = 8000;
    private readonly TOKENS_PER_CHAR = 0.25; // Approximate

    constructor() {
        super({ name: 'ContextAnalyzer', timeout: 10000 });
    }

    async execute(input: ContextAnalyzerInput): Promise<AgentOutput<AnalyzedContext>> {
        const startTime = Date.now();

        try {
            const chunks: ContextChunk[] = [];

            // Process each file
            for (const [filePath, content] of input.rawContent) {
                const fileChunks = this.extractAndScoreChunks(filePath, content, input);
                chunks.push(...fileChunks);
            }

            // Sort by score and filter to budget
            const sortedChunks = chunks.sort((a, b) => b.score - a.score);
            const selectedChunks = this.selectWithinBudget(sortedChunks);

            const tokensEstimate = Math.floor(
                selectedChunks.reduce((sum, c) => sum + c.content.length, 0) * this.TOKENS_PER_CHAR
            );

            // Extract dependencies (NEW)
            const dependencies = this.extractDependencies(input.rawContent);

            const result: AnalyzedContext = {
                chunks: selectedChunks,
                totalFiles: input.rawContent.size,
                totalChunks: selectedChunks.length,
                tokensEstimate,
                summary: this.buildSummary(selectedChunks, input.plan),
                dependencies
            };

            return this.createOutput('success', result, 0.9, startTime, {
                reasoning: `Analyzed ${input.rawContent.size} files, selected ${selectedChunks.length} chunks (~${tokensEstimate} tokens)`
            });
        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Extract dependencies between files using regex and basic path resolution
     */
    private extractDependencies(files: Map<string, string>): { [file: string]: string[] } {
        const dependencies: { [file: string]: string[] } = {};
        
        for (const [filePath, content] of files) {
            const deps: string[] = [];
            const fileDir = path.dirname(filePath);

            const resolveImport = (importPath: string): string => {
                if (importPath.startsWith('.')) {
                    const absolutePath = path.resolve(fileDir, importPath);
                    
                    // 1. Check if exact path exists in our file map
                    if (files.has(absolutePath)) return absolutePath;

                    // 2. Check common extensions
                    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.py'];
                    for (const ext of extensions) {
                        const withExt = absolutePath + ext;
                        if (files.has(withExt)) return withExt;
                        // Also check disk if not in map (optional, but good for completeness)
                        if (fs.existsSync(withExt)) return withExt;
                    }

                    // 3. Check for directory index files
                    for (const ext of extensions) {
                        const indexWithExt = path.join(absolutePath, 'index' + ext);
                        if (files.has(indexWithExt)) return indexWithExt;
                        if (fs.existsSync(indexWithExt)) return indexWithExt;
                    }

                    return absolutePath;
                }
                return importPath; // External package
            };
            
            // TypeScript/JS imports
            const importMatches = content.matchAll(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g);
            for (const match of importMatches) {
                deps.push(resolveImport(match[1]));
            }

            // CommonJS requires
            const requireMatches = content.matchAll(/require\(['"]([^'"]+)['"]\)/g);
            for (const match of requireMatches) {
                deps.push(resolveImport(match[1]));
            }
            
            // Python imports
            const resolvePythonImport = (importPath: string): string => {
                // Handle relative imports (starting with dots)
                if (importPath.startsWith('.')) {
                    // Count leading dots to determine level
                    const leadingDotsMatch = importPath.match(/^\.+/);
                    const leadingDots = leadingDotsMatch ? leadingDotsMatch[0].length : 0;
                    const modulePath = importPath.substring(leadingDots);
                    
                    // Python: . is current, .. is parent, ... is grandparent
                    // path.resolve handles .. correctly, but we need to construct the path
                    // . means current directory
                    let searchDir = fileDir;
                    for (let i = 1; i < leadingDots; i++) {
                        searchDir = path.dirname(searchDir);
                    }

                    const parts = modulePath.split('.');
                    const relativePath = path.join(...parts);
                    const absolutePath = path.resolve(searchDir, relativePath);

                    // Check file.py
                    if (files.has(absolutePath + '.py')) return absolutePath + '.py';
                    if (fs.existsSync(absolutePath + '.py')) return absolutePath + '.py';

                    // Check file/__init__.py
                    const initPath = path.join(absolutePath, '__init__.py');
                    if (files.has(initPath)) return initPath;
                    if (fs.existsSync(initPath)) return initPath;

                    return absolutePath;
                }
                
                // Handle absolute/local imports
                // Try to find it relative to current file first (local module)
                const parts = importPath.split('.');
                const relativePath = path.join(...parts);
                const localPath = path.resolve(fileDir, relativePath);

                if (files.has(localPath + '.py')) return localPath + '.py';
                if (fs.existsSync(localPath + '.py')) return localPath + '.py';
                
                const localInitPath = path.join(localPath, '__init__.py');
                if (files.has(localInitPath)) return localInitPath;
                if (fs.existsSync(localInitPath)) return localInitPath;

                return importPath;
            };

            const pyFromMatches = content.matchAll(/^from\s+([\.\w]+)\s+import\s+/gm);
            for (const match of pyFromMatches) {
                deps.push(resolvePythonImport(match[1]));
            }

            const pyImportMatches = content.matchAll(/^import\s+([\w\.]+)/gm);
            for (const match of pyImportMatches) {
                deps.push(resolvePythonImport(match[1]));
            }

            if (deps.length > 0) {
                dependencies[filePath] = [...new Set(deps)];
            }
        }
        
        return dependencies;
    }

    /**
     * Public analysis method for Pipeline usage
     */
    public analyze(
        files: { uri: vscode.Uri, content: string }[],
        searchTerms: string[],
        symbolSearch: string[],
        tokenLimit: number = 8000
    ): AnalyzedContext {
        const rawContent = new Map<string, string>();
        files.forEach(f => rawContent.set(f.uri.fsPath, f.content));

        // Mock input struct for reuse
        const input: any = {
            plan: { searchTerms, symbolSearch },
            rawContent
        };

        const chunks: ContextChunk[] = [];
        for (const [filePath, content] of rawContent) {
            chunks.push(...this.extractAndScoreChunks(filePath, content, input));
        }

        const sortedChunks = chunks.sort((a, b) => b.score - a.score);

        // Selection logic with dynamic limit
        const selected: ContextChunk[] = [];
        let totalChars = 0;
        const maxChars = tokenLimit / 0.25;

        for (const chunk of sortedChunks) {
            if (totalChars + chunk.content.length > maxChars) {
                const remaining = maxChars - totalChars;
                if (remaining > 500) {
                    selected.push({ ...chunk, content: chunk.content.slice(0, remaining) + '\n// ... truncated' });
                }
                break;
            }
            selected.push(chunk);
            totalChars += chunk.content.length;
        }

        const tokensEstimate = Math.floor(
            selected.reduce((sum, c) => sum + c.content.length, 0) * 0.25
        );

        return {
            chunks: selected,
            totalFiles: rawContent.size,
            totalChunks: selected.length,
            tokensEstimate,
            summary: this.buildSummary(selected, input.plan)
        };
    }

    private extractAndScoreChunks(filePath: string, content: string, input: ContextAnalyzerInput): ContextChunk[] {
        const chunks: ContextChunk[] = [];
        const lines = content.split('\n');
        const searchTerms = input.plan.searchTerms;
        const symbolSearch = input.plan.symbolSearch;

        // If file is small, use full content
        if (lines.length < 100) {
            const score = this.scoreContent(content, searchTerms, symbolSearch);
            if (score > 0) {
                chunks.push({
                    filePath,
                    content,
                    startLine: 1,
                    endLine: lines.length,
                    type: 'full',
                    score,
                    matchedTerms: this.getMatchedTerms(content, searchTerms)
                });
            }
            return chunks;
        }

        // For larger files, extract chunks
        const codeChunks = this.extractCodeChunks(lines, filePath);

        for (const chunk of codeChunks) {
            const score = this.scoreContent(chunk.content, searchTerms, symbolSearch);
            if (score > 0.1) {
                chunks.push({
                    ...chunk,
                    score,
                    matchedTerms: this.getMatchedTerms(chunk.content, searchTerms)
                });
            }
        }

        return chunks;
    }

    private extractCodeChunks(lines: string[], filePath: string): Omit<ContextChunk, 'score' | 'matchedTerms'>[] {
        const chunks: Omit<ContextChunk, 'score' | 'matchedTerms'>[] = [];
        const ext = filePath.split('.').pop()?.toLowerCase() || '';

        // Language-specific patterns
        const patterns = this.getChunkPatterns(ext);

        let currentChunk: { start: number; lines: string[] } | null = null;
        let braceCount = 0;
        let inChunk = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Check for chunk starters
            if (patterns.starters.some(p => p.test(trimmed))) {
                if (currentChunk && currentChunk.lines.length > 0) {
                    // Save previous chunk
                    chunks.push({
                        filePath,
                        content: currentChunk.lines.join('\n'),
                        startLine: currentChunk.start,
                        endLine: i,
                        type: this.determineChunkType(currentChunk.lines[0])
                    });
                }
                currentChunk = { start: i + 1, lines: [] };
                braceCount = 0;
                inChunk = true;
            }

            if (inChunk && currentChunk) {
                currentChunk.lines.push(line);
                braceCount += (line.match(/{/g) || []).length;
                braceCount -= (line.match(/}/g) || []).length;

                // Check for chunk end
                if (braceCount <= 0 && currentChunk.lines.length > 1) {
                    chunks.push({
                        filePath,
                        content: currentChunk.lines.join('\n'),
                        startLine: currentChunk.start,
                        endLine: i + 1,
                        type: this.determineChunkType(currentChunk.lines[0])
                    });
                    currentChunk = null;
                    inChunk = false;
                }
            }
        }

        // Handle remaining chunk
        if (currentChunk && currentChunk.lines.length > 0) {
            chunks.push({
                filePath,
                content: currentChunk.lines.join('\n'),
                startLine: currentChunk.start,
                endLine: lines.length,
                type: this.determineChunkType(currentChunk.lines[0])
            });
        }

        // Also extract imports
        const imports = lines.filter((l, i) => {
            const t = l.trim();
            return t.startsWith('import ') || t.startsWith('from ') ||
                t.startsWith('require(') || t.startsWith('const ') && t.includes('require(');
        });

        if (imports.length > 0) {
            chunks.unshift({
                filePath,
                content: imports.join('\n'),
                startLine: 1,
                endLine: imports.length,
                type: 'import'
            });
        }

        return chunks;
    }

    private getChunkPatterns(ext: string): { starters: RegExp[] } {
        switch (ext) {
            case 'ts':
            case 'tsx':
            case 'js':
            case 'jsx':
                return {
                    starters: [
                        /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
                        /^(?:export\s+)?(?:default\s+)?class\s+\w+/,
                        /^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(/,
                        /^(?:export\s+)?const\s+\w+\s*=\s*\(/,
                        /^\w+\s*\([^)]*\)\s*{/,
                        /^(?:public|private|protected|async)\s+\w+\s*\(/
                    ]
                };
            case 'py':
                return {
                    starters: [
                        /^(?:async\s+)?def\s+\w+/,
                        /^class\s+\w+/
                    ]
                };
            default:
                return {
                    starters: [
                        /^(?:function|class|def|func)\s+\w+/
                    ]
                };
        }
    }

    private determineChunkType(firstLine: string): ContextChunk['type'] {
        const t = firstLine.trim().toLowerCase();
        if (t.includes('class ')) return 'class';
        if (t.includes('function ') || t.includes('def ')) return 'function';
        if (t.includes('import ') || t.includes('from ')) return 'import';
        if (t.includes('export ')) return 'export';
        return 'block';
    }

    private scoreContent(content: string, searchTerms: string[], symbolSearch: string[]): number {
        const lowerContent = content.toLowerCase();
        let score = 0;

        // Term matching
        for (const term of searchTerms) {
            const count = (lowerContent.match(new RegExp(term.toLowerCase(), 'g')) || []).length;
            score += count * 0.2;
        }

        // Symbol matching (higher weight)
        for (const symbol of symbolSearch) {
            if (content.includes(symbol)) {
                score += 0.5;
            }
        }

        // Bonus for definitions vs usages
        const defPatterns = [/(?:function|class|const|let|var|def)\s+/];
        for (const pattern of defPatterns) {
            if (pattern.test(content)) {
                score += 0.1;
            }
        }

        // Normalize to 0-1
        return Math.min(1, score);
    }

    private getMatchedTerms(content: string, searchTerms: string[]): string[] {
        const lowerContent = content.toLowerCase();
        return searchTerms.filter(term => lowerContent.includes(term.toLowerCase()));
    }

    private selectWithinBudget(chunks: ContextChunk[]): ContextChunk[] {
        const selected: ContextChunk[] = [];
        let totalChars = 0;
        const maxChars = this.MAX_TOKENS / this.TOKENS_PER_CHAR;

        for (const chunk of chunks) {
            if (totalChars + chunk.content.length > maxChars) {
                // Truncate if needed
                const remaining = maxChars - totalChars;
                if (remaining > 500) {
                    selected.push({
                        ...chunk,
                        content: chunk.content.slice(0, remaining) + '\n// ... truncated'
                    });
                }
                break;
            }
            selected.push(chunk);
            totalChars += chunk.content.length;
        }

        return selected;
    }

    private buildSummary(chunks: ContextChunk[], plan: ContextPlan): string {
        const files = [...new Set(chunks.map(c => c.filePath))];
        const types = chunks.reduce((acc, c) => {
            acc[c.type] = (acc[c.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const typeStr = Object.entries(types)
            .map(([t, n]) => `${n} ${t}s`)
            .join(', ');

        return `Found ${chunks.length} chunks from ${files.length} files (${typeStr})`;
    }
}
