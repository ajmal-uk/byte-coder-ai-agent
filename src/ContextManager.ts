/**
 * ContextManager - Smart context management for Byte AI Coder
 * Handles context caching, memory, and intelligent extraction for large files
 */

interface ContextItem {
    path: string;
    content: string;
    language: string;
    timestamp: number;
    fullSize: number;
    extracted: boolean;
}

interface ExtractedSection {
    name: string;
    content: string;
    startLine: number;
    endLine: number;
}

export class ContextManager {
    private contextCache: Map<string, ContextItem> = new Map();
    private conversationContext: string[] = [];
    private readonly MAX_CONTEXT_SIZE = 50000;  // Total context limit
    private readonly MAX_FILE_SIZE = 8000;      // Per-file limit for extraction
    private readonly EXTRACTION_THRESHOLD = 5000; // Files larger trigger extraction

    /**
     * Add a file to the context cache
     */
    public addFile(path: string, content: string, language: string): ContextItem {
        const item: ContextItem = {
            path,
            content: content.length > this.EXTRACTION_THRESHOLD
                ? this.extractSmartContent(content, language, '')
                : content,
            language,
            timestamp: Date.now(),
            fullSize: content.length,
            extracted: content.length > this.EXTRACTION_THRESHOLD
        };

        this.contextCache.set(path, item);
        this.pruneCache();
        return item;
    }

    /**
     * Get file from cache or return null
     */
    public getFile(path: string): ContextItem | null {
        return this.contextCache.get(path) || null;
    }

    /**
     * Add file with query-aware extraction
     */
    public addFileWithQuery(path: string, content: string, language: string, query: string): ContextItem {
        const item: ContextItem = {
            path,
            content: content.length > this.EXTRACTION_THRESHOLD
                ? this.extractSmartContent(content, language, query)
                : content,
            language,
            timestamp: Date.now(),
            fullSize: content.length,
            extracted: content.length > this.EXTRACTION_THRESHOLD
        };

        this.contextCache.set(path, item);
        return item;
    }

    /**
     * Extract relevant content from large files
     */
    private extractSmartContent(content: string, language: string, query: string): string {
        const lines = content.split('\n');
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

        // Always include imports/requires (first 50 lines max)
        const imports = this.extractImports(lines, language);

        // Extract functions, classes, and methods
        const sections = this.extractCodeSections(lines, language);

        // Score sections by relevance to query
        const scoredSections = sections.map(section => ({
            ...section,
            score: this.scoreRelevance(section.name, section.content, queryTerms)
        })).sort((a, b) => b.score - a.score);

        // Build result within size limit
        let result = '';
        let currentSize = 0;
        const maxSize = this.MAX_FILE_SIZE;

        // Add imports first
        if (imports.length > 0) {
            const importBlock = `// === IMPORTS ===\n${imports.join('\n')}\n\n`;
            result += importBlock;
            currentSize += importBlock.length;
        }

        // Add most relevant sections
        for (const section of scoredSections) {
            const sectionText = `// === ${section.name} (lines ${section.startLine}-${section.endLine}) ===\n${section.content}\n\n`;
            if (currentSize + sectionText.length > maxSize) {
                // Add truncation notice
                result += `\n// ... (${scoredSections.length - scoredSections.indexOf(section)} more sections not shown)\n`;
                break;
            }
            result += sectionText;
            currentSize += sectionText.length;
        }

        return result || content.substring(0, maxSize) + '\n// ... (truncated)';
    }

