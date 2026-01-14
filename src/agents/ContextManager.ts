
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
     * Chunks a large string into token-sized parts, preserving line boundaries.
     */
    public chunkContent(content: string, maxTokens: number = 2000): string[] {
        const charLimit = maxTokens * ContextManager.CHARS_PER_TOKEN;
        const chunks: string[] = [];
        const lines = content.split('\n');

        let currentChunk = "";

        for (const line of lines) {
            if ((currentChunk.length + line.length + 1) > charLimit) {
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                    currentChunk = "";
                }
                // If a single line is massive, split it hardly
                if (line.length > charLimit) {
                    for (let i = 0; i < line.length; i += charLimit) {
                        chunks.push(line.substring(i, i + charLimit));
                    }
                } else {
                    currentChunk = line + "\n";
                }
            } else {
                currentChunk += line + "\n";
            }
        }

        if (currentChunk.length > 0) chunks.push(currentChunk);
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
