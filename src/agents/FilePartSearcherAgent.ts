/**
 * FilePartSearcherAgent - Precision code locator for Byte Coder
 * Finds exact code regions using AST-like pattern matching
 */

import * as vscode from 'vscode';
import { BaseAgent, AgentOutput } from '../core/AgentTypes';

export interface FilePartSearchInput {
    filePath: string;
    fileContent?: string;
    searchFor: {
        elementType?: string;  // 'button', 'function', 'class', 'component', etc.
        text?: string;         // Text content to find
        name?: string;         // Function/class/variable name
        line?: number;         // Specific line number to analyze (1-based)
        props?: Record<string, any>;  // Component props to match
        eventHandler?: string; // Event handler name (onClick, onSubmit, etc.)
    };
    language?: string;
}

export interface FilePartMatch {
    file: string;
    startLine: number;
    endLine: number;
    element: string;
    content: string;
    props?: Record<string, any>;
    confidence: number;
    reason: string;
}

export class FilePartSearcherAgent extends BaseAgent<FilePartSearchInput, FilePartMatch[]> {
    // Element detection patterns
    private readonly ELEMENT_PATTERNS: Record<string, RegExp[]> = {
        'button': [
            /\<[Bb]utton[^>]*\>/g,
            /\<button[^>]*\>/gi,
            /Button\s*=|PrimaryButton|SecondaryButton/g
        ],
        'function': [
            /(?:async\s+)?function\s+(\w+)\s*\(/g,
            /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
            /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?function/g,
            /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g,  // method in object
            /(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g,    // method in class/object
            /def\s+(\w+)\s*\(/g, // Python
        ],
        'class': [
            /class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g,
            /interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/g,
            /class\s+(\w+)(?:\(\w+\))?\s*:/g, // Python
        ],
        'component': [
            /(?:const|let|var|function)\s+(\w+)\s*[=:]?\s*(?:\([^)]*\)|)\s*(?:=>)?\s*\{?\s*(?:return\s*)?\(/g,
            /<(\w+)(?:\s+[^>]*)?\s*(?:\/>|>)/g,  // JSX elements
        ],
        'import': [
            /import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"][^'"]+['"]/g,
            /(?:const|let|var)\s+\{?[^}]+\}?\s*=\s*require\s*\(['"][^'"]+['"]\)/g,
            /import\s+[\w\s,]+/g, // Python
            /from\s+[\w.]+\s+import\s+[\w\s,]+/g // Python
        ],
        'export': [
            /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)\s+(\w+)/g,
            /module\.exports\s*=/g,
        ],
        'hook': [
            /use[A-Z]\w+/g,  // React hooks pattern
        ],
        'eventHandler': [
            /on[A-Z]\w+\s*=\s*\{?\s*(?:\([^)]*\)\s*=>|[\w.]+)\}?/g,
        ]
    };

    constructor() {
        super({ name: 'FilePartSearcher', timeout: 10000 });
    }

    async execute(input: FilePartSearchInput): Promise<AgentOutput<FilePartMatch[]>> {
        const startTime = Date.now();

        try {
            let content = input.fileContent;

            // Read file if content not provided
            if (!content) {
                try {
                    const doc = await vscode.workspace.openTextDocument(input.filePath);
                    content = doc.getText();
                } catch {
                    return this.createOutput('failed', [], 0, startTime, {
                        error: { type: 'FileNotFound', message: `Could not read file: ${input.filePath}` }
                    });
                }
            }

            const lines = content.split('\n');
            const matches: FilePartMatch[] = [];

            // Search based on input criteria
            if (input.searchFor.line) {
                matches.push(...this.findByLine(lines, input.searchFor.line, input.filePath));
            }

            if (input.searchFor.name) {
                matches.push(...this.findByName(lines, input.searchFor.name, input.filePath));
            }

            if (input.searchFor.text) {
                matches.push(...this.findByText(lines, input.searchFor.text, input.filePath));
            }

            if (input.searchFor.elementType) {
                matches.push(...this.findByElementType(lines, input.searchFor.elementType, input.filePath));
            }

            if (input.searchFor.eventHandler) {
                matches.push(...this.findByEventHandler(lines, input.searchFor.eventHandler, input.filePath));
            }

            // Sort by confidence and deduplicate
            const uniqueMatches = this.deduplicateMatches(matches);
            uniqueMatches.sort((a, b) => b.confidence - a.confidence);

            const confidence = uniqueMatches.length > 0
                ? Math.min(0.95, uniqueMatches[0].confidence)
                : 0.2;

            return this.createOutput('success', uniqueMatches.slice(0, 10), confidence, startTime, {
                reasoning: `Found ${uniqueMatches.length} matches in ${input.filePath}`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Find code block at specific line
     */
    private findByLine(lines: string[], lineNumber: number, filePath: string): FilePartMatch[] {
        const matches: FilePartMatch[] = [];
        const index = lineNumber - 1;

        if (index < 0 || index >= lines.length) return matches;

        // Try to find if this line starts a block
        const blockEnd = this.findBlockEnd(lines, index, filePath);
        let startLine = index;
        
        // Include JSDoc if present
        startLine = this.findJSDocStart(lines, startLine);

        const content = lines.slice(startLine, blockEnd + 1).join('\n');
        
        matches.push({
            file: filePath,
            startLine: startLine + 1,
            endLine: blockEnd + 1,
            element: this.detectElementType(lines[index]),
            content: content.slice(0, 5000), // Increased limit for complex tasks
            confidence: 0.9,
            reason: `Block at line ${lineNumber}`
        });

        return matches;
    }

    /**
     * Find code blocks by function/class/variable name
     */
    private findByName(lines: string[], name: string, filePath: string): FilePartMatch[] {
        const matches: FilePartMatch[] = [];
        const lowerName = name.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lowerLine = line.toLowerCase();

            // Check for function/class/variable declarations
            if (lowerLine.includes(lowerName)) {
                // Determine if it's a declaration
                const isDeclaration = /(?:function|class|const|let|var|interface|type|export|def)\s/.test(line);
                const isExact = new RegExp(`\\b${this.escapeRegex(name)}\\b`).test(line);

                if (isDeclaration || isExact) {
                    const blockEnd = this.findBlockEnd(lines, i, filePath);
                    const startLine = this.findJSDocStart(lines, i);
                    const content = lines.slice(startLine, blockEnd + 1).join('\n');

                    matches.push({
                        file: filePath,
                        startLine: startLine + 1,
                        endLine: blockEnd + 1,
                        element: this.detectElementType(line),
                        content: content.slice(0, 5000),
                        confidence: isExact && isDeclaration ? 0.95 : isExact ? 0.85 : 0.7,
                        reason: isDeclaration ? `Declaration of ${name}` : `Reference to ${name}`
                    });
                }
            }
        }

        return matches;
    }

    /**
     * Find code blocks containing specific text
     */
    private findByText(lines: string[], text: string, filePath: string): FilePartMatch[] {
        const matches: FilePartMatch[] = [];
        const lowerText = text.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerText)) {
                // Get surrounding context
                const startLine = Math.max(0, i - 2);
                const endLine = Math.min(lines.length - 1, i + 5);
                const content = lines.slice(startLine, endLine + 1).join('\n');

                const isExact = lines[i].includes(text);

                matches.push({
                    file: filePath,
                    startLine: startLine + 1,
                    endLine: endLine + 1,
                    element: 'text_match',
                    content: content.slice(0, 500),
                    confidence: isExact ? 0.85 : 0.7,
                    reason: `Text match: "${text.slice(0, 30)}${text.length > 30 ? '...' : ''}"`
                });
            }
        }

        return matches;
    }

    /**
     * Find elements by type (button, function, class, etc.)
     */
    private findByElementType(lines: string[], elementType: string, filePath: string): FilePartMatch[] {
        const matches: FilePartMatch[] = [];
        const patterns = this.ELEMENT_PATTERNS[elementType.toLowerCase()] || [];

        const fullContent = lines.join('\n');

        for (const pattern of patterns) {
            const regex = new RegExp(pattern.source, pattern.flags);
            let match;

            while ((match = regex.exec(fullContent)) !== null) {
                const lineNumber = this.getLineNumber(fullContent, match.index);
                const blockEnd = this.findBlockEnd(lines, lineNumber);
                const content = lines.slice(lineNumber, blockEnd + 1).join('\n');

                const name = match[1] || match[0].slice(0, 30);

                matches.push({
                    file: filePath,
                    startLine: lineNumber + 1,
                    endLine: blockEnd + 1,
                    element: elementType,
                    content: content.slice(0, 500),
                    confidence: 0.8,
                    reason: `${elementType}: ${name}`
                });
            }
        }

        return matches;
    }

    /**
     * Find elements by event handler
     */
    private findByEventHandler(lines: string[], handler: string, filePath: string): FilePartMatch[] {
        const matches: FilePartMatch[] = [];
        const lowerHandler = handler.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();

            if (line.includes(lowerHandler) && line.includes('=')) {
                // Check if it's an event handler assignment
                const isEventHandler = /on\w+\s*=/.test(lines[i]);

                if (isEventHandler) {
                    // Find the containing component/element
                    const componentStart = this.findComponentStart(lines, i);
                    const componentEnd = this.findBlockEnd(lines, componentStart, filePath);
                    const content = lines.slice(componentStart, componentEnd + 1).join('\n');

                    matches.push({
                        file: filePath,
                        startLine: componentStart + 1,
                        endLine: componentEnd + 1,
                        element: 'event_handler',
                        content: content.slice(0, 5000),
                        props: { handler },
                        confidence: 0.85,
                        reason: `Event handler: ${handler}`
                    });
                }
            }
        }

        return matches;
    }