    /**
     * Extract import/require statements
     */
    private extractImports(lines: string[], language: string): string[] {
        const imports: string[] = [];
        const importPatterns: { [key: string]: RegExp[] } = {
            'typescript': [/^import\s+/, /^export\s+\{/, /^export\s+\*/],
            'javascript': [/^import\s+/, /^const\s+\w+\s*=\s*require/, /^export\s+/],
            'python': [/^import\s+/, /^from\s+\w+\s+import/],
            'java': [/^import\s+/, /^package\s+/],
        };

        const patterns = importPatterns[language] || importPatterns['javascript'];

        for (let i = 0; i < Math.min(lines.length, 50); i++) {
            const line = lines[i].trim();
            if (patterns.some(p => p.test(line))) {
                imports.push(lines[i]);
            }
        }

        return imports;
    }

    /**
     * Extract code sections (functions, classes, methods)
     */
    private extractCodeSections(lines: string[], language: string): ExtractedSection[] {
        const sections: ExtractedSection[] = [];

        // Language-specific patterns
        const patterns: { [key: string]: { start: RegExp, getName: (match: RegExpMatchArray) => string }[] } = {
            'typescript': [
                { start: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, getName: m => m[1] },
                { start: /^(?:export\s+)?class\s+(\w+)/, getName: m => `class ${m[1]}` },
                { start: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/, getName: m => m[1] },
                { start: /^\s+(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/, getName: m => `method ${m[1]}` },
            ],
            'javascript': [
                { start: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, getName: m => m[1] },
                { start: /^(?:export\s+)?class\s+(\w+)/, getName: m => `class ${m[1]}` },
                { start: /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/, getName: m => m[1] },
            ],
            'python': [
                { start: /^def\s+(\w+)\s*\(/, getName: m => `def ${m[1]}` },
                { start: /^class\s+(\w+)/, getName: m => `class ${m[1]}` },
                { start: /^\s{4}def\s+(\w+)\s*\(/, getName: m => `method ${m[1]}` },
            ],
            'java': [
                { start: /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:\w+)\s+(\w+)\s*\(/, getName: m => `method ${m[1]}` },
                { start: /^\s*(?:public|private|protected)?\s*class\s+(\w+)/, getName: m => `class ${m[1]}` },
            ],
        };

        const langPatterns = patterns[language] || patterns['javascript'];
        let currentSection: ExtractedSection | null = null;
        let braceCount = 0;
        let indentLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for new section start
            for (const pattern of langPatterns) {
                const match = line.match(pattern.start);
                if (match) {
                    // Save previous section
                    if (currentSection) {
                        currentSection.endLine = i;
                        currentSection.content = lines.slice(currentSection.startLine, i).join('\n');
                        if (currentSection.content.trim().length > 0) {
                            sections.push(currentSection);
                        }
                    }

                    currentSection = {
                        name: pattern.getName(match),
                        content: '',
                        startLine: i,
                        endLine: i
                    };
                    braceCount = 0;
                    indentLevel = line.search(/\S/);
                    break;
                }
            }

            // Track braces for section end detection
            if (currentSection) {
                braceCount += (line.match(/\{/g) || []).length;
                braceCount -= (line.match(/\}/g) || []).length;

                // Section ends when braces balance or dedent (for Python)
                if (language === 'python') {
                    const currentIndent = line.search(/\S/);
                    if (currentIndent >= 0 && currentIndent < indentLevel && line.trim().length > 0) {
                        currentSection.endLine = i;
                        currentSection.content = lines.slice(currentSection.startLine, i).join('\n');
                        if (currentSection.content.trim().length > 0) {
                            sections.push(currentSection);
                        }
                        currentSection = null;
                    }
                } else if (braceCount <= 0 && line.includes('}')) {
                    currentSection.endLine = i + 1;
                    currentSection.content = lines.slice(currentSection.startLine, i + 1).join('\n');
                    if (currentSection.content.trim().length > 0) {
                        sections.push(currentSection);
                    }
                    currentSection = null;
                }
            }
        }

        // Add last section if exists
        if (currentSection) {
            currentSection.endLine = lines.length;
            currentSection.content = lines.slice(currentSection.startLine).join('\n');
            if (currentSection.content.trim().length > 0) {
                sections.push(currentSection);
            }
        }

        return sections;
    }

    /**
     * Score relevance of a section to query terms
     */
    private scoreRelevance(name: string, content: string, queryTerms: string[]): number {
        if (queryTerms.length === 0) return 1; // No query, all sections equal

        let score = 0;
        const lowerName = name.toLowerCase();
        const lowerContent = content.toLowerCase();

        for (const term of queryTerms) {
            // Name match is worth more
            if (lowerName.includes(term)) score += 10;
            // Content match
            const contentMatches = (lowerContent.match(new RegExp(term, 'g')) || []).length;
            score += Math.min(contentMatches, 5); // Cap at 5 matches
        }

        return score;
    }

    /**
     * Prune cache to stay within memory limits
     */
    private pruneCache(): void {
        const entries = Array.from(this.contextCache.entries());
        let totalSize = entries.reduce((sum, [_, item]) => sum + item.content.length, 0);

        // Remove oldest entries until under limit
        while (totalSize > this.MAX_CONTEXT_SIZE && entries.length > 0) {
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            const oldest = entries.shift();
            if (oldest) {
                this.contextCache.delete(oldest[0]);
                totalSize -= oldest[1].content.length;
            }
        }
    }

    /**
     * Get all cached context as formatted string
     */
    public getFullContext(): string {
        const items = Array.from(this.contextCache.values())
            .sort((a, b) => b.timestamp - a.timestamp);

        return items.map(item => {
            const extracted = item.extracted ? ' (extracted)' : '';
            return `### ${item.path}${extracted}\n\`\`\`${item.language}\n${item.content}\n\`\`\``;
        }).join('\n\n');
    }

    /**
     * Add a conversation turn to memory
     */
    public addConversationTurn(role: 'user' | 'assistant', content: string): void {
        const summary = content.length > 500
            ? content.substring(0, 500) + '...'
            : content;
        this.conversationContext.push(`${role}: ${summary}`);

        // Keep last 10 turns
        if (this.conversationContext.length > 10) {
            this.conversationContext.shift();
        }
    }

    /**
     * Get conversation context summary
     */
    public getConversationSummary(): string {
        if (this.conversationContext.length === 0) return '';
        return '### Previous Context\n' + this.conversationContext.slice(-5).join('\n');
    }

    /**
     * Clear all context
     */
    public clear(): void {
        this.contextCache.clear();
        this.conversationContext = [];
    }

    /**
     * Get cache stats
     */
    public getStats(): { files: number, totalSize: number, conversationTurns: number } {
        const entries = Array.from(this.contextCache.values());
        return {
            files: entries.length,
            totalSize: entries.reduce((sum, item) => sum + item.content.length, 0),
            conversationTurns: this.conversationContext.length
        };
    }
}
