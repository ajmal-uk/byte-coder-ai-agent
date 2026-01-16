/**
 * SearchAgent - Intelligent search agent for finding relevant code context
 * Searches workspace to find files and sections relevant to user queries
 */

import * as vscode from 'vscode';

export interface SearchIntent {
    keywords: string[];
    codeTerms: string[];   // Function/class names to search
    filePatterns: string[]; // File patterns to prioritize
    queryType: 'fix' | 'explain' | 'refactor' | 'test' | 'general';
}

export interface CodeSection {
    content: string;
    startLine: number;
    endLine: number;
    matchScore: number;
}

export interface SearchResult {
    filePath: string;
    relativePath: string;
    language: string;
    relevanceScore: number;
    matchedKeywords: string[];
    sections: CodeSection[];
    fullContent?: string;
}

export class SearchAgent {
    private readonly MAX_FILES = 5;        // Max files to include
    private readonly MAX_CONTENT_PER_FILE = 6000;
    private readonly MIN_RELEVANCE_SCORE = 2;

    // Common programming keywords to filter out
    private readonly STOP_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
        'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
        'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
        'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
        'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'code',
        'file', 'function', 'class', 'method', 'variable', 'please', 'help',
        'want', 'need', 'make', 'create', 'add', 'get', 'set', 'use'
    ]);

    // Query type patterns
    private readonly QUERY_PATTERNS: { [key: string]: RegExp[] } = {
        'fix': [/fix/i, /bug/i, /error/i, /issue/i, /problem/i, /broken/i, /wrong/i, /fail/i],
        'explain': [/explain/i, /what/i, /how/i, /why/i, /understand/i, /describe/i],
        'refactor': [/refactor/i, /improve/i, /optimize/i, /clean/i, /better/i, /enhance/i],
    };

    // Semantic expansions for common terms
    private readonly SEMANTIC_MAP: { [key: string]: string[] } = {
        'login': ['auth', 'authentication', 'signin', 'session', 'user'],
        'auth': ['login', 'authentication', 'session', 'token', 'jwt'],
        'error': ['exception', 'catch', 'throw', 'fail', 'bug'],
        'bug': ['error', 'issue', 'fix', 'problem', 'wrong'],
        'api': ['endpoint', 'route', 'request', 'response', 'http'],
        'database': ['db', 'sql', 'query', 'model', 'schema'],
        'test': ['spec', 'jest', 'mocha', 'assert', 'expect'],
        'style': ['css', 'scss', 'styled', 'theme', 'color'],
        'config': ['configuration', 'settings', 'env', 'options'],
    };

    /**
     * Analyze query to extract search intent
     */
    public analyzeQuery(query: string): SearchIntent {
        // Determine query type
        let queryType: SearchIntent['queryType'] = 'general';
        for (const [type, patterns] of Object.entries(this.QUERY_PATTERNS)) {
            if (patterns.some(p => p.test(query))) {
                queryType = type as SearchIntent['queryType'];
                break;
            }
        }

        // Extract keywords
        const words = query.toLowerCase()
            .replace(/[^\w\s@/.-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !this.STOP_WORDS.has(w));

        // Extract code-like terms (camelCase, snake_case, PascalCase)
        const codeTerms = query.match(/[a-zA-Z_][a-zA-Z0-9_]*(?:[A-Z][a-z]+)+|[a-z]+_[a-z_]+/g) || [];

        // Extract @mentioned files
        const mentionedFiles = (query.match(/@[\w./\\-]+/g) || []).map(m => m.substring(1));

        // Expand keywords semantically
        const expandedKeywords = new Set(words);
        for (const word of words) {
            const expansions = this.SEMANTIC_MAP[word];
            if (expansions) {
                expansions.forEach(e => expandedKeywords.add(e));
            }
        }

        // Build file patterns based on keywords
        const filePatterns: string[] = [];
        if (mentionedFiles.length > 0) {
            mentionedFiles.forEach(f => filePatterns.push(`**/*${f}*`));
        }
        expandedKeywords.forEach(kw => {
            if (kw.length > 3) {
                filePatterns.push(`**/*${kw}*`);
            }
        });

        return {
            keywords: Array.from(expandedKeywords),
            codeTerms: [...new Set(codeTerms)],
            filePatterns,
            queryType
        };
    }

    /**
     * Search workspace for relevant files
     */
    public async searchFiles(intent: SearchIntent, activeFile?: string): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const processedFiles = new Set<string>();

        // Get all workspace files
        const allFiles = await vscode.workspace.findFiles(
            '**/*.{ts,js,tsx,jsx,py,java,cs,go,rb,php,vue,svelte,json,yaml,yml,md}',
            '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}'
        );

        // Score each file
        for (const file of allFiles) {
            const relativePath = vscode.workspace.asRelativePath(file);
            if (processedFiles.has(relativePath)) continue;
            processedFiles.add(relativePath);

            const score = this.scoreFile(relativePath, intent);

            // Skip low-relevance files (but always include active file)
            if (score < this.MIN_RELEVANCE_SCORE && relativePath !== activeFile) continue;

            const ext = relativePath.split('.').pop() || 'text';

            results.push({
                filePath: file.fsPath,
                relativePath,
                language: ext,
                relevanceScore: relativePath === activeFile ? score + 100 : score, // Boost active file
                matchedKeywords: intent.keywords.filter(kw =>
                    relativePath.toLowerCase().includes(kw.toLowerCase())
                ),
                sections: []
            });
        }

        // Sort by relevance and take top files
        results.sort((a, b) => b.relevanceScore - a.relevanceScore);
        return results.slice(0, this.MAX_FILES);
    }

    /**
     * Score a file's relevance to the search intent
     */
    private scoreFile(filePath: string, intent: SearchIntent): number {
        let score = 0;
        const lowerPath = filePath.toLowerCase();
        const fileName = lowerPath.split('/').pop() || '';

        // Keyword matches in path
        for (const kw of intent.keywords) {
            if (fileName.includes(kw)) score += 10;  // Filename match is strong
            else if (lowerPath.includes(kw)) score += 5;  // Path match
        }

        // Code term matches
        for (const term of intent.codeTerms) {
            if (lowerPath.includes(term.toLowerCase())) score += 8;
        }

        // Boost certain files based on query type
        if (intent.queryType === 'fix' && (fileName.includes('error') || fileName.includes('handler'))) {
            score += 5;
        }
        if (intent.queryType === 'test' && (fileName.includes('test') || fileName.includes('spec'))) {
            score += 10;
        }

        return score;
    }

    /**
     * Search within a file for relevant sections
     */
    public async searchInFile(filePath: string, intent: SearchIntent): Promise<CodeSection[]> {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(content);
            const lines = text.split('\n');

            const sections: CodeSection[] = [];
            let currentSection: CodeSection | null = null;
            let braceCount = 0;

            // Find sections containing keywords
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lowerLine = line.toLowerCase();

                // Check for function/class definitions
                const isDefinition = /^[\s]*(export\s+)?(async\s+)?(function|class|const|let|var|def|public|private)\s+\w+/.test(line);

                // Score this line
                let lineScore = 0;
                for (const kw of intent.keywords) {
                    if (lowerLine.includes(kw)) lineScore += 2;
                }
                for (const term of intent.codeTerms) {
                    if (line.includes(term)) lineScore += 5;
                }

                // Start new section on definition with score
                if (isDefinition && lineScore > 0) {
                    if (currentSection) {
                        currentSection.endLine = i - 1;
                        currentSection.content = lines.slice(currentSection.startLine, currentSection.endLine + 1).join('\n');
                        if (currentSection.content.length > 0) {
                            sections.push(currentSection);
                        }
                    }
                    currentSection = {
                        content: '',
                        startLine: i,
                        endLine: i,
                        matchScore: lineScore
                    };
                    braceCount = 0;
                }

                // Track braces to find section end
                if (currentSection) {
                    currentSection.matchScore += lineScore;
                    braceCount += (line.match(/\{/g) || []).length;
                    braceCount -= (line.match(/\}/g) || []).length;

                    if (braceCount <= 0 && line.includes('}')) {
                        currentSection.endLine = i;
                        currentSection.content = lines.slice(currentSection.startLine, i + 1).join('\n');
                        if (currentSection.content.length > 0 && currentSection.matchScore > 0) {
                            sections.push(currentSection);
                        }
                        currentSection = null;
                    }
                }
            }

            // Sort by score and limit
            sections.sort((a, b) => b.matchScore - a.matchScore);
            return sections.slice(0, 5);

        } catch (e) {
            console.error('SearchAgent: Error searching file', filePath, e);
            return [];
        }
    }

    /**
     * Full search pipeline: analyze query, find files, extract sections
     */
    public async search(query: string, activeFilePath?: string): Promise<string> {
        const intent = this.analyzeQuery(query);
        const files = await this.searchFiles(intent, activeFilePath);

        if (files.length === 0) {
            return ''; // No relevant files found
        }

        let contextResult = '\n\n--- SEARCH AGENT CONTEXT ---\n';
        contextResult += `Keywords: ${intent.keywords.slice(0, 5).join(', ')}\n`;
        contextResult += `Found ${files.length} relevant file(s)\n\n`;

        let totalSize = 0;
        const maxTotalSize = 25000;

        for (const file of files) {
            if (totalSize > maxTotalSize) {
                contextResult += '\n... (context limit reached)\n';
                break;
            }

            try {
                const uri = vscode.Uri.file(file.filePath);
                const content = await vscode.workspace.fs.readFile(uri);
                const text = new TextDecoder().decode(content);

                // For small files, include everything
                if (text.length < this.MAX_CONTENT_PER_FILE) {
                    contextResult += `### ${file.relativePath} (full file, score: ${file.relevanceScore})\n`;
                    contextResult += `\`\`\`${file.language}\n${text}\n\`\`\`\n\n`;
                    totalSize += text.length;
                } else {
                    // For large files, search for relevant sections
                    const sections = await this.searchInFile(file.filePath, intent);

                    if (sections.length > 0) {
                        contextResult += `### ${file.relativePath} (extracted, score: ${file.relevanceScore})\n`;

                        for (const section of sections) {
                            if (section.content.length + totalSize > maxTotalSize) break;
                            contextResult += `// Lines ${section.startLine + 1}-${section.endLine + 1} (match: ${section.matchScore})\n`;
                            contextResult += `\`\`\`${file.language}\n${section.content}\n\`\`\`\n`;
                            totalSize += section.content.length;
                        }
                        contextResult += '\n';
                    }
                }
            } catch (e) {
                console.error('SearchAgent: Error processing file', file.filePath, e);
            }
        }

        return contextResult;
    }
}
