/**
 * CodeGeneratorAgent - Generates code content and modifications based on plans
 * Bridges the gap between TaskPlanner and CommandGenerator/CodeModifier
 */

import * as vscode from 'vscode';
import { BaseAgent, AgentOutput, CodeModification, CommandSpec, TaskNode } from '../core/AgentTypes';
import { TaskPlannerResult } from './TaskPlannerAgent';
import { CodePlannerResult } from './CodePlannerAgent';
import { ByteAIClient } from '../byteAIClient';
import { FilePartSearcherAgent, FilePartMatch } from './FilePartSearcherAgent';

export interface CodeGeneratorInput {
    taskPlan: TaskPlannerResult;
    codePlan: CodePlannerResult;
    context?: {
        knowledge?: any[];
        files?: any[];
    };
}

export interface CodeGeneratorResult {
    commands: any[]; // specific CommandSpec structure
    modifications: CodeModification[];
    generatedFiles: string[];
}

type GenResult = 
    | { type: 'create', content: string }
    | { type: 'modify', modifications: CodeModification[] };

export class CodeGeneratorAgent extends BaseAgent<CodeGeneratorInput, CodeGeneratorResult> {
    private client: ByteAIClient;
    private filePartSearcher: FilePartSearcherAgent;

    constructor() {
        super({ name: 'CodeGenerator', timeout: 60000 }); // Increased timeout for LLM generation
        this.client = new ByteAIClient();
        this.filePartSearcher = new FilePartSearcherAgent();
    }