    /**
     * Find the end of a code block using state machine to ignore strings/comments
     */
    private findBlockEnd(lines: string[], startLine: number, filePath: string = ''): number {
        const isPython = filePath.endsWith('.py');
        
        if (isPython) {
            return this.findBlockEndPython(lines, startLine);
        }

        let braceCount = 0;
        let parenCount = 0;
        let started = false;
        let inString: string | null = null; // ', ", `
        let inComment = false; // block comment
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                const nextChar = line[j + 1];
                
                // Handle escaping in strings
                if (inString && char === '\\') {
                    j++; // skip next char
                    continue;
                }

                // Handle state transitions
                if (inComment) {
                    if (char === '*' && nextChar === '/') {
                        inComment = false;
                        j++;
                    }
                    continue;
                }
                
                if (inString) {
                    if (char === inString) {
                        inString = null;
                    }
                    continue;
                }
                
                // Check for comment start
                if (char === '/' && nextChar === '/') {
                    break; // Rest of line is comment
                }
                if (char === '/' && nextChar === '*') {
                    inComment = true;
                    j++;
                    continue;
                }
                
                // Check for string start
                if (char === '"' || char === "'" || char === '`') {
                    inString = char;
                    continue;
                }
                
                // Check for braces/parens
                if (char === '{' || char === '(') {
                    if (char === '{') braceCount++;
                    if (char === '(') parenCount++;
                    started = true;
                } else if (char === '}' || char === ')') {
                    if (char === '}') braceCount--;
                    if (char === ')') parenCount--;
                }
                
                // Check for semicolon (statement end)
                if (char === ';' && braceCount === 0 && parenCount === 0 && !inString && !inComment) {
                    return i;
                }
            }

