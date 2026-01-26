/**
 * AgentOrchestrator - Executes agentic tasks with real file/command operations
 * This is the bridge between AI responses and actual code changes
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ManagerAgent } from './ManagerAgent';
import { ManagerDecision, AgentOutput, CodeModification } from './AgentTypes';
import { ExecutorAgent, ExecutorOutput } from '../agents/ExecutorAgent';
import { VersionControllerAgent } from '../agents/VersionControllerAgent';
import { CodeModifierAgent, CodeModifierResult } from '../agents/CodeModifierAgent';
import { CommandGeneratorAgent, CommandGeneratorResult } from '../agents/CommandGeneratorAgent';
import { ContextSearchAgent } from '../agents/ContextSearchAgent';
import { ProcessPlannerAgent, ProcessPlannerResult } from '../agents/ProcessPlannerAgent';
import { CodePlannerAgent, CodePlannerResult } from '../agents/CodePlannerAgent';
import { TaskPlannerAgent, TaskPlannerResult } from '../agents/TaskPlannerAgent';
import { SearchAgent } from '../SearchAgent';

export interface AgenticAction {
    type: 'create_file' | 'modify_file' | 'run_command' | 'create_directory' | 'delete_file' | 'partial_edit';
    path?: string;
    content?: string;
    command?: string;
    description: string;
}

export interface AgenticResult {
    success: boolean;
    actions: { action: AgenticAction; result: string; success: boolean }[];
    summary: string;
    checkpointId?: string;
}

export interface ParsedInstruction {
    type: 'create_file' | 'create_folder' | 'run_command' | 'modify_file' | 'delete_file' | 'partial_edit' | 'explanation';
    path?: string;
    content?: string;
    command?: string;
    language?: string;
    // For partial_edit: surgical edits
    searchContent?: string;  // Content to find
    replaceContent?: string; // Content to replace with
    startLine?: number;      // Line range start
    endLine?: number;        // Line range end
}

export class AgentOrchestrator {
    private managerAgent: ManagerAgent;
    private executorAgent: ExecutorAgent;
    private versionController: VersionControllerAgent;
    private codeModifier: CodeModifierAgent;
    private commandGenerator: CommandGeneratorAgent;
    private contextSearch: ContextSearchAgent;
    private processPlanner: ProcessPlannerAgent;
    private codePlanner: CodePlannerAgent;
    private taskPlanner: TaskPlannerAgent;
    private searchAgent: SearchAgent;
    private workspaceRoot: string;

    // Context tracking for "that file" references
    private lastReferencedFile: string | null = null;
    private lastCreatedFile: string | null = null;
    private lastModifiedFile: string | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.managerAgent = new ManagerAgent();
        this.executorAgent = new ExecutorAgent();
        this.versionController = new VersionControllerAgent(context);
        this.codeModifier = new CodeModifierAgent();
        this.commandGenerator = new CommandGeneratorAgent();
        this.contextSearch = new ContextSearchAgent(context);
        this.processPlanner = new ProcessPlannerAgent();
        this.codePlanner = new CodePlannerAgent();
        this.taskPlanner = new TaskPlannerAgent();
        this.searchAgent = new SearchAgent();
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        // Load context from global state
        this.loadContext();
    }

    /**
     * Load persistent context
     */
    private loadContext() {
        this.lastReferencedFile = this.context.globalState.get<string>('byteAI_lastReferencedFile') || null;
        this.lastCreatedFile = this.context.globalState.get<string>('byteAI_lastCreatedFile') || null;
        this.lastModifiedFile = this.context.globalState.get<string>('byteAI_lastModifiedFile') || null;
    }

    /**
     * Save persistent context
     */
    private saveContext() {
        this.context.globalState.update('byteAI_lastReferencedFile', this.lastReferencedFile);
        this.context.globalState.update('byteAI_lastCreatedFile', this.lastCreatedFile);
        this.context.globalState.update('byteAI_lastModifiedFile', this.lastModifiedFile);
    }

    /**
     * Reset the orchestrator state and clear context
     */
    async clearAllData(): Promise<void> {
        this.reset();
        await this.versionController.deleteAllCheckpoints();
    }

    /**
     * Reset the orchestrator state and clear context
     */
    reset(): void {
        this.lastReferencedFile = null;
        this.lastCreatedFile = null;
        this.lastModifiedFile = null;
        this.saveContext(); // Clear from storage too
        this.contextSearch.clear();
    }

    /**
     * Get the last referenced file for context
     */
    getLastReferencedFile(): string | null {
        return this.lastReferencedFile || this.lastModifiedFile || this.lastCreatedFile;
    }

    /**
     * Set context from user message (for resolving "that file" references)
     */
    setContextFromMessage(message: string, activeFilePath?: string): void {
        // Track active file as potential reference
        if (activeFilePath) {
            this.lastReferencedFile = activeFilePath;
            this.saveContext();
        }
    }

    /**
     * Analyze a user query and determine what actions to take
     */
    async analyzeIntent(query: string): Promise<AgentOutput<ManagerDecision>> {
        return this.managerAgent.execute({
            query,
            hasImage: false,
            hasSelection: false
        });
    }

    /**
     * Parse structured XML-like actions from AI response
     * <byte_action type="create_file" path="src/main.ts">code</byte_action>
     */
    private parseStructuredResponse(response: string): ParsedInstruction[] {
        const instructions: ParsedInstruction[] = [];
        const actionRegex = /<byte_action\s+([^>]+)>([\s\S]*?)<\/byte_action>/gi;
        let match;

        while ((match = actionRegex.exec(response)) !== null) {
            const attributesStr = match[1];
            const content = match[2].trim();
            
            const attributes: {[key: string]: string} = {};
            const attrRegex = /(\w+)="([^"]*)"/g;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
                attributes[attrMatch[1]] = attrMatch[2];
            }

            const type = attributes['type'];
            const path = attributes['path'];

            if (type === 'create_file') {
                instructions.push({ type: 'create_file', path, content });
            } else if (type === 'modify_file') {
                instructions.push({ type: 'modify_file', path, content });
            } else if (type === 'run_command') {
                instructions.push({ type: 'run_command', command: content || attributes['command'] });
            } else if (type === 'delete_file') {
                instructions.push({ type: 'delete_file', path });
            } else if (type === 'create_folder') {
                instructions.push({ type: 'create_folder', path });
            } else if (type === 'partial_edit') {
                // Extract search/replace from content if structured tags present
                const searchMatch = /<search>([\s\S]*?)<\/search>/i.exec(content);
                const replaceMatch = /<replace>([\s\S]*?)<\/replace>/i.exec(content);
                if (searchMatch && replaceMatch) {
                    instructions.push({
                        type: 'partial_edit',
                        path,
                        searchContent: searchMatch[1].trim(),
                        replaceContent: replaceMatch[1].trim()
                    });
                }
            }
        }
        return instructions;
    }

    /**
     * Parse AI response for executable instructions
     * This catches many different ways the AI might describe file creation
     */
    parseAIResponse(response: string): ParsedInstruction[] {
        // PRIORITY 0: Check for structured actions first
        const structuredInstructions = this.parseStructuredResponse(response);
        if (structuredInstructions.length > 0) {
            console.log('[AgentOrchestrator] Found structured instructions:', structuredInstructions.length);
            return structuredInstructions;
        }

        const instructions: ParsedInstruction[] = [];
        const addedPaths = new Set<string>();
        const deletedPaths = new Set<string>();

        // Extract all code blocks first
        const codeBlocks: { language: string; content: string; index: number }[] = [];
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        let match;
        while ((match = codeBlockRegex.exec(response)) !== null) {
            codeBlocks.push({
                language: match[1] || 'text',
                content: match[2].trim(),
                index: match.index
            });
        }

        // ===== PRIORITY 1: Check for DELETE operations first =====
        // This prevents delete scripts from being interpreted as file creation

        // Pattern D1: Delete/Remove file
        // Matches: "delete file.txt", "remove the file.py", "delete that file"
        const deleteFileRegex = /(?:delete|remove)(?:\s+the)?(?:\s+that)?\s+(?:file\s+)?[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi;
        while ((match = deleteFileRegex.exec(response)) !== null) {
            const fileName = match[1].trim();
            // Skip if filename contains 'delete' (it's likely a script name, not the target)
            if (fileName.toLowerCase().includes('delete')) continue;
            if (!addedPaths.has(fileName)) {
                instructions.push({
                    type: 'delete_file',
                    path: fileName
                });
                addedPaths.add(fileName);
                deletedPaths.add(fileName);
            }
        }

        // Pattern D2: "I'll delete/remove" or "I have deleted/removed" patterns
        const deleteConfirmRegex = /(?:i'?(?:ll|ve|\s+will|\s+have)?\s+)?(?:deleted?|removed?)(?:\s+the)?(?:\s+that)?\s+(?:file\s+)?[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi;
        while ((match = deleteConfirmRegex.exec(response)) !== null) {
            const fileName = match[1].trim();
            // Skip if filename contains 'delete' (it's likely a script name)
            if (fileName.toLowerCase().includes('delete')) continue;
            if (!addedPaths.has(fileName)) {
                instructions.push({
                    type: 'delete_file',
                    path: fileName
                });
                addedPaths.add(fileName);
                deletedPaths.add(fileName);
            }
        }

        // ===== DETECTION: Is this a deletion-focused response? =====
        // If the AI response indicates it's about deletion, skip ALL file creation
        const deletionPhrases = /(?:will\s+delete|deleting|proceed\s+with\s+delet|i'?ll\s+(?:now\s+)?delete|removing\s+the|will\s+remove|i'?ll\s+remove|have\s+been\s+deleted|successfully\s+deleted|files?\s+has\s+been\s+(?:deleted|removed))/i;
        const isDeletionResponse = deletionPhrases.test(response) || deletedPaths.size > 0;

        // If this is clearly a deletion response, skip create operations entirely
        if (isDeletionResponse) {
            // Just return the delete instructions, don't parse for creates
            return instructions.length > 0 ? instructions : instructions;
        }

        // ===== PRIORITY 2: Check for CREATE operations =====
        // Only run if this is NOT a deletion response

        // Pattern 1: File mentioned before code block
        // Matches: "created `filename.py`" or "file named filename.py" or "file: filename.py"
        const fileNameMentionRegex = /(?:creat(?:e|ed|ing)|file\s*(?:named?|called)?|named?|called)\s*[:\s]*[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi;

        while ((match = fileNameMentionRegex.exec(response)) !== null) {
            const fileName = match[1].trim();
            // Skip if already processed or if it's a delete-related filename
            if (addedPaths.has(fileName)) continue;
            if (deletedPaths.has(fileName)) continue;
            if (fileName.toLowerCase().includes('delete') || fileName.toLowerCase().includes('remove')) continue;

            // Find the code block that comes after this mention
            const mentionEnd = match.index + match[0].length;
            const nextBlock = codeBlocks.find(b => b.index > mentionEnd - 200);

            if (nextBlock && nextBlock.content) {
                instructions.push({
                    type: 'create_file',
                    path: fileName,
                    language: nextBlock.language || this.getLanguageFromExtension(fileName),
                    content: nextBlock.content
                });
                addedPaths.add(fileName);
            }
        }

        // Pattern 2: Code block starts with filename comment
        // Matches: # filename.py or // filename.js at the start of code block
        // Skip if the filename suggests it's a delete/remove script
        for (const block of codeBlocks) {
            const firstLine = block.content.split('\n')[0];
            const fileCommentMatch = firstLine.match(/^(?:#|\/\/|\/\*)\s*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/);

            if (fileCommentMatch) {
                const fileName = fileCommentMatch[1];
                // Skip delete-related script names and already processed files
                if (fileName.toLowerCase().includes('delete') || fileName.toLowerCase().includes('remove')) continue;
                if (addedPaths.has(fileName)) continue;
                if (deletedPaths.has(fileName)) continue;

                instructions.push({
                    type: 'create_file',
                    path: fileName,
                    language: block.language || this.getLanguageFromExtension(fileName),
                    content: block.content
                });
                addedPaths.add(fileName);
            }
        }

        // Pattern 3: Explicit "Create file X:" or "File: X" followed by code block
        const explicitFileRegex = /(?:create\s+(?:a\s+)?file|file)\s*[:\s]+[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"]?\s*(?:with|containing|:)?\s*```(\w*)\n([\s\S]*?)```/gi;
        while ((match = explicitFileRegex.exec(response)) !== null) {
            const fileName = match[1].trim();
            if (!addedPaths.has(fileName)) {
                instructions.push({
                    type: 'create_file',
                    path: fileName,
                    language: match[2] || this.getLanguageFromExtension(fileName),
                    content: match[3].trim()
                });
                addedPaths.add(fileName);
            }
        }

        // Pattern 4: "Here is the code" with filename in preceding context
        const hereIsCodeRegex = /(?:here\s+is|here's|content\s+of)\s+(?:the\s+)?(?:code|file)?[:\s]*[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)?[`"]?[:\s]*\n*```(\w*)\n([\s\S]*?)```/gi;
        while ((match = hereIsCodeRegex.exec(response)) !== null) {
            if (match[1]) {
                const fileName = match[1].trim();
                if (!addedPaths.has(fileName)) {
                    instructions.push({
                        type: 'create_file',
                        path: fileName,
                        language: match[2] || this.getLanguageFromExtension(fileName),
                        content: match[3].trim()
                    });
                    addedPaths.add(fileName);
                }
            }
        }

        // Pattern 5: Create folder/directory
        const folderRegex = /(?:create|make|add)\s+(?:a\s+)?(?:folder|directory)\s+[`"']?([a-zA-Z0-9_\-./]+)[`"']?/gi;
        while ((match = folderRegex.exec(response)) !== null) {
            instructions.push({
                type: 'create_folder',
                path: match[1].trim()
            });
        }

        // Pattern 6: Run commands in bash/shell blocks
        const bashBlockRegex = /```(?:bash|shell|sh|cmd|terminal)\n([\s\S]*?)```/gi;
        while ((match = bashBlockRegex.exec(response)) !== null) {
            const commands = match[1].trim().split('\n').filter(c => c.trim() && !c.startsWith('#'));
            for (const cmd of commands) {
                if (!instructions.some(i => i.command === cmd.trim())) {
                    instructions.push({
                        type: 'run_command',
                        command: cmd.trim()
                    });
                }
            }
        }

        // Pattern 7: npm/npx/yarn commands anywhere
        const npmRegex = /(?:^|\n)\s*(?:\$\s*)?((?:npm|npx|yarn|pnpm|pip|python|node)\s+[^\n]+)/gm;
        while ((match = npmRegex.exec(response)) !== null) {
            const cmd = match[1].trim();
            if (!instructions.some(i => i.command === cmd)) {
                instructions.push({
                    type: 'run_command',
                    command: cmd
                });
            }
        }

        // Pattern 8: Modify/Update/Edit file with code block
        // Matches: "modify file.txt", "update the file.py", "edit config.json", "change file.txt"
        const modifyFileRegex = /(?:modify|update|edit|change|replace\s+(?:content|contents)\s+(?:of|in))(?:\s+the)?\s+(?:file\s+)?[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi;
        while ((match = modifyFileRegex.exec(response)) !== null) {
            const fileName = match[1].trim();
            if (addedPaths.has(fileName)) continue;

            // Find the code block that comes after this mention
            const mentionEnd = match.index + match[0].length;
            const nextBlock = codeBlocks.find(b => b.index > mentionEnd - 200);

            if (nextBlock && nextBlock.content) {
                instructions.push({
                    type: 'modify_file',
                    path: fileName,
                    language: nextBlock.language || this.getLanguageFromExtension(fileName),
                    content: nextBlock.content
                });
                addedPaths.add(fileName);
            }
        }

        // Pattern 11: SEARCH/REPLACE blocks (structured format from AI)
        // Matches: <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE format
        const searchReplaceRegex = /(?:in\s+(?:file\s+)?)?[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?\s*(?:\n|:)?\s*<<<<<<<?(?:\s*SEARCH)?[\s\n]+([\s\S]*?)[\s\n]*=======[\s\n]+([\s\S]*?)[\s\n]*>>>>>>?>?(?:\s*REPLACE)?/gi;
        while ((match = searchReplaceRegex.exec(response)) !== null) {
            const fileName = match[1].trim();
            const searchContent = match[2].trim();
            const replaceContent = match[3].trim();

            if (!addedPaths.has(fileName + '_partial')) {
                instructions.push({
                    type: 'partial_edit',
                    path: fileName,
                    searchContent,
                    replaceContent
                });
                addedPaths.add(fileName + '_partial');
            }
        }

        // Pattern 12: Edit line N of file
        // Matches: "edit line 5 of config.json", "change line 10 in utils.ts"
        const lineEditRegex = /(?:edit|change|modify|update)\s+line\s+(\d+)(?:\s*(?:to|through|-)\s*(\d+))?\s+(?:of|in)\s+[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi;
        while ((match = lineEditRegex.exec(response)) !== null) {
            const startLine = parseInt(match[1], 10);
            const endLine = match[2] ? parseInt(match[2], 10) : startLine;
            const fileName = match[3].trim();

            // Find the code block that comes after this mention
            const mentionEnd = match.index + match[0].length;
            const nextBlock = codeBlocks.find(b => b.index > mentionEnd - 100);

            if (nextBlock && nextBlock.content) {
                instructions.push({
                    type: 'partial_edit',
                    path: fileName,
                    content: nextBlock.content,
                    startLine,
                    endLine
                });
            }
        }

        // Pattern 13: Replace X with Y in file (or "that file")
        // Matches: "replace foo with bar in utils.ts", "edit 6 with 11 in data.txt", "edit 6 with 11 in that file"
        const replaceInFileRegex = /(?:replace|change|swap|edit)\s+[`"']?([^`"']{1,100})[`"']?\s+(?:with|to)\s+[`"']?([^`"']{1,100})[`"']?\s+(?:in|of)\s+(?:[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?|(?:that|the|this)\s+file)/gi;
        while ((match = replaceInFileRegex.exec(response)) !== null) {
            const searchContent = match[1];
            const replaceContent = match[2];
            let fileName = match[3];

            if (!fileName) {
                // Matched "that file"
                const lastFile = this.getLastReferencedFile();
                if (lastFile) {
                    fileName = path.basename(lastFile);
                } else {
                    continue;
                }
            } else {
                fileName = fileName.trim();
            }

            instructions.push({
                type: 'partial_edit',
                path: fileName,
                searchContent,
                replaceContent
            });
        }

        // Pattern 15: Remove content from file (or "that file")
        // Matches: "remove 5 from data.txt", "remove 5 from that file"
        const removeContentRegex = /(?:remove|delete)\s+[`"']?([^`"']{1,100})[`"']?\s+(?:from|in)\s+(?:[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?|(?:that|the|this)\s+file)/gi;
        while ((match = removeContentRegex.exec(response)) !== null) {
            const contentToRemove = match[1];
            let fileName = match[2];

            if (!fileName) {
                const lastFile = this.getLastReferencedFile();
                if (lastFile) {
                    fileName = path.basename(lastFile);
                } else {
                    continue;
                }
            } else {
                fileName = fileName.trim();
            }
            
             instructions.push({
                type: 'partial_edit',
                path: fileName,
                searchContent: contentToRemove,
                replaceContent: '' // Empty string for removal
            });
        }

        // Pattern 14: Handle "that file" / "the file" references (Full file operations)
        const thatFileRegex = /(?:edit|modify|update|delete|remove)\s+(?:that|the|this)\s+file/gi;
        if (thatFileRegex.test(response) && this.getLastReferencedFile()) {
            const lastFile = this.getLastReferencedFile()!;
            const fileName = path.basename(lastFile);

            // Check if it's a delete operation (explicit full delete)
            // Note: Partial remove is handled by Pattern 15 above.
            // We only want to match "delete that file" here, not "delete X from that file".
            if (/(?:delete|remove)\s+(?:that|the|this)\s+file/i.test(response)) {
                if (!addedPaths.has(lastFile)) {
                    instructions.push({
                        type: 'delete_file',
                        path: lastFile
                    });
                    addedPaths.add(lastFile);
                }
            } else if (!/replace|change|swap|edit\s+.*with/i.test(response)) {
                 // Only treat as modify_file if it's NOT a partial edit pattern
                 // (Pattern 13 handles "edit X with Y in that file")
                 
                // For edit, look for associated code block
                const firstBlock = codeBlocks[0];
                if (firstBlock && firstBlock.content && !addedPaths.has(lastFile)) {
                    instructions.push({
                        type: 'modify_file',
                        path: lastFile,
                        content: firstBlock.content
                    });
                    addedPaths.add(lastFile);
                }
            }
        }

        console.log('[AgentOrchestrator] Parsed instructions:', instructions.length, instructions.map(i => ({ type: i.type, path: i.path, cmd: i.command })));

        return instructions;
    }

    /**
     * Get language from file extension
     */
    private getLanguageFromExtension(fileName: string): string {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const langMap: Record<string, string> = {
            'py': 'python',
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown',
            'sh': 'bash',
            'yml': 'yaml',
            'yaml': 'yaml'
        };
        return langMap[ext] || ext;
    }


    /**
     * Execute parsed instructions with real file/command operations
     */
    async executeInstructions(
        instructions: ParsedInstruction[],
        onProgress: (msg: string) => void
    ): Promise<AgenticResult> {
        const results: { action: AgenticAction; result: string; success: boolean }[] = [];
        let checkpointId: string | undefined;

        // Create checkpoint before making changes
        const targetFiles = instructions
            .filter(i => ['create_file', 'modify_file', 'delete_file', 'partial_edit'].includes(i.type))
            .map(i => this.resolvePath(i.path!));
            
        if (targetFiles.length > 0) {
            onProgress('📸 Creating checkpoint before changes...');
            const checkpointResult = await this.versionController.execute({
                action: 'create_checkpoint',
                files: targetFiles,
                description: `Auto-checkpoint before ${instructions.length} operations`
            });
            if (checkpointResult.status === 'success') {
                checkpointId = checkpointResult.payload.checkpoint?.checkpointId;
            }
        }

        for (const instruction of instructions) {
            try {
                switch (instruction.type) {
                    case 'create_file': {
                        const filePath = this.resolvePath(instruction.path!);
                        onProgress(`📝 Creating file: ${instruction.path}`);

                        // Ensure directory exists
                        const dir = path.dirname(filePath);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }

                        // Write file
                        fs.writeFileSync(filePath, instruction.content || '');

                        // Track this as the last created file
                        this.lastCreatedFile = filePath;
                        this.lastReferencedFile = filePath;

                        // Open the file in VS Code
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(doc, { preview: false });

                        results.push({
                            action: {
                                type: 'create_file',
                                path: instruction.path,
                                content: instruction.content,
                                description: `Created ${instruction.path}`
                            },
                            result: `✅ Created \`${instruction.path}\``,
                            success: true
                        });
                        break;
                    }

                    case 'create_folder': {
                        const folderPath = this.resolvePath(instruction.path!);
                        onProgress(`📁 Creating folder: ${instruction.path}`);

                        if (!fs.existsSync(folderPath)) {
                            fs.mkdirSync(folderPath, { recursive: true });
                        }

                        results.push({
                            action: {
                                type: 'create_directory',
                                path: instruction.path,
                                description: `Created directory ${instruction.path}`
                            },
                            result: `✅ Created directory \`${instruction.path}\``,
                            success: true
                        });
                        break;
                    }

                    case 'run_command': {
                        const command = instruction.command!;

                        // Safety check - skip dangerous commands
                        if (this.isDangerousCommand(command)) {
                            onProgress(`⚠️ Skipping potentially dangerous command: ${command}`);
                            results.push({
                                action: {
                                    type: 'run_command',
                                    command,
                                    description: `Skipped dangerous command`
                                },
                                result: `⚠️ Command requires manual execution: ${command}`,
                                success: false
                            });
                            continue;
                        }

                        onProgress(`🔧 Running: ${command}`);

                        const execResult = await this.executorAgent.execute({
                            command,
                            cwd: this.workspaceRoot,
                            timeout: 60000,
                            parseErrors: true
                        });

                        const success = execResult.payload.success;
                        results.push({
                            action: {
                                type: 'run_command',
                                command,
                                description: `Executed: ${command}`
                            },
                            result: success
                                ? `✅ \`${command}\`\n${execResult.payload.stdout.slice(0, 200)}`
                                : `❌ \`${command}\`\n${execResult.payload.stderr.slice(0, 200)}`,
                            success
                        });
                        break;
                    }

                    case 'modify_file': {
                        const filePath = this.resolvePath(instruction.path!);
                        onProgress(`✏️ Modifying file: ${instruction.path}`);

                        if (!fs.existsSync(filePath)) {
                            results.push({
                                action: {
                                    type: 'modify_file',
                                    path: instruction.path,
                                    description: `File not found: ${instruction.path}`
                                },
                                result: `❌ File not found: ${instruction.path}`,
                                success: false
                            });
                            continue;
                        }

                        // Write the new content
                        fs.writeFileSync(filePath, instruction.content || '');

                        // Track this as the last modified file
                        this.lastModifiedFile = filePath;
                        this.lastReferencedFile = filePath;
                        this.saveContext();

                        // Refresh the document in VS Code if it's open
                        const uri = vscode.Uri.file(filePath);
                        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
                        if (openDoc) {
                            // Reload the document
                            const doc = await vscode.workspace.openTextDocument(uri);
                            await vscode.window.showTextDocument(doc, { preview: false });
                        }

                        results.push({
                            action: {
                                type: 'modify_file',
                                path: instruction.path,
                                content: instruction.content,
                                description: `Modified ${instruction.path}`
                            },
                            result: `✅ Modified ${instruction.path}`,
                            success: true
                        });
                        break;
                    }

                    case 'delete_file': {
                        const filePath = this.resolvePath(instruction.path!);
                        onProgress(`🗑️ Deleting file: ${instruction.path}`);

                        if (!fs.existsSync(filePath)) {
                            results.push({
                                action: {
                                    type: 'delete_file',
                                    path: instruction.path,
                                    description: `File not found: ${instruction.path}`
                                },
                                result: `⚠️ File already deleted or not found: ${instruction.path}`,
                                success: true  // Consider it success if file doesn't exist
                            });
                            continue;
                        }

                        // Close the file if it's open in VS Code
                        const openTab = vscode.window.tabGroups.all
                            .flatMap(g => g.tabs)
                            .find(t => (t.input as any)?.uri?.fsPath === filePath);
                        if (openTab) {
                            await vscode.window.tabGroups.close(openTab);
                        }

                        // Delete the file
                        fs.unlinkSync(filePath);

                        results.push({
                            action: {
                                type: 'delete_file',
                                path: instruction.path,
                                description: `Deleted ${instruction.path}`
                            },
                            result: `✅ Deleted ${instruction.path}`,
                            success: true
                        });
                        break;
                    }

                    case 'partial_edit': {
                        const filePath = this.resolvePath(instruction.path!);
                        onProgress(`🔧 Surgical edit: ${instruction.path}`);

                        if (!fs.existsSync(filePath)) {
                            results.push({
                                action: {
                                    type: 'partial_edit',
                                    path: instruction.path,
                                    description: `File not found: ${instruction.path}`
                                },
                                result: `❌ File not found: ${instruction.path}`,
                                success: false
                            });
                            continue;
                        }

                        const currentContent = fs.readFileSync(filePath, 'utf8');
                        let newContent: string;
                        let editDescription: string;

                        if (instruction.searchContent && instruction.replaceContent !== undefined) {
                            // Search and replace mode
                            if (!currentContent.includes(instruction.searchContent)) {
                                results.push({
                                    action: {
                                        type: 'partial_edit',
                                        path: instruction.path,
                                        description: `Search content not found`
                                    },
                                    result: `❌ Could not find the content to replace in ${instruction.path}`,
                                    success: false
                                });
                                continue;
                            }
                            newContent = currentContent.replace(instruction.searchContent, instruction.replaceContent);
                            editDescription = `Replaced content in ${instruction.path}`;
                        } else if (instruction.startLine && instruction.content) {
                            // Line-based edit mode
                            const lines = currentContent.split('\n');
                            const startLine = instruction.startLine - 1; // 0-indexed
                            const endLine = (instruction.endLine || instruction.startLine) - 1;

                            if (startLine < 0 || endLine >= lines.length) {
                                results.push({
                                    action: {
                                        type: 'partial_edit',
                                        path: instruction.path,
                                        description: `Invalid line range`
                                    },
                                    result: `❌ Invalid line range ${instruction.startLine}-${instruction.endLine} (file has ${lines.length} lines)`,
                                    success: false
                                });
                                continue;
                            }

                            const newLines = instruction.content.split('\n');
                            lines.splice(startLine, endLine - startLine + 1, ...newLines);
                            newContent = lines.join('\n');
                            editDescription = `Modified lines ${instruction.startLine}-${instruction.endLine || instruction.startLine} in ${instruction.path}`;
                        } else if (instruction.content) {
                            // Full content replacement (fallback)
                            newContent = instruction.content;
                            editDescription = `Modified ${instruction.path}`;
                        } else {
                            results.push({
                                action: {
                                    type: 'partial_edit',
                                    path: instruction.path,
                                    description: `Invalid edit instruction`
                                },
                                result: `❌ No valid edit content provided`,
                                success: false
                            });
                            continue;
                        }

                        // Write the updated content
                        fs.writeFileSync(filePath, newContent);

                        // Track this as the last modified file
                        this.lastModifiedFile = filePath;

                        // Refresh in VS Code
                        const editUri = vscode.Uri.file(filePath);
                        try {
                            const doc = await vscode.workspace.openTextDocument(editUri);
                            await vscode.window.showTextDocument(doc, { preview: false });
                        } catch { }

                        results.push({
                            action: {
                                type: 'partial_edit',
                                path: instruction.path,
                                description: editDescription
                            },
                            result: `✅ ${editDescription.replace(instruction.path!, `\`${instruction.path}\``)}`,
                            success: true
                        });
                        break;
                    }
                }
            } catch (error) {
                const errorMsg = (error as Error).message;
                onProgress(`❌ Error: ${errorMsg}`);
                results.push({
                    action: {
                        type: instruction.type as any,
                        path: instruction.path,
                        command: instruction.command,
                        description: `Failed: ${errorMsg}`
                    },
                    result: `❌ Error: ${errorMsg}`,
                    success: false
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const totalCount = results.length;

        return {
            success: successCount === totalCount,
            actions: results,
            summary: `Completed ${successCount}/${totalCount} operations`,
            checkpointId
        };
    }

    /**
     * Create a project structure from a plan
     */
    async createProjectFromPlan(
        query: string,
        onProgress: (msg: string) => void
    ): Promise<{ plan: ProcessPlannerResult; structure: CodePlannerResult }> {
        onProgress('🏗️ Planning project structure...');

        const processResult = await this.processPlanner.execute({
            query,
            projectType: this.detectProjectType(query)
        });

        const codeResult = await this.codePlanner.execute({
            query,
            projectType: processResult.payload.techStack ? 'fullstack' : 'web',
            techStack: processResult.payload.techStack
        });

        return {
            plan: processResult.payload,
            structure: codeResult.payload
        };
    }

    /**
     * Execute a full project build
     */
    async buildProject(
        plan: CodePlannerResult,
        onProgress: (msg: string) => void
    ): Promise<AgenticResult> {
        const instructions: ParsedInstruction[] = [];

        // Create folders
        for (const file of plan.fileStructure) {
            if (file.endsWith('/')) {
                instructions.push({ type: 'create_folder', path: file.slice(0, -1) });
            }
        }

        // Create config files
        for (const config of plan.configFiles) {
            instructions.push({
                type: 'create_file',
                path: config.name,
                content: this.generateConfigContent(config.name, plan)
            });
        }

        return this.executeInstructions(instructions, onProgress);
    }

    /**
     * Rollback to a checkpoint
     */
    async rollback(checkpointId?: string): Promise<boolean> {
        const result = await this.versionController.execute({
            action: 'rollback',
            checkpointId
        });
        return result.status === 'success';
    }

    /**
     * Add context for future queries
     */
    addContext(key: string, value: any): void {
        this.contextSearch.setSessionContext(key, value);
    }

    /**
     * Store conversation turn
     */
    addConversationTurn(role: 'user' | 'assistant', content: string): void {
        this.contextSearch.addConversationTurn(role, content);
    }

    /**
     * Get conversation summary
     */
    getConversationSummary(): string {
        return this.contextSearch.getConversationSummary();
    }

    // ===== HELPER METHODS =====

    private resolvePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.join(this.workspaceRoot, filePath);
    }

    private isDangerousCommand(command: string): boolean {
        const dangerous = [
            /rm\s+-rf/i,
            /del\s+\/s/i,
            /rmdir\s+\/s/i,
            /format\s+/i,
            /sudo\s+rm/i,
            />\s*\/dev\//i,
            /drop\s+database/i
        ];
        return dangerous.some(p => p.test(command));
    }

    private detectProjectType(query: string): string {
        const lower = query.toLowerCase();
        if (lower.includes('api') || lower.includes('backend')) return 'api';
        if (lower.includes('fullstack') || lower.includes('full stack')) return 'fullstack';
        if (lower.includes('ecommerce') || lower.includes('e-commerce')) return 'fullstack';
        return 'web';
    }

    private generateConfigContent(filename: string, plan: CodePlannerResult): string {
        switch (filename) {
            case 'package.json':
                return JSON.stringify({
                    name: 'my-project',
                    version: '1.0.0',
                    scripts: {
                        dev: 'vite',
                        build: 'vite build',
                        start: 'node dist/index.js',
                        test: 'jest'
                    },
                    dependencies: Object.fromEntries(
                        plan.dependencies.map(d => [d, 'latest'])
                    ),
                    devDependencies: Object.fromEntries(
                        plan.devDependencies.map(d => [d, 'latest'])
                    )
                }, null, 2);

            case 'tsconfig.json':
                return JSON.stringify({
                    compilerOptions: {
                        target: 'ES2020',
                        module: 'ESNext',
                        moduleResolution: 'bundler',
                        strict: true,
                        jsx: 'react-jsx',
                        esModuleInterop: true,
                        skipLibCheck: true,
                        outDir: 'dist'
                    },
                    include: ['src']
                }, null, 2);

            case '.gitignore':
                return `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`;

            case '.env.example':
                return `DATABASE_URL=
API_KEY=
SECRET_KEY=
`;

            default:
                return `// ${filename}\n`;
        }
    }
}