    async execute(input: CodeGeneratorInput): Promise<AgentOutput<CodeGeneratorResult>> {
        const startTime = Date.now();

        try {
            const commands: any[] = [];
            const modifications: CodeModification[] = [];
            const generatedFiles: string[] = [];

            // Process tasks to generate code
            for (const task of input.taskPlan.taskGraph) {
                if (task.filePath && !task.description.includes('mkdir')) {
                    // This task involves a file
                    const result = await this.generateForTask(task, input.codePlan, input.context);
                    
                    if (result.type === 'create') {
                        commands.push({
                            operation: 'create_file',
                            target: task.filePath,
                            content: result.content
                        });
                        generatedFiles.push(task.filePath);
                    } else {
                        modifications.push(...result.modifications);
                        generatedFiles.push(task.filePath);
                    }
                }
            }

            const result: CodeGeneratorResult = {
                commands,
                modifications,
                generatedFiles
            };

            return this.createOutput('success', result, 0.8, startTime, {
                reasoning: `Generated content/modifications for ${generatedFiles.length} files based on task plan`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Generate content or modifications for a file using LLM with fallback to templates
     */
    private async generateForTask(task: TaskNode, codePlan: CodePlannerResult, context?: CodeGeneratorInput['context']): Promise<GenResult> {
        const filePath = task.filePath!;
        const description = task.description;
        
        try {
            // Check if file exists and read content
            let fileExists = false;
            let fileContent = '';
            let isPartial = false;

            try {
                const wsFolder = vscode.workspace.workspaceFolders?.[0];
                let uri: vscode.Uri;
                
                if (filePath.startsWith('/')) {
                     uri = vscode.Uri.file(filePath);
                } else if (wsFolder) {
                    uri = vscode.Uri.joinPath(wsFolder.uri, filePath);
                } else {
                    uri = vscode.Uri.file(filePath); // Fallback
                }

                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.File) {
                    fileExists = true;
                    // Read file content
                    const doc = await vscode.workspace.openTextDocument(uri);
                const fullContent = doc.getText();
                
                // Determine if we should use partial content (FilePartSearcher)
                // We use it if file is large OR if the task specifically targets a code element (function/class)
                const targetElement = this.detectTargetElement(description);
                const isLargeFile = fullContent.length > 20000;

                if (isLargeFile || targetElement) {
                    // File is large or specific target, try to find relevant parts
                    isPartial = true;
                    
                    // Extract keywords from description
                    const keywords = description.split(' ')
                        .filter(w => w.length > 4 && !['update', 'change', 'modify', 'delete', 'remove', 'create', 'write', 'function', 'class', 'method'].includes(w.toLowerCase()));
                    
                    if (targetElement) {
                        // If we have a specific target type, prioritize searching for it
                        const searchResult = await this.filePartSearcher.execute({
                            filePath,
                            fileContent: fullContent,
                            searchFor: {
                                elementType: targetElement.type,
                                name: targetElement.name // Optional: if we extracted a name
                            }
                        });

                        if (searchResult.status === 'success' && searchResult.payload && searchResult.payload.length > 0) {
                             // We found specific elements!
                             fileContent = searchResult.payload.map((m: FilePartMatch) => 
                                `// ... (lines ${m.startLine}-${m.endLine})\n${m.content}\n// ...`
                            ).join('\n\n');
                        } else {
                            // Fallback to keyword search if element search failed
                            fileContent = await this.keywordSearch(filePath, fullContent, keywords, targetElement.type);
                        }
                    } else {
                        // Just keyword search
                        fileContent = await this.keywordSearch(filePath, fullContent, keywords);
                    }
                } else {
                    fileContent = fullContent;
                }
                }
            } catch {
                // file does not exist
            }

            // Construct prompt for LLM
            const prompt = this.constructPrompt(filePath, description, codePlan, fileExists, fileContent, context, isPartial);
            
            // Call LLM
            const response = await this.client.streamResponse(
                prompt,
                () => {}, // We don't need to process chunks here
                (err) => { console.warn('LLM streaming warning:', err); }
            );

            // Extract code from response
            const result = this.extractResult(response, filePath, fileExists);
            
            if (result) {
                return result;
            }
            
            console.warn(`Could not extract code/mods for ${filePath}, falling back to template.`);
            return { type: 'create', content: this.generateFallbackContent(filePath, description, context) };

        } catch (error) {
            console.error(`LLM generation failed for ${filePath}:`, error);
            return { type: 'create', content: this.generateFallbackContent(filePath, description, context) };
        }
    }

    private constructPrompt(filePath: string, description: string, codePlan: CodePlannerResult, fileExists: boolean, fileContent: string, context?: CodeGeneratorInput['context'], isPartial: boolean = false): string {
        const fileName = filePath.split('/').pop() || 'file';

        let prompt = `Task: ${description}\n`;
        prompt += `Target File: \`${filePath}\`\n`;
        prompt += `File Status: ${fileExists ? 'EXISTS (Modify it)' : 'NEW (Create it)'}\n\n`;
        
        if (fileExists && fileContent) {
            prompt += `**Current File Content${isPartial ? ' (PARTIAL/RELEVANT SECTIONS)' : ''}:**\n`;
            prompt += `\`\`\`${filePath.split('.').pop() || 'text'}\n${fileContent}\n\`\`\`\n\n`;
        }
        
        if (codePlan.techStack) {
            prompt += `**Tech Stack:**\n`;
            if (codePlan.techStack.frontend) prompt += `- Frontend: ${codePlan.techStack.frontend}\n`;
            if (codePlan.techStack.backend) prompt += `- Backend: ${codePlan.techStack.backend}\n`;
            if (codePlan.techStack.database) prompt += `- Database: ${codePlan.techStack.database}\n`;
        }

        if (context?.knowledge && context.knowledge.length > 0) {
            prompt += `\n**Relevant Context/Knowledge:**\n`;
            context.knowledge.forEach(k => {
                prompt += `- ${k.summary}\n`;
            });
        }

        // Add Web Search Context
        if ((context as any)?.webSearch) {
            const searchResult = (context as any).webSearch.payload;
            if (searchResult) {
                prompt += `\n\nExternal Knowledge (Web Search):\nSource: ${searchResult.source}\nURL: ${searchResult.url}\nContent:\n${searchResult.content}\n\nUse this information to implement the requested code.`;
            }
        }

        prompt += `\n**Requirements:**\n`;
        if (fileExists) {
            prompt += `1. The file ALREADY EXISTS. DO NOT rewrite the whole file.\n`;
            prompt += `2. Output a JSON array of modifications inside <byte_action type="modify_file"> tags.\n`;
            prompt += `3. Format: [{"filePath": "${filePath}", "searchBlock": "unique code to find", "replaceBlock": "code to add/replace", "action": "replace" | "insert_before" | "insert_after" | "delete", "startLine": 0, "endLine": 0}]\n`;
            prompt += `4. "searchBlock" must uniquely identify the anchor or target. \n`;
            prompt += `   - For REPLACEMENT: searchBlock is the code to be removed.\n`;
            prompt += `   - For INSERTION: searchBlock is the ANCHOR (existing code) to insert before/after.\n`;
            prompt += `5. IMPORTANT: If you are provided with partial content containing line numbers (e.g. // lines 50-60), YOU MUST USE THOSE LINE NUMBERS in "startLine" and "endLine" if your modification targets that specific block.\n`;
            prompt += `6. If adding a new function/method, prefer "insert_after" an existing method to maintain structure.\n`;
        } else {
            prompt += `1. Output ONLY the code for this file.\n`;
            prompt += `2. Ensure the code is complete, functional, and follows best practices.\n`;
            prompt += `3. Include necessary imports and type definitions.\n`;
            prompt += `4. Start the file with a comment: // ${fileName}\n`;
            prompt += `5. Wrap code in <byte_action type="create_file"> or markdown code blocks.\n`;
        }

        return prompt;
    }

    private extractResult(response: string, filePath: string, fileExists: boolean): GenResult | null {
        // 1. Check for <byte_action type="modify_file">
        const modMatch = response.match(/<byte_action\s+type="modify_file"[^>]*>([\s\S]*?)<\/byte_action>/i);
        if (modMatch && modMatch[1]) {
            try {
                const jsonStr = modMatch[1].trim();
                // Handle potential markdown wrapping around JSON
                const cleanJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                const mods = JSON.parse(cleanJson);
                if (Array.isArray(mods)) {
                     // Ensure filePath is set
                     mods.forEach(m => { if (!m.filePath) m.filePath = filePath; });
                     return { type: 'modify', modifications: mods };
                }
            } catch (e) {
                console.error("Failed to parse modification JSON", e);
            }
        }

        // 2. Check for <byte_action type="create_file">
        const createMatch = response.match(/<byte_action\s+type="create_file"[^>]*>([\s\S]*?)<\/byte_action>/i);
        if (createMatch && createMatch[1]) {
            return { type: 'create', content: createMatch[1].trim() };
        }

        // 3. Check for markdown code blocks (Create fallback)
        const codeBlockMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
            return { type: 'create', content: codeBlockMatch[1].trim() };
        }

        // 4. Heuristic fallback
        const trimmed = response.trim();
        if (trimmed.startsWith('import ') || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('package ') || trimmed.startsWith('export ')) {
            return { type: 'create', content: trimmed };
        }

        return null;
    }

    /**
     * Detect if the task description targets a specific code element
     */
    private detectTargetElement(description: string): { type: string, name?: string } | null {
        const desc = description.toLowerCase();
        
        // Match patterns like "update function validate" or "modify class DataProcessor"
        const funcMatch = desc.match(/(?:function|method)\s+(\w+)/);
        if (funcMatch) return { type: 'function', name: funcMatch[1] };
        
        const classMatch = desc.match(/class\s+(\w+)/);
        if (classMatch) return { type: 'class', name: classMatch[1] };
        
        if (desc.includes('function')) return { type: 'function' };
        if (desc.includes('class')) return { type: 'class' };
        if (desc.includes('component')) return { type: 'component' };
        
        return null;
    }

    /**
     * Helper to perform keyword-based search using FilePartSearcher
     */
    private async keywordSearch(filePath: string, content: string, keywords: string[], elementType?: string): Promise<string> {
        if (keywords.length === 0 && !elementType) {
            return content.slice(0, 50000) + '\n... (truncated)';
        }

        const searchResult = await this.filePartSearcher.execute({
            filePath,
            fileContent: content,
            searchFor: {
                text: keywords.join(' '),
                elementType
            }
        });

        if (searchResult.status === 'success' && searchResult.payload && searchResult.payload.length > 0) {
            return searchResult.payload.map((m: FilePartMatch) => 
                `// ... (lines ${m.startLine}-${m.endLine})\n${m.content}\n// ...`
            ).join('\n\n');
        }

        return content.slice(0, 50000) + '\n... (truncated)';
    }

    /**
     * Fallback generation logic (original template-based)
     */
    private generateFallbackContent(filePath: string, description: string, context?: CodeGeneratorInput['context']): string {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const fileName = filePath.split('/').pop()?.split('.')[0] || 'Component';

        // Extract relevant knowledge if available
        let additionalContext = '';
        if (context?.knowledge && context.knowledge.length > 0) {
            const relevantKnowledge = context.knowledge.filter(k => {
                const keywords = description.toLowerCase().split(' ').filter(w => w.length > 3);
                return keywords.some(w => k.summary.toLowerCase().includes(w) || k.content?.toLowerCase().includes(w));
            });

            if (relevantKnowledge.length > 0) {
                additionalContext = `\n// RELEVANT CONTEXT:\n// ${relevantKnowledge.map(k => k.summary).join('\n// ')}\n`;
            }
        }

        // 1. React Component
        if ((filePath.includes('components/') || filePath.includes('pages/')) && (ext === 'tsx' || ext === 'jsx')) {
            let innerContent = `{/* TODO: Implement ${description} */}`;
            
            if (additionalContext) {
                 innerContent += `\n            {/* \n              CONTEXT:\n              ${(context?.knowledge || []).map(k => k.summary).join('\n              ')} \n            */}`;
            }

            return `import React from 'react';

interface ${fileName}Props {
    // TODO: Define props
    children?: React.ReactNode;
}

export const ${fileName}: React.FC<${fileName}Props> = ({ children }) => {
    return (
        <div className="${fileName.toLowerCase()}-container">
            ${innerContent}
            <h2>${fileName}</h2>
            {children}
        </div>
    );
};

export default ${fileName};`;
        }

        // 2. TypeScript/JavaScript File
        if (ext === 'ts' || ext === 'js') {
            if (filePath.includes('types/') || filePath.includes('interfaces')) {
                return `// Type definitions for ${fileName}
// Generated by Byte Coder

export interface I${fileName} {
    id: string;
    createdAt: Date;
    updatedAt: Date;
}
`;
            }

            if (filePath.includes('utils/') || filePath.includes('helpers')) {
                return `/**
 * Utility functions for ${fileName}
 */

export const process${fileName} = (data: any): void => {
    // TODO: Implement processing logic
    console.log('Processing', data);
};
`;
            }
        }

        // 3. CSS/Styles
        if (ext === 'css' || ext === 'scss') {
            return `/* Styles for ${fileName} */
.${fileName.toLowerCase()}-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
`;
        }

        // 4. Python Script
        if (ext === 'py') {
            if (description.toLowerCase().includes('solve') || description.toLowerCase().includes('calculate')) {
                const mathMatch = description.match(/[\d\s\+\-\*\/\(\)\.]+/);
                const expression = mathMatch ? mathMatch[0].trim() : '"Could not parse expression"';
                
                return `# Python script to ${description}
def solve():
    try:
        result = ${expression}
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    solve()
`;
            }

            return `# ${fileName}.py
# ${description}

def main():
    print("Executing ${fileName}...")
    # TODO: Implement logic

if __name__ == "__main__":
    main()
`;
        }

        // 5. Shell Script
        if (ext === 'sh') {
            return `#!/bin/bash
# ${description}

echo "Running ${fileName}..."
# TODO: Implement commands
`;
        }

        // 6. JSON Config
        if (ext === 'json') {
            return `{\n  "name": "${fileName}",\n  "version": "1.0.0"\n}`;
        }

        // Default
        return `// ${fileName}
// ${description}
// TODO: Implement this file
`;
    }
}