            // Check if block ended
            // We check !inString and !inComment because a block shouldn't end inside them
            if (started && braceCount === 0 && parenCount === 0 && !inString && !inComment) {
                return i;
            }

            // Safety break - increased for large functions/classes
            if (i - startLine > 5000) {
                return i;
            }
        }

        return Math.min(startLine + 50, lines.length - 1);
    }

    /**
     * Find end of block for indentation-based languages (Python)
     * Enhanced to handle multi-line expressions (parentheses/brackets)
     */
    private findBlockEndPython(lines: string[], startLine: number): number {
        if (startLine >= lines.length) return startLine;

        // Get base indentation of the start line
        const startLineContent = lines[startLine];
        const baseIndentMatch = startLineContent.match(/^(\s*)/);
        const baseIndent = baseIndentMatch ? baseIndentMatch[1].length : 0;
        
        let lastValidLine = startLine;
        let openParens = 0; // Tracks ( [ {
        let inString: string | null = null; // Tracks string state across lines for multi-line strings
        
        // Helper to process a single line and update state
        const processLine = (line: string) => {
            let escape = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (escape) {
                    escape = false;
                    continue;
                }
                
                if (char === '\\') {
                    escape = true;
                    continue;
                }
                
                // Handle strings
                if (inString) {
                    if (char === inString[0]) {
                        if (inString.length === 1) {
                            inString = null;
                        } else if (inString.length === 3) {
                            if (i + 2 < line.length && line[i+1] === char && line[i+2] === char) {
                                inString = null;
                                i += 2;
                            }
                        }
                    }
                    continue;
                }
                
                // Start string
                if (char === '"' || char === "'") {
                    // Check for triple quotes
                    if (i + 2 < line.length && line[i+1] === char && line[i+2] === char) {
                        inString = char + char + char;
                        i += 2;
                    } else {
                        inString = char;
                    }
                    continue;
                }
                
                // Comments (only if not in string)
                if (char === '#') {
                    break; // Ignore rest of line
                }
                
                // Parens
                if (char === '(' || char === '[' || char === '{') openParens++;
                if (char === ')' || char === ']' || char === '}') openParens--;
            }
        };

        // Process start line first
        processLine(startLineContent);

        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines (they don't break the block)
            if (trimmed === '') {
                continue;
            }

            // Check indentation BEFORE processing the line content
            // But only if we are NOT inside a multi-line string or open parens
            const currentIndentMatch = line.match(/^(\s*)/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[1].length : 0;

            if (openParens === 0 && inString === null) {
                // Check if this line starts with a comment (comments at same indent or deeper are fine)
                // But comments at lower indent might indicate end of block? 
                // In Python, comments can be anywhere. But usually we treat them as part of block if they follow it.
                // Let's assume comment lines are part of the block unless we hit a code line with lower indent.
                if (trimmed.startsWith('#')) {
                    // It's a comment line, we consume it but check next lines
                    // If it's a comment, we don't check indent strictly, or we treat it as valid.
                    // Actually, let's process it to be safe (it might have side effects? no, comments are ignored)
                    processLine(line);
                    continue;
                }

                if (currentIndent <= baseIndent) {
                     // Check for specific keywords that extend blocks (elif, else, except, finally)
                    const keywords = ['elif', 'else', 'except', 'finally'];
                    const firstWord = trimmed.split(' ')[0].replace(':', '');
                    
                    if (keywords.includes(firstWord)) {
                        // This is a continuation
                        processLine(line);
                        lastValidLine = i;
                        continue;
                    }

                    // Otherwise, the block has ended
                    return this.findLastContentLine(lines, startLine, i - 1);
                }
            }

            // Process the line content to update parens/string state
            processLine(line);
            
            // If the line had content (even if just inside a string/paren), it's part of the block
            lastValidLine = i;
            
            // Safety break
            if (i - startLine > 5000) {
                return i;
            }
        }

        return lastValidLine;
    }

    /**
     * Find the last line that has actual content in a range
     */
    private findLastContentLine(lines: string[], start: number, end: number): number {
        for (let i = end; i >= start; i--) {
            const line = lines[i].trim();
            if (line !== '' && !line.startsWith('#')) {
                return i;
            }
        }
        return start;
    }

    /**
     * Find the start of JSDoc comments preceding a declaration
     */
    private findJSDocStart(lines: string[], declarationLine: number): number {
        let start = declarationLine;
        
        // Scan backwards for comments or empty lines
        for (let i = declarationLine - 1; i >= 0; i--) {
            const line = lines[i].trim();
            
            // Stop if we hit a non-comment code line
            // We accept //, /*, *, */ and empty lines if they are part of the block
            if (line.startsWith('//') || 
                line.startsWith('/*') || 
                line.startsWith('*') || 
                line.endsWith('*/') || 
                line === '') {
                
                // Only move start up if it's not empty, OR if we have seen comments above it
                // Actually, standard JSDoc is usually adjacent.
                // If there is a blank line between JSDoc and function, it's sometimes considered detached,
                // but usually we want to include it.
                if (line !== '') {
                    start = i;
                }
            } else {
                break;
            }
        }
        
        return start;
    }

    /**
     * Find the start of a containing component
     */
    private findComponentStart(lines: string[], currentLine: number): number {
        for (let i = currentLine; i >= 0; i--) {
            const line = lines[i];
            // Look for JSX opening tag or component definition
            if (/<\w+/.test(line) || /(?:function|const|class|def)\s+\w+/.test(line)) {
                return i;
            }
        }
        return Math.max(0, currentLine - 5);
    }

    /**
     * Get line number from character index
     */
    private getLineNumber(content: string, charIndex: number): number {
        const beforeMatch = content.slice(0, charIndex);
        return (beforeMatch.match(/\n/g) || []).length;
    }

    /**
     * Detect element type from a line of code
     */
    private detectElementType(line: string): string {
        if (/\bfunction\b|\bdef\b/.test(line)) return 'function';
        if (/\bclass\b/.test(line)) return 'class';
        if (/\binterface\b/.test(line)) return 'interface';
        if (/\bconst\b.*=.*=>/.test(line)) return 'arrow_function';
        if (/\bconst\b|\blet\b|\bvar\b/.test(line)) return 'variable';
        if (/<\w+/.test(line)) return 'jsx_element';
        if (/^import\b|from\b.*import\b/.test(line.trim())) return 'import';
        return 'unknown';
    }

    /**
     * Remove duplicate matches
     */
    private deduplicateMatches(matches: FilePartMatch[]): FilePartMatch[] {
        const seen = new Set<string>();
        return matches.filter(match => {
            const key = `${match.file}:${match.startLine}-${match.endLine}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
