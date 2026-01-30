import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ManagerAgent } from './ManagerAgent';
import { TaskNode, AgentOutput, AgentStatus } from './AgentTypes';
import { ExecutorAgent } from '../agents/ExecutorAgent';
import { VersionControllerAgent } from '../agents/VersionControllerAgent';
import { CodeModifierAgent } from '../agents/CodeModifierAgent';
import { CodeGeneratorAgent } from '../agents/CodeGeneratorAgent';
import { TaskPlannerAgent, TaskPlannerResult } from '../agents/TaskPlannerAgent';
import { ContextSearchAgent } from '../agents/ContextSearchAgent';
import { PersonaManager, PersonaType } from './PersonaManager';

export interface AgenticAction {
    type: 'create_file' | 'modify_file' | 'run_command' | 'create_directory' | 'delete_file' | 'partial_edit' | 'create_folder';
    path?: string;
    content?: string;
    command?: string;
    description: string;
    result?: string;
    success?: boolean;
}

export interface AgenticResult {
    success: boolean;
    actions: AgenticAction[];
    summary: string;
    checkpointId?: string;
}

export class AgentOrchestrator {
    private managerAgent: ManagerAgent;
    private executorAgent: ExecutorAgent;
    private versionController: VersionControllerAgent;
    private codeModifier: CodeModifierAgent;
    private codeGenerator: CodeGeneratorAgent;
    private taskPlanner: TaskPlannerAgent;
    private contextSearch: ContextSearchAgent;
    private personaManager: PersonaManager;
    private workspaceRoot: string;

    // State management
    private currentAgentMode: 'plan' | 'build' = 'build';
    private currentContext: { message: string; filePath?: string } = { message: '' };

