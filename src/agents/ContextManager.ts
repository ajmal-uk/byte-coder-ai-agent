
import * as vscode from 'vscode';

export class ContextManager {
    private static readonly MAX_TOKENS = 8000; // Conservative limit
    private static readonly CHARS_PER_TOKEN = 4;

    /**
     * Estimates token count for a string.
     */
    public countTokens(text: string): number {
        return Math.ceil(text.length / ContextManager.CHARS_PER_TOKEN);
    }

    /**
     * Chunks a large string into token-sized parts, preserving logical boundaries (paragraphs) where possible.
     */
    public chunkContent(content: string, maxTokens: number = 2000): string[] {
        const charLimit = maxTokens * ContextManager.CHARS_PER_TOKEN;
        const chunks: string[] = [];

        // Try to split by double newlines first (paragraphs/blocks)
        let parts = content.split('\n\n');
        // If that's too coarse (e.g. minified code), fall back to single lines
        if (parts.length < 2) parts = content.split('\n');

        let currentChunk = "";

        for (const part of parts) {
            // Re-add the separator (approximation)
            const segment = part + "\n\n";

            if ((currentChunk.length + segment.length) > charLimit) {
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk.trim());
                    currentChunk = "";
                }

                // If a single part is still massive, split strictly by chars
                if (segment.length > charLimit) {
                    for (let i = 0; i < segment.length; i += charLimit) {
                        chunks.push(segment.substring(i, i + charLimit));
                    }
                } else {
                    currentChunk = segment;
                }
            } else {
                currentChunk += segment;
            }
        }

        if (currentChunk.length > 0) chunks.push(currentChunk.trim());
        return chunks;
    }

    /**
     * Prunes a list of files to fit within the context window.
     * Prioritizes active file and explicit user mentions.
     */
    public pruneContext(files: { path: string, content: string }[], activeFilePath?: string): { path: string, content: string }[] {
        let currentTokens = 0;
        const prunedFiles: { path: string, content: string }[] = [];

        // 1. Add Active File First (Priority: High)
        if (activeFilePath) {
            const activeFile = files.find(f => f.path === activeFilePath);
            if (activeFile) {
                const tokens = this.countTokens(activeFile.content);
                if (tokens < ContextManager.MAX_TOKENS) {
                    prunedFiles.push(activeFile);
                    currentTokens += tokens;
                } else {
                    // Chunk active file if too huge
                    const chunked = this.chunkContent(activeFile.content, ContextManager.MAX_TOKENS);
                    prunedFiles.push({ path: activeFile.path, content: chunked[0] + "\n...[Content Truncated]..." });
                    currentTokens += this.countTokens(prunedFiles[0].content);
                }
            }
        }

        // 2. Sort remaining files by relevance (heuristic: file size ? smaller is usually more dense with logic)
        // In v3.2 we can add keywords score, for now we prefer shorter, more focused files
        const otherFiles = files
            .filter(f => f.path !== activeFilePath)
            .sort((a, b) => a.content.length - b.content.length);

        // 3. Add other files until limit
        for (const file of otherFiles) {
            const tokens = this.countTokens(file.content);

            // Allow at least 2000 tokens for other context
            if (currentTokens + tokens < (ContextManager.MAX_TOKENS + 2000)) {
                prunedFiles.push(file);
                currentTokens += tokens;
            } else {
                // Try to add at least the first chunk of the next file
                const chunked = this.chunkContent(file.content, 1000); // 1000 tokens for secondary files
                if (currentTokens + this.countTokens(chunked[0]) < (ContextManager.MAX_TOKENS + 2000)) {
                    prunedFiles.push({ path: file.path, content: chunked[0] + "\n...[Content Truncated]..." });
                    currentTokens += this.countTokens(chunked[0]);
                }
                // Stop if getting too full
                if (currentTokens >= (ContextManager.MAX_TOKENS + 2000)) break;
            }
        }

        return prunedFiles;
    }
}
