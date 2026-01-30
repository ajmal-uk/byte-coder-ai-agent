/**
 * CodeModifierAgent - Surgical code editor for Byte Coder
 * Applies precise line-level diffs with validation
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseAgent, AgentOutput, CodeModification, Checkpoint } from '../core/AgentTypes';

const execAsync = promisify(exec);

export interface CodeModifierInput {
    modifications: CodeModification[];
    dryRun?: boolean;
    createCheckpoint?: boolean;
    ignoreSyntaxErrors?: boolean;
}

export interface ModificationResult {
    file: string;
    success: boolean;
    linesModified: number;
    error?: string;
    diff?: string;
}

export interface CodeModifierResult {
    results: ModificationResult[];
    checkpoint?: Checkpoint;
    rollbackAvailable: boolean;
    totalFilesModified: number;
    totalLinesModified: number;
}

export class CodeModifierAgent extends BaseAgent<CodeModifierInput, CodeModifierResult> {
    // Store original content for rollback
    private originalContents: Map<string, string> = new Map();

    constructor() {
        super({ name: 'CodeModifier', timeout: 30000 });
    }

    async execute(input: CodeModifierInput): Promise<AgentOutput<CodeModifierResult>> {
        const startTime = Date.now();

        try {
            const results: ModificationResult[] = [];
            let checkpoint: Checkpoint | undefined;

            // Create checkpoint if requested
            if (input.createCheckpoint && !input.dryRun) {
                checkpoint = await this.createCheckpoint(input.modifications);
            }

            // Apply modifications
            for (const mod of input.modifications) {
                const result = await this.applyModification(mod, input.dryRun, input.ignoreSyntaxErrors);
                results.push(result);
            }

            const successCount = results.filter(r => r.success).length;
            const totalLines = results.reduce((sum, r) => sum + r.linesModified, 0);

            const result: CodeModifierResult = {
                results,
                checkpoint,
                rollbackAvailable: !!checkpoint,
                totalFilesModified: successCount,
                totalLinesModified: totalLines
            };

            const confidence = successCount / input.modifications.length;
            const successResults = results.filter(r => r.success);
            const keyFiles = successResults.slice(0, 3).map(r => `\`${r.file}\``).join(', ');
            const remaining = Math.max(0, successResults.length - 3);
            const fileSummary = remaining > 0 ? `${keyFiles} (+${remaining} more)` : keyFiles;

            return this.createOutput('success', result, confidence, startTime, {
                reasoning: `Modified ${successCount}/${input.modifications.length} files: ${fileSummary}. (${totalLines} lines changed)`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Apply a single modification
     */
    private async applyModification(
        mod: CodeModification,
        dryRun: boolean = false,
        ignoreSyntaxErrors: boolean = false
    ): Promise<ModificationResult> {
        try {
            // Read the file
            const uri = vscode.Uri.file(mod.filePath);
            let document: vscode.TextDocument;

            try {
                document = await vscode.workspace.openTextDocument(uri);
            } catch {
                return {
                    file: mod.filePath,
                    success: false,
                    linesModified: 0,
                    error: `File not found: ${mod.filePath}`
                };
            }

            const currentContent = document.getText();
            const lines = currentContent.split('\n');

            // Store original for rollback
            if (!dryRun && !this.originalContents.has(mod.filePath)) {
                this.originalContents.set(mod.filePath, currentContent);
            }

            // Find the target block
            const searchBlock = mod.searchBlock?.trim();
            let startLine = mod.startLine - 1; // Convert to 0-indexed
            let endLine = mod.endLine - 1;
            
            // If lines are not provided or invalid, default to whole file if searchBlock exists
            if ((isNaN(startLine) || isNaN(endLine) || startLine < 0 || endLine < 0) && searchBlock) {
                 startLine = 0;
                 endLine = lines.length - 1;
            } else if (isNaN(startLine) || isNaN(endLine)) {
                 // Fallback if no lines and no search block
                 return {
                    file: mod.filePath,
                    success: false,
                    linesModified: 0,
                    error: `Invalid modification parameters: missing line numbers and search block`
                 };
            }

            // Validate line range
            if (startLine < 0 || endLine >= lines.length) {
                // If out of bounds but we have a search block, try searching whole file
                if (searchBlock) {
                    startLine = 0;
                    endLine = lines.length - 1;
                } else {
                    return {
                        file: mod.filePath,
                        success: false,
                        linesModified: 0,
                        error: `Invalid line range: ${mod.startLine}-${mod.endLine} (file has ${lines.length} lines)`
                    };
                }
            }

            // Get the target section
            let targetSection = lines.slice(startLine, endLine + 1).join('\n');

            // Verify and Find Target
            let useFuzzy = false;
            let fuzzyMatchResult: { start: number, end: number } | null = null;
            
            // Default action is replace if not specified
            const action = mod.action || 'replace';

            if (searchBlock) {
                // 1. Exact Match
                if (targetSection.includes(searchBlock)) {
                    // All good, logic continues below
                } else {
                    // 2. Scope Expansion (if allowed)
                    if (mod.startLine > 0 || mod.endLine < lines.length) {
                        const fullContent = lines.join('\n');
                        if (fullContent.includes(searchBlock)) {
                            targetSection = fullContent;
                            startLine = 0;
                            endLine = lines.length - 1;
                        } else {
                            // Try fuzzy in full content
                            const fullLines = lines;
                            fuzzyMatchResult = this.findFuzzyMatch(fullLines, searchBlock) || 
                                             this.findTokenMatch(fullContent, searchBlock);
                            
                            if (fuzzyMatchResult) {
                                targetSection = fullContent;
                                startLine = 0;
                                endLine = lines.length - 1;
                                useFuzzy = true;
                            } else {
                                return {
                                    file: mod.filePath,
                                    success: false,
                                    linesModified: 0,
                                    error: `Search block not found in file (tried exact and fuzzy)`
                                };
                            }
                        }
                    } else {
                        // 3. Fuzzy Match in restricted scope
                        fuzzyMatchResult = this.findFuzzyMatch(targetSection.split('\n'), searchBlock) || 
                                         this.findTokenMatch(targetSection, searchBlock);
                        
                        if (fuzzyMatchResult) {
                            useFuzzy = true;
                        } else {
                            return {
                                file: mod.filePath,
                                success: false,
                                linesModified: 0,
                                error: `Search block not found in target section`
                            };
                        }
                    }
                }
            }
            
            // Apply the modification based on action
            let newContent;
            
            // Helper to get split parts
            const getParts = () => {
                if (searchBlock) {
                    if (!useFuzzy && targetSection.includes(searchBlock)) {
                        const idx = targetSection.indexOf(searchBlock);
                        return {
                            before: targetSection.substring(0, idx),
                            match: searchBlock,
                            after: targetSection.substring(idx + searchBlock.length),
                            indent: this.getIndentation(searchBlock.split('\n')[0]) // Approximate
                        };
                    } else if (useFuzzy && fuzzyMatchResult) {
                        const targetLines = targetSection.split('\n');
                        const beforeLines = targetLines.slice(0, fuzzyMatchResult.start);
                        const matchLines = targetLines.slice(fuzzyMatchResult.start, fuzzyMatchResult.end + 1);
                        const afterLines = targetLines.slice(fuzzyMatchResult.end + 1);
                        
                        return {
                            before: beforeLines.join('\n') + (beforeLines.length > 0 ? '\n' : ''),
                            match: matchLines.join('\n'),
                            after: (afterLines.length > 0 ? '\n' : '') + afterLines.join('\n'),
                            indent: this.getIndentation(targetLines[fuzzyMatchResult.start])
                        };
                    }
                }
                // Fallback for no search block (line replacement)
                return null;
            };

            const parts = getParts();

            if (parts) {
                // We found the block
                const adjustedReplace = this.adjustIndentation(mod.replaceBlock, parts.indent);
                
                switch (action) {
                    case 'insert_before':
                        newContent = parts.before + adjustedReplace + '\n' + parts.match + parts.after;
                        break;
                    case 'insert_after':
                        newContent = parts.before + parts.match + '\n' + adjustedReplace + parts.after;
                        break;
                    case 'delete':
                        newContent = parts.before + parts.after;
                        break;
                    case 'replace':
                    default:
                        newContent = parts.before + adjustedReplace + parts.after;
                        break;
                }
            } else {
                 // Direct line replacement (only supports replace/delete effectively)
                 if (action === 'delete') {
                     newContent = ''; // Or remove lines? This replaces range with empty string
                 } else {
                     newContent = mod.replaceBlock;
                 }
            }
            
            let replacementLines: string[];
            if (newContent === '') {
                // Treat empty string as deletion (0 lines)
                replacementLines = [];
            } else {
                replacementLines = newContent.split('\n');
            }
            
            const newLines = [
                ...lines.slice(0, startLine),
                ...replacementLines,
                ...lines.slice(endLine + 1)
            ];
            
            // Generate diff for display
            const diff = this.generateDiff(mod.filePath, searchBlock, mod.replaceBlock);

            if (dryRun) {
                return {
                    file: mod.filePath,
                    success: true,
                    linesModified: Math.abs(mod.replaceBlock.split('\n').length - searchBlock.split('\n').length) + 1,
                    diff
                };
            }

            // Apply the edit
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                uri,
                new vscode.Range(
                    new vscode.Position(startLine, 0),
                    new vscode.Position(endLine, lines[endLine]?.length || 0)
                ),
                newContent
            );

            const applied = await vscode.workspace.applyEdit(edit);

            if (!applied) {
                return {
                    file: mod.filePath,
                    success: false,
                    linesModified: 0,
                    error: 'Failed to apply edit'
                };
            }

            // Save the document
            await document.save();

            // Verify Syntax (Self-Correction)
            if (!ignoreSyntaxErrors) {
                const syntaxError = await this.validateSyntax(mod.filePath);
                if (syntaxError) {
                    // Revert changes
                    const revertEdit = new vscode.WorkspaceEdit();
                    revertEdit.replace(
                        uri,
                        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lines.length + 100, 0)),
                        currentContent
                    );
                    await vscode.workspace.applyEdit(revertEdit);
                    await document.save();

                    return {
                        file: mod.filePath,
                        success: false,
                        linesModified: 0,
                        error: `Syntax Error detected: ${syntaxError.split('\n')[0]}. Reverted changes.`
                    };
                }
            }

            return {
                file: mod.filePath,
                success: true,
                linesModified: Math.abs(newContent.split('\n').length - (endLine - startLine + 1)) + 1,
                diff
            };

        } catch (error) {
            return {
                file: mod.filePath,
                success: false,
                linesModified: 0,
                error: `Error applying modification: ${(error as Error).message}`
            };
        }
    }

    /**
     * Validate syntax of the modified file
     */
    private async validateSyntax(filePath: string): Promise<string | null> {
        try {
            if (filePath.endsWith('.js')) {
                await execAsync(`node --check "${filePath}"`);
            } else if (filePath.endsWith('.py')) {
                await execAsync(`python3 -m py_compile "${filePath}"`);
            }
            // Add more languages as needed
            return null;
        } catch (error: any) {
            return error.stderr || error.message || "Syntax check failed";
        }
    }

    /**
     * Create a checkpoint before modifications
     */
    private async createCheckpoint(modifications: CodeModification[]): Promise<Checkpoint> {
        const modifiedFiles = [...new Set((modifications || []).map(m => m.filePath))];
        const checkpointId = `cp_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;

        // Store original contents
        for (const filePath of modifiedFiles) {
            try {
                const uri = vscode.Uri.file(filePath);
                const document = await vscode.workspace.openTextDocument(uri);
                this.originalContents.set(filePath, document.getText());
            } catch {
                // File doesn't exist yet, that's okay
            }
        }

        return {
            checkpointId,
            timestamp: new Date(),
            modifiedFiles,
            diffHash: this.generateHash(modifiedFiles.join(',')),
            rollbackCommand: `bytecoder rollback ${checkpointId}`,
            description: `Checkpoint before modifying ${modifiedFiles.length} files`
        };
    }

    /**
     * Rollback to a checkpoint
     */
    async rollback(checkpointId?: string): Promise<boolean> {
        try {
            for (const [filePath, content] of this.originalContents) {
                const uri = vscode.Uri.file(filePath);

                try {
                    // Create full file replace edit
                    const document = await vscode.workspace.openTextDocument(uri);
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        uri,
                        new vscode.Range(
                            new vscode.Position(0, 0),
                            new vscode.Position(document.lineCount, 0)
                        ),
                        content
                    );

                    const applied = await vscode.workspace.applyEdit(edit);
                    if (applied) {
                        await document.save();
                    }
                } catch {
                    // File was created, delete it
                    try {
                        await vscode.workspace.fs.delete(uri);
                    } catch { }
                }
            }

            this.originalContents.clear();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Fuzzy find a block in content lines and return range indices
     * Uses similarity metric to allow for minor differences (quotes, spacing, typos)
     */
    private findFuzzyMatch(lines: string[], searchBlock: string): { start: number, end: number } | null {
        const searchLines = searchBlock.split('\n').map(l => l.trim()).filter(l => l !== '');
        if (searchLines.length === 0) return null;

        for (let i = 0; i < lines.length; i++) {
            // Check if first line matches with similarity threshold
            if (this.calculateSimilarity(lines[i].trim(), searchLines[0]) >= 0.75) {
                let currentLine = i;
                let searchIdx = 0;
                let match = true;
                let matchedLines = 0;

                // Check subsequent lines
                while (searchIdx < searchLines.length) {
                    if (currentLine >= lines.length) {
                        match = false;
                        break;
                    }

                    const lineContent = lines[currentLine].trim();
                    // Skip empty lines in content
                    if (lineContent === '') {
                        currentLine++;
                        continue;
                    }

                    if (this.calculateSimilarity(lineContent, searchLines[searchIdx]) < 0.75) {
                        match = false;
                        break;
                    }

                    currentLine++;
                    searchIdx++;
                    matchedLines++;
                }

                if (match && matchedLines === searchLines.length) {
                    return { start: i, end: currentLine - 1 };
                }
            }
        }
        return null;
    }

    /**
     * Calculate string similarity (0.0 to 1.0) using Dice Coefficient
     * Good for catching quote differences, minor typos, spacing
     */
    private calculateSimilarity(s1: string, s2: string): number {
        // Normalize quotes and remove whitespace
        const str1 = s1.replace(/['"]/g, '"').replace(/\s+/g, '').toLowerCase();
        const str2 = s2.replace(/['"]/g, '"').replace(/\s+/g, '').toLowerCase();

        if (str1 === str2) return 1.0;
        if (str1.length < 2 || str2.length < 2) return 0.0;

        const bigrams1 = new Map<string, number>();
        for (let i = 0; i < str1.length - 1; i++) {
            const bigram = str1.substring(i, i + 2);
            bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
        }

        let intersection = 0;
        for (let i = 0; i < str2.length - 1; i++) {
            const bigram = str2.substring(i, i + 2);
            if (bigrams1.has(bigram) && bigrams1.get(bigram)! > 0) {
                intersection++;
                bigrams1.set(bigram, bigrams1.get(bigram)! - 1);
            }
        }

        return (2.0 * intersection) / (str1.length - 1 + str2.length - 1);
    }

    /**
     * Token-based fuzzy match that ignores whitespace differences
     */
    private findTokenMatch(content: string, searchBlock: string): { start: number, end: number } | null {
        // Normalize: collapse whitespace to single space
        const normalize = (str: string) => {
            let normalized = "";
            const map: number[] = []; // normalized index -> original index
            
            let lastWasSpace = false;
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                if (/\s/.test(char)) {
                    if (!lastWasSpace) {
                        normalized += " ";
                        map.push(i);
                        lastWasSpace = true;
                    }
                    // Skip subsequent spaces
                } else {
                    normalized += char;
                    map.push(i);
                    lastWasSpace = false;
                }
            }
            return { str: normalized.trim(), map };
        };

        const normContent = normalize(content);
        const normSearch = normalize(searchBlock);

        const idx = normContent.str.indexOf(normSearch.str);
        
        if (idx !== -1) {
            // Map back to original indices
            const startOriginalIdx = normContent.map[idx];
            // We need the end index. 
            // The length of match in normalized string corresponds to some length in original.
            // But map only stores indices for retained chars.
            // The end of match in normalized is idx + normSearch.str.length - 1
            const endNormIdx = idx + normSearch.str.length - 1;
            
            if (endNormIdx >= normContent.map.length) return null; // Should not happen
            
            const endOriginalIdx = normContent.map[endNormIdx];
            
            // Expand endOriginalIdx to include any trailing whitespace in original if needed?
            // Usually we just want the line number.
            
            const getLine = (charIdx: number) => {
                const sub = content.substring(0, charIdx);
                return (sub.match(/\n/g) || []).length;
            };
            
            return {
                start: getLine(startOriginalIdx),
                end: getLine(endOriginalIdx)
            };
        }
        
        return null;
    }

    /**
     * Get indentation of a line
     */
    private getIndentation(line: string): string {
        const match = line.match(/^[\s\t]*/);
        return match ? match[0] : '';
    }

    /**
     * Adjust indentation of a block to match reference
     */
    private adjustIndentation(block: string, indent: string): string {
        const lines = block.split('\n');
        if (lines.length === 0) return block;
        
        // Detect base indentation of the block (ignoring first line if it's often 0-indented in templates)
        // Actually, usually we just want to prepend 'indent' to every line?
        // But if block already has indentation, we might double it.
        // Strategy: Strip common indentation, then apply new indent.
        
        // 1. Find common indent
        const commonIndent = lines
            .filter(l => l.trim().length > 0)
            .reduce((min, line) => {
                const cur = this.getIndentation(line);
                return cur.length < min.length ? cur : min;
            }, lines[0].match(/^[\s\t]*/)![0]);

        // 2. Re-indent
        return lines.map(line => {
            if (line.trim().length === 0) return '';
            if (line.startsWith(commonIndent)) {
                return indent + line.substring(commonIndent.length);
            }
            return indent + line;
        }).join('\n');
    }

    /**
     * Generate a diff string for display
     */
    private generateDiff(filePath: string, oldContent: string, newContent: string): string {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const lines: string[] = [];

        lines.push(`--- a/${filePath.split('/').pop()}`);
        lines.push(`+++ b/${filePath.split('/').pop()}`);
        lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);

        for (const line of oldLines) {
            lines.push(`-${line}`);
        }
        for (const line of newLines) {
            lines.push(`+${line}`);
        }

        return lines.join('\n');
    }

    /**
     * Generate a simple hash
     */
    private generateHash(input: string): string {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `hash:${Math.abs(hash).toString(16).padStart(8, '0')}`;
    }

    /**
     * Clear stored original contents
     */
    clearCache(): void {
        this.originalContents.clear();
    }
}
