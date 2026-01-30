import * as vscode from 'vscode';
import { FileFinderAgent } from './FileFinderAgent';
import { ContextSearchAgent } from './ContextSearchAgent';
import { IntentAnalyzer } from './IntentAnalyzer';

export class SearchAgent {
    private fileFinder: FileFinderAgent;
    private contextSearch: ContextSearchAgent;
    private intentAnalyzer: IntentAnalyzer;

    constructor(context?: vscode.ExtensionContext) {
        this.fileFinder = new FileFinderAgent();
        this.contextSearch = new ContextSearchAgent(context);
        this.intentAnalyzer = new IntentAnalyzer();
    }
    
    async getProjectMap(): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) return 'No workspace open';
        
        try {
            // Get top level files and directories
            const rootPath = folders[0].uri;
            const entries = await vscode.workspace.fs.readDirectory(rootPath);
            
            let structure = "Project Structure (Root):\n";
            let count = 0;
            
            for (const [name, type] of entries) {
                if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'out' || name === 'build') continue;
                if (count > 20) {
                    structure += `  ... (and more)\n`;
                    break;
                }
                
                const typeName = type === vscode.FileType.Directory ? 'DIR' : 'FILE';
                structure += `  - ${name} [${typeName}]\n`;
                count++;
            }
            
            return structure;
        } catch (e) {
            return "Could not read project structure.";
        }
    }

    async search(query: string, activeFilePath?: string): Promise<string> {
        if (!query || query.length < 3) return '';

        try {
            // 1. Analyze Intent
            const intent = await this.intentAnalyzer.analyze(query);

            // 2. Find Files (Intelligent Search)
            const fileMatches = await this.fileFinder.find(intent, activeFilePath);
            
            // 3. Get Context (Memory & History)
            const contextResult = await this.contextSearch.execute({ 
                query, 
                lookForPreviousFixes: intent.queryType === 'fix',
                recencyDays: 14
            });

            // 4. Format Results
            let result = "";
            
            // Files Section
            if (fileMatches.length > 0) {
                result += `**Found Files:**\n`;
                for (const file of fileMatches) {
                    // Add match type indicator
                    const indicator = file.matchType === 'exact' ? '⭐' : file.matchType === 'fuzzy' ? '🔍' : '📄';
                    result += `- ${indicator} [${file.relativePath}](${file.uri.fsPath}) (Score: ${file.score.toFixed(1)})\n`;
                }
                result += '\n';
            } else {
                result += `*No direct file matches found for "${query}"*\n\n`;
            }

            // Context Section
            if (contextResult.status === 'success' && contextResult.payload) {
                const data = contextResult.payload;
                
                if (data.memories.length > 0) {
                    result += `**Relevant Context:**\n`;
                    // Group by type
                    const grouped = this.groupMemories(data.memories);
                    for (const [type, mems] of Object.entries(grouped)) {
                        result += `- **${this.formatMemoryType(type)}**:\n`;
                        for (const m of mems.slice(0, 3)) { // Limit to top 3 per category
                            result += `  - ${m.summary}\n`;
                        }
                    }
                    result += '\n';
                }

                if (data.relevantPatterns.length > 0) {
                    result += `**Suggested Patterns:** ${data.relevantPatterns.join(', ')}\n\n`;
                }
            }
            
            return result;
        } catch (e) {
            console.error('SearchAgent Error:', e);
            return `Error performing search: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    private groupMemories(memories: any[]): Record<string, any[]> {
        const groups: Record<string, any[]> = {};
        for (const m of memories) {
            if (!groups[m.type]) groups[m.type] = [];
            groups[m.type].push(m);
        }
        return groups;
    }

    private formatMemoryType(type: string): string {
        switch (type) {
            case 'knowledge': return 'Knowledge Base';
            case 'previous_fix': return 'Past Fixes';
            case 'file_history': return 'Recent Files';
            case 'user_info': return 'User Context';
            default: return type.charAt(0).toUpperCase() + type.slice(1);
        }
    }
}
