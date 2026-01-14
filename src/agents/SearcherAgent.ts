
import * as vscode from 'vscode';

export class SearcherAgent {

    /**
     * Finds files matching a glob pattern or keyword.
     */
    public async findFiles(query: string): Promise<vscode.Uri[]> {
        // 1. Try generic search via vscode API
        // Exclude node_modules, .git, out, dist
        const excludePattern = '**/{node_modules,.git,out,dist,build}/**';

        // If query looks like a file extension or path
        const isPath = query.includes('/') || query.includes('.');
        const searchPattern = isPath ? `**/*${query}*` : `**/*${query}*/**`;

        try {
            const files = await vscode.workspace.findFiles(searchPattern, excludePattern, 10);
            return files;
        } catch (error) {
            console.error("SearcherAgent error:", error);
            return [];
        }
    }

    /**
     * Advanced content search: Finds files and verifies they contain the keywords.
     */
    public async searchContent(query: string): Promise<vscode.Uri[]> {
        // 1. Find candidates by filename or broad search
        const candidates = await this.findFiles(query);
        const validated: vscode.Uri[] = [];

        // 2. Verify content matches (simple inclusion check)
        // Limit to top 20 candidates to avoid performance hit
        for (const uri of candidates.slice(0, 20)) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const text = doc.getText().toLowerCase();
                const queryLower = query.toLowerCase();

                // Check if file contains the query keyword
                if (text.includes(queryLower)) {
                    validated.push(uri);
                }
            } catch (error) {
                // Ignore matching errors (binary files, etc.)
            }
        }

        return validated;
    }
}