    constructor(private context: vscode.ExtensionContext) {
        this.managerAgent = new ManagerAgent();
        this.executorAgent = new ExecutorAgent();
        this.versionController = new VersionControllerAgent(context);
        this.codeModifier = new CodeModifierAgent();
        this.codeGenerator = new CodeGeneratorAgent();
        this.taskPlanner = new TaskPlannerAgent();
        this.contextSearch = new ContextSearchAgent(context);
        this.personaManager = new PersonaManager();
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    // =========================================================================
    // Core Architecture: "Think-Act-Verify" Loop
    // =========================================================================

    /**
     * Main Entry Point: Execute a user request end-to-end
     * Implements the "Think-Act-Verify" loop
     */
    public async executeRequest(query: string, activeFilePath?: string): Promise<string> {
        try {
            // 1. THINK: Generate a Plan
            console.log('[AgentOrchestrator] Phase 1: Planning...');
            const fileStructure = await this.getFileStructure();
            const projectType = await this.detectProjectType();

            const planResult = await this.taskPlanner.execute({
                query,
                projectType,
                fileStructure,
                activeFilePath,
                interfaces: []
            });

            if (planResult.status !== 'success' || !planResult.payload || planResult.payload.taskGraph.length === 0) {
                return `Failed to generate a valid plan. Error: ${planResult.error?.message || 'Unknown planning error'}`;
            }

            const tasks = planResult.payload.taskGraph;
            console.log(`[AgentOrchestrator] Generated ${tasks.length} tasks.`);

            // 2. ACT & VERIFY: Execute the plan
            console.log('[AgentOrchestrator] Phase 2: Execution & Verification...');
            await this.executeTaskGraph(tasks, query);

            return "Request completed successfully.";

        } catch (error) {
            console.error('[AgentOrchestrator] Execution failed:', error);
            return `Execution failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /**
     * Execute a graph of tasks, handling dependencies and verification
     */
    private async executeTaskGraph(tasks: TaskNode[], originalQuery: string): Promise<void> {
        const completedTasks = new Set<string>();
        const taskMap = new Map(tasks.map(t => [t.id, t]));

        for (const task of tasks) {
            // Check dependencies
            const pendingDeps = task.dependencies.filter(d => !completedTasks.has(d) && taskMap.has(d));
            if (pendingDeps.length > 0) {
                throw new Error(`Task ${task.id} (${task.description}) cannot start because dependencies ${pendingDeps.join(', ')} are not complete.`);
            }

            console.log(`[AgentOrchestrator] Executing Task: ${task.description} (${task.assignedAgent})`);

            try {
                await this.executeSingleTask(task, originalQuery);
                completedTasks.add(task.id);
            } catch (error) {
                // RECOVER: Try to fix the error
                console.warn(`[AgentOrchestrator] Task failed: ${task.description}. Attempting recovery...`);
                const recovered = await this.attemptRecovery(task, error as Error, originalQuery);
                if (!recovered) {
                    throw new Error(`Task ${task.id} failed and recovery was unsuccessful: ${(error as Error).message}`);
                }
                completedTasks.add(task.id);
            }
        }
    }

    private async executeSingleTask(task: TaskNode, contextQuery: string): Promise<void> {
        const agentName = task.assignedAgent || 'Executor'; 
        
        if (agentName === 'CodeGenerator') {
            const singleTaskPlan: TaskPlannerResult = {
                taskGraph: [task],
                executionOrder: [task.id],
                validationCommands: [],
                criticalPath: []
            };
            await this.codeGenerator.execute({
                taskPlan: singleTaskPlan,
                codePlan: { 
                    fileStructure: [], 
                    interfaces: [],
                    dependencies: [],
                    devDependencies: [],
                    configFiles: [],
                    folderPurposes: []
                }, 
                context: { knowledge: [{ summary: contextQuery, relevance: 1 }] }
            });
            
        } else if (agentName === 'Executor') {
             const commandToRun = task.command || (task.type === 'command' ? task.description : null);
             if (commandToRun) {
                 await this.executorAgent.execute({
                     command: commandToRun,
                     cwd: this.workspaceRoot
                 });
             } else if (task.validationCommand) {
                  await this.executorAgent.execute({
                     command: task.validationCommand,
                     cwd: this.workspaceRoot
                  });
             }
        } else if (agentName === 'CodeModifier') {
             // Redirect CodeModifier tasks to CodeGenerator for now, as CodeModifier requires precise diffs
             // and CodeGenerator is capable of handling modification instructions via LLM
             const singleTaskPlan: TaskPlannerResult = {
                taskGraph: [task],
                executionOrder: [task.id],
                validationCommands: [],
                criticalPath: []
            };
             await this.codeGenerator.execute({
                 taskPlan: singleTaskPlan,
                 codePlan: { 
                    fileStructure: [], 
                    interfaces: [],
                    dependencies: [],
                    devDependencies: [],
                    configFiles: [],
                    folderPurposes: []
                },
                 context: { knowledge: [{ summary: contextQuery, relevance: 1 }] }
             });
        }

        // VERIFY
        if (task.validationCommand) {
            console.log(`[AgentOrchestrator] Verifying task with: ${task.validationCommand}`);
            const validation = await this.executorAgent.execute({
                command: task.validationCommand,
                cwd: this.workspaceRoot
            });
            
            if (validation.status === 'failed' || (validation.payload && validation.payload.exitCode !== 0)) {
                throw new Error(`Validation failed for task ${task.id}: ${validation.payload?.stderr || 'Unknown error'}`);
            }
        }
    }

    private async attemptRecovery(failedTask: TaskNode, error: Error, contextQuery: string): Promise<boolean> {
        const recoveryQuery = `Task '${failedTask.description}' failed with error: ${error.message}. Fix it. Context: ${contextQuery}`;
        console.log(`[AgentOrchestrator] Generating recovery plan for: ${failedTask.id}`);

        const recoveryPlan = await this.taskPlanner.execute({
            query: recoveryQuery,
            projectType: 'recovery',
            fileStructure: [],
            activeFilePath: failedTask.filePath,
            interfaces: []
        });

        if (recoveryPlan.status === 'success' && recoveryPlan.payload && recoveryPlan.payload.taskGraph.length > 0) {
            try {
                await this.executeTaskGraph(recoveryPlan.payload.taskGraph, contextQuery);
                return true;
            } catch (e) {
                console.error('Recovery failed:', e);
                return false;
            }
        }
        return false;
    }

    // =========================================================================
    // Compatibility Layer for ChatViewProvider (Legacy Support)
    // =========================================================================

    public setAgentMode(mode: 'plan' | 'build') {
        this.currentAgentMode = mode;
    }

    public async clearAllData() {
        this.currentContext = { message: '' };
        await this.versionController.execute({ action: 'delete_session_checkpoints', sessionId: 'current' });
    }

    public setContextFromMessage(message: string, filePath?: string) {
        this.currentContext = { message, filePath };
    }

    public detectPersona(message: string, intent: string): PersonaType {
        return this.personaManager.detectPersona(message, intent);
    }

    /**
     * Parses the raw text response from the LLM to extract XML actions.
     * Used by ChatViewProvider to enable conversational actions.
     */
    public parseAIResponse(response: string, persona: PersonaType): AgenticAction[] {
        const actions: AgenticAction[] = [];
        // Regex to capture content inside <byte_action> tags
        // Handles multiline content with [\s\S]*?
        const regex = /<byte_action\s+type="([^"]+)"(?:\s+path="([^"]+)")?(?:\s+command="([^"]+)")?>([\s\S]*?)<\/byte_action>/g;
        
        let match;
        while ((match = regex.exec(response)) !== null) {
            const [fullMatch, type, pathAttr, commandAttr, content] = match;
            
            // Clean up content (remove leading/trailing whitespace/newlines)
            const cleanContent = content ? content.trim() : '';
            
            actions.push({
                type: type as any,
                path: pathAttr,
                command: commandAttr,
                content: cleanContent,
                description: `${type} ${pathAttr || commandAttr || ''}`
            });
        }
        
        return actions;
    }

    /**
     * Executes a list of actions extracted from the chat response.
     * Used by ChatViewProvider.
     */
    public async executeInstructions(
        actions: AgenticAction[], 
        onProgress: (msg: string) => void
    ): Promise<AgenticResult> {
        
        // 1. Check permissions (read-only mode)
        if (this.currentAgentMode === 'plan') {
            return { 
                success: false, 
                actions: [], 
                summary: 'Agent is in Plan Mode (Read-Only). Switch to Build Mode to execute actions.' 
            };
        }

        // 2. Create checkpoint
        const cpResult = await this.versionController.execute({ 
            action: 'create_checkpoint', 
            files: actions.map(a => a.path).filter(p => !!p) as string[],
            description: "Before Agent Execution" 
        });
        const checkpointId = cpResult.payload?.checkpoint?.checkpointId;
        
        const executedActions: AgenticAction[] = [];
        let successCount = 0;

        for (const action of actions) {
            onProgress(`Executing: ${action.description}`);
            
            try {
                let resultMsg = '';
                let success = false;

                switch (action.type) {
                    case 'create_file':
                    case 'modify_file':
                        if (action.path && action.content) {
                            const uri = vscode.Uri.file(path.isAbsolute(action.path) ? action.path : path.join(this.workspaceRoot, action.path));
                            // Ensure directory exists
                            await vscode.workspace.fs.createDirectory(vscode.Uri.parse(path.dirname(uri.fsPath)));
                            await vscode.workspace.fs.writeFile(uri, Buffer.from(action.content));
                            resultMsg = `Successfully wrote to ${action.path}`;
                            success = true;
                        } else {
                            resultMsg = 'Missing path or content';
                        }
                        break;
                    
                    case 'create_folder':
                    case 'create_directory':
                        if (action.path) {
                             const uri = vscode.Uri.file(path.isAbsolute(action.path) ? action.path : path.join(this.workspaceRoot, action.path));
                             await vscode.workspace.fs.createDirectory(uri);
                             resultMsg = `Created directory ${action.path}`;
                             success = true;
                        }
                        break;

                    case 'delete_file':
                        if (action.path) {
                             const uri = vscode.Uri.file(path.isAbsolute(action.path) ? action.path : path.join(this.workspaceRoot, action.path));
                             await vscode.workspace.fs.delete(uri);
                             resultMsg = `Deleted ${action.path}`;
                             success = true;
                        }
                        break;

                    case 'run_command':
                        const cmd = action.command || action.content;
                        if (cmd) {
                            const result = await this.executorAgent.execute({
                                command: cmd,
                                cwd: this.workspaceRoot
                            });
                            
                            if (result.status === 'success') {
                                resultMsg = `Command output: ${result.payload?.stdout?.slice(0, 100)}...`;
                                success = true;
                            } else {
                                resultMsg = `Command failed: ${result.payload?.stderr}`;
                            }
                        }
                        break;
                        
                    case 'partial_edit':
                        if (action.path && action.content) {
                            // Parse <search> and <replace> from the content
                            // Content is expected to be:
                            // <search>...</search>
                            // <replace>...</replace>
                            const searchMatch = /<search>([\s\S]*?)<\/search>/.exec(action.content);
                            const replaceMatch = /<replace>([\s\S]*?)<\/replace>/.exec(action.content);
                            
                            if (searchMatch) {
                                const searchBlock = searchMatch[1]; 
                                const replaceBlock = replaceMatch ? replaceMatch[1] : '';
                                
                                // Delegate to CodeModifierAgent for robust fuzzy matching and application
                                const modification = {
                                    filePath: path.isAbsolute(action.path) ? action.path : path.join(this.workspaceRoot, action.path),
                                    searchBlock: searchBlock,
                                    replaceBlock: replaceBlock,
                                    action: 'replace' as const, // Default to replace
                                    startLine: -1, // Let CodeModifier find it
                                    endLine: -1
                                };
                                
                                const modResult = await this.codeModifier.execute({
                                    modifications: [modification],
                                    dryRun: false,
                                    createCheckpoint: false // We already created a checkpoint at the start of executeInstructions
                                });
                                
                                if (modResult.status === 'success' && modResult.payload?.results[0]?.success) {
                                    resultMsg = `Successfully edited ${action.path}`;
                                    success = true;
                                } else {
                                    const err = modResult.payload?.results[0]?.error || modResult.error?.message || 'Unknown error';
                                    resultMsg = `Edit failed: ${err}`;
                                }
                            } else {
                                resultMsg = 'Missing <search> block in partial_edit content. Format: <search>...</search><replace>...</replace>';
                            }
                        } else {
                             resultMsg = 'Missing path or content for partial_edit';
                        }
                        break;
                }

                executedActions.push({
                    ...action,
                    result: resultMsg,
                    success
                });

                if (success) successCount++;

            } catch (error: any) {
                console.error(`Action failed: ${action.type}`, error);
                executedActions.push({
                    ...action,
                    result: `Error: ${error.message}`,
                    success: false
                });
            }
        }

        return {
            success: successCount === actions.length,
            actions: executedActions,
            summary: `Executed ${successCount}/${actions.length} actions.`,
            checkpointId
        };
    }

    // Helpers
    private async getFileStructure(): Promise<string[]> {
        if (!this.workspaceRoot) return [];
        try {
            // Simple recursive read or top-level
            const files = await fs.promises.readdir(this.workspaceRoot);
            return files;
        } catch {
            return [];
        }
    }

    private async detectProjectType(): Promise<string> {
        const files = await this.getFileStructure();
        if (files.includes('package.json')) return 'node';
        if (files.includes('requirements.txt') || files.includes('pyproject.toml')) return 'python';
        if (files.includes('Cargo.toml')) return 'rust';
        if (files.includes('go.mod')) return 'go';
        return 'generic';
    }

    public getLastReferencedFile(): string | null {
        return this.currentContext.filePath || null;
    }
}