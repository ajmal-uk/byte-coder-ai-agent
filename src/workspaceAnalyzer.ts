import * as vscode from 'vscode';
import * as path from 'path';

export class WorkspaceAnalyzer {

    public async getFileStructure(maxDepth: number = 2): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return "No workspace open.";

        const rootPath = folders[0].uri.fsPath;
        let structure = `Root: ${rootPath}\n`;

        // Simple BFS/DFS to list files up to maxDepth
        try {
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);
            const relativePaths = files.map(f => path.relative(rootPath, f.fsPath));

            // Group by directory for cleaner output
            const tree: any = {};
            relativePaths.forEach(p => {
                const parts = p.split(path.sep);
                let current = tree;
                parts.forEach(part => {
                    if (!current[part]) current[part] = {};
                    current = current[part];
                });
            });

            structure += this.formatTree(tree);
        } catch (e) {
            structure += "(Error reading file structure)";
        }

        return structure;
    }

    private formatTree(tree: any, indent: string = ''): string {
        let output = '';
        for (const key in tree) {
            output += `${indent}- ${key}\n`;
            if (Object.keys(tree[key]).length > 0) {
                output += this.formatTree(tree[key], indent + '  ');
            }
        }
        return output;
    }

    public async findRelevantFiles(query: string): Promise<vscode.Uri[]> {
        // Semantic search simulation (keyword matching for now)
        // Check if query contains file extensions or common names
        const keywords = query.split(' ').filter(w => w.length > 3);
        const candidates = await vscode.workspace.findFiles(`**/*{${keywords.join(',')}}*`, '**/node_modules/**', 5);
        return candidates;
    }
}
