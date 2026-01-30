/**
 * EnhancedOrchestrator - Superior task execution with advanced analytics
 * Integrates enhanced analysis for intelligent task decomposition and execution
 */

import * as vscode from 'vscode';
import { ManagerAgent } from './ManagerAgent';
import { TaskNode, AgentOutput, AgentStatus } from '../core/AgentTypes';
import { ExecutorAgent } from '../agents/ExecutorAgent';
import { VersionControllerAgent } from '../agents/VersionControllerAgent';
import { CodeModifierAgent } from '../agents/CodeModifierAgent';
import { CodeGeneratorAgent } from '../agents/CodeGeneratorAgent';
import { TaskPlannerAgent, TaskPlannerResult } from '../agents/TaskPlannerAgent';
import { ContextSearchAgent } from '../agents/ContextSearchAgent';
import { ArchitectAgent, ArchitectureDesign } from '../agents/ArchitectAgent';
import { PersonaManager, PersonaType } from './PersonaManager';
import { EnhancedAnalyzerAgent, EnhancedAnalysisInput, EnhancedAnalysisResult } from '../agents/EnhancedAnalyzerAgent';
import { QualityAssuranceAgent } from '../agents/QualityAssuranceAgent';

export interface EnhancedExecutionOptions {
    analysisDepth: 'quick' | 'deep' | 'comprehensive';
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
    parallelism: 'minimal' | 'moderate' | 'maximum';
    validationMode: 'strict' | 'standard' | 'relaxed';
    autoRecovery: boolean;
    checkpointing: boolean;
}

export interface EnhancedExecutionResult {
    success: boolean;
    analysis: EnhancedAnalysisResult;
    tasks: TaskNode[];
    executionOrder: string[];
    validationResults: any[];
    performanceMetrics: {
        totalTime: number;
        analysisTime: number;
        planningTime: number;
        executionTime: number;
        validationTime: number;
        parallelizationEfficiency: number;
    };
    checkpoints: string[];
    recommendations: string[];
}

export class EnhancedOrchestrator {
    private managerAgent: ManagerAgent;
    private executorAgent: ExecutorAgent;
    private versionController: VersionControllerAgent;
    private codeModifier: CodeModifierAgent;
    private codeGenerator: CodeGeneratorAgent;
    private taskPlanner: TaskPlannerAgent;
    private contextSearch: ContextSearchAgent;
    private architect: ArchitectAgent;
    private personaManager: PersonaManager;
    private enhancedAnalyzer: EnhancedAnalyzerAgent;
    private qualityAssurance: QualityAssuranceAgent;
    private workspaceRoot: string;

    constructor(private context: vscode.ExtensionContext) {
        this.managerAgent = new ManagerAgent();
        this.executorAgent = new ExecutorAgent();
        this.versionController = new VersionControllerAgent(context);
        this.codeModifier = new CodeModifierAgent();
        this.codeGenerator = new CodeGeneratorAgent();
        this.taskPlanner = new TaskPlannerAgent();
        this.contextSearch = new ContextSearchAgent(context);
        this.architect = new ArchitectAgent();
        this.personaManager = new PersonaManager();
        this.enhancedAnalyzer = new EnhancedAnalyzerAgent();
        this.qualityAssurance = new QualityAssuranceAgent();
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    /**
     * Main enhanced execution method with superior analytical capabilities
     */
    public async executeEnhanced(
        query: string, 
        options: Partial<EnhancedExecutionOptions> = {},
        activeFilePath?: string
    ): Promise<EnhancedExecutionResult> {
        const startTime = Date.now();
        const mergedOptions = this.mergeOptions(options);

        try {
            console.log('[EnhancedOrchestrator] Starting enhanced execution with superior analytics...');

            // Phase 1: Deep Analysis
            const analysisStartTime = Date.now();
            const analysis = await this.performEnhancedAnalysis(query, activeFilePath, mergedOptions);
            const analysisTime = Date.now() - analysisStartTime;

            // Phase 2: Intelligent Planning
            const planningStartTime = Date.now();
            const { tasks, executionOrder } = await this.performIntelligentPlanning(query, analysis, activeFilePath);
            const planningTime = Date.now() - planningStartTime;

            // Phase 3: Adaptive Execution
            const executionStartTime = Date.now();
            const executionResults = await this.performAdaptiveExecution(tasks, executionOrder, query, mergedOptions);
            const executionTime = Date.now() - executionStartTime;

            // Phase 4: Comprehensive Validation
            const validationStartTime = Date.now();
            const validationResults = await this.performComprehensiveValidation(tasks, mergedOptions);
            const validationTime = Date.now() - validationStartTime;

            // Phase 5: Generate Recommendations
            const recommendations = await this.generateRecommendations(analysis, executionResults, validationResults);

            const totalTime = Date.now() - startTime;

            return {
                success: executionResults.success,
                analysis,
                tasks,
                executionOrder,
                validationResults,
                performanceMetrics: {
                    totalTime,
                    analysisTime,
                    planningTime,
                    executionTime,
                    validationTime,
                    parallelizationEfficiency: this.calculateParallelizationEfficiency(tasks, executionTime)
                },
                checkpoints: [], // Would be populated from version controller
                recommendations
            };

        } catch (error) {
            console.error('[EnhancedOrchestrator] Enhanced execution failed:', error);
            
            // Attempt graceful recovery
            if (mergedOptions.autoRecovery) {
                return await this.attemptGracefulRecovery(query, error as Error, activeFilePath, mergedOptions);
            }
            
            throw error;
        }
    }

    private mergeOptions(options: Partial<EnhancedExecutionOptions>): EnhancedExecutionOptions {
        return {
            analysisDepth: options.analysisDepth ?? 'comprehensive',
            riskTolerance: options.riskTolerance ?? 'moderate',
            parallelism: options.parallelism ?? 'maximum',
            validationMode: options.validationMode ?? 'strict',
            autoRecovery: options.autoRecovery ?? true,
            checkpointing: options.checkpointing ?? true
        };
    }

    private async performEnhancedAnalysis(
        query: string, 
        activeFilePath: string | undefined, 
        options: EnhancedExecutionOptions
    ): Promise<EnhancedAnalysisResult> {
        const fileStructure = await this.getFileStructure();
        const projectType = await this.detectProjectType();

        const analysisInput: EnhancedAnalysisInput = {
            query,
            codebaseContext: {
                files: fileStructure,
                activeFile: activeFilePath,
                projectType
            },
            targetFiles: activeFilePath ? [activeFilePath] : undefined,
            analysisDepth: options.analysisDepth
        };

        const result = await this.enhancedAnalyzer.execute(analysisInput);
        if (result.status !== 'success' || !result.payload) {
            throw new Error(`Enhanced analysis failed: ${result.error?.message || 'Unknown error'}`);
        }

        return result.payload;
    }

    private async performIntelligentPlanning(
        query: string,
        analysis: EnhancedAnalysisResult,
        activeFilePath?: string
    ): Promise<{ tasks: TaskNode[], executionOrder: string[] }> {
        // Use the analysis to guide planning
        const fileStructure = await this.getFileStructure();
        const projectType = await this.detectProjectType();

        // Create architecture design if needed
        let design: ArchitectureDesign | undefined;
        if (analysis.intentClassification.complexity === 'complex') {
            const designResult = await this.architect.execute({
                query,
                projectType,
                existingFiles: fileStructure
            });
            if (designResult.status === 'success' && designResult.payload) {
                design = designResult.payload;
            }
        }

        // Enhanced task planning with analysis guidance
        const planResult = await this.taskPlanner.execute({
            query,
            projectType,
            fileStructure,
            activeFilePath,
            interfaces: [],
            design,
            // Pass analysis insights to guide planning
            analysisContext: {
                complexity: analysis.intentClassification.complexity,
                recommendedAgents: analysis.executionStrategy.recommendedAgents,
                riskLevel: analysis.executionStrategy.riskLevel,
                approach: analysis.executionStrategy.approach
            }
        } as any);

        if (planResult.status !== 'success' || !planResult.payload) {
            throw new Error(`Intelligent planning failed: ${planResult.error?.message || 'Unknown error'}`);
        }

        return {
            tasks: planResult.payload.taskGraph,
            executionOrder: planResult.payload.executionOrder
        };
    }

    private async performAdaptiveExecution(
        tasks: TaskNode[],
        executionOrder: string[],
        originalQuery: string,
        options: EnhancedExecutionOptions
    ): Promise<{ success: boolean, results: any[] }> {
        console.log('[EnhancedOrchestrator] Starting adaptive execution with intelligent parallelization...');

        const completedTasks = new Set<string>();
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        let remainingTasks = [...tasks];
        const results: any[] = [];

        // Create checkpoint if enabled
        let checkpointId: string | undefined;
        if (options.checkpointing) {
            const cpResult = await this.versionController.execute({
                action: 'create_checkpoint',
                files: tasks.map(t => t.filePath).filter(Boolean) as string[],
                description: 'Before enhanced execution'
            });
            checkpointId = cpResult.payload?.checkpoint?.checkpointId;
        }

        while (remainingTasks.length > 0) {
            // Adaptive task selection based on dependencies and parallelism settings
            const executableTasks = this.selectExecutableTasks(
                remainingTasks, 
                completedTasks, 
                options.parallelism,
                options.riskTolerance
            );

            if (executableTasks.length === 0) {
                throw new Error(`No executable tasks found. Remaining: ${remainingTasks.map(t => t.id).join(', ')}`);
            }

            console.log(`[EnhancedOrchestrator] Executing adaptive batch of ${executableTasks.length} tasks...`);

            // Execute tasks with adaptive parallelization
            const batchPromises = executableTasks.map(async (task) => {
                const taskStartTime = Date.now();
                try {
                    const result = await this.executeTaskWithEnhancedContext(task, originalQuery, await this.performEnhancedAnalysis(originalQuery, undefined, options));
                    const taskTime = Date.now() - taskStartTime;
                    
                    return {
                        taskId: task.id,
                        success: true,
                        result,
                        executionTime: taskTime,
                        metrics: {
                            agent: task.assignedAgent,
                            complexity: task.complexity,
                            riskAssessment: this.assessTaskRisk(task)
                        }
                    };
                } catch (error) {
                    const taskTime = Date.now() - taskStartTime;
                    
                    // Enhanced error handling with recovery
                    if (options.autoRecovery) {
                        const recoveryResult = await this.attemptTaskRecovery(task, error as Error, originalQuery);
                        if (recoveryResult.success) {
                            return {
                                taskId: task.id,
                                success: true,
                                result: recoveryResult.result,
                                executionTime: taskTime,
                                recovered: true
                            };
                        }
                    }
                    
                    return {
                        taskId: task.id,
                        success: false,
                        error: error as Error,
                        executionTime: taskTime
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Update completed tasks
            const successfulTasks = batchResults.filter(r => r.success);
            successfulTasks.forEach(r => completedTasks.add(r.taskId));

            // Handle failed tasks
            const failedTasks = batchResults.filter(r => !r.success);
            if (failedTasks.length > 0) {
                const failedIds = failedTasks.map(r => r.taskId).join(', ');
                throw new Error(`Tasks failed: ${failedIds}. Errors: ${failedTasks.map(r => (r.error as Error).message).join('; ')}`);
            }

            // Update remaining tasks
            remainingTasks = remainingTasks.filter(t => !completedTasks.has(t.id));
        }

        return {
            success: true,
            results
        };
    }

    private selectExecutableTasks(
        remainingTasks: TaskNode[],
        completedTasks: Set<string>,
        parallelism: 'minimal' | 'moderate' | 'maximum',
        riskTolerance: 'conservative' | 'moderate' | 'aggressive'
    ): TaskNode[] {
        // Find all tasks with dependencies satisfied
        const readyTasks = remainingTasks.filter(task => 
            task.dependencies.every(dep => completedTasks.has(dep))
        );

        // Apply parallelism and risk filters
        let executableTasks = [...readyTasks];

        // Risk-based filtering
        if (riskTolerance === 'conservative') {
            // Only execute low-risk tasks in parallel
            executableTasks = executableTasks.filter(t => 
                this.assessTaskRisk(t) === 'low' || !readyTasks.find(rt => rt.id !== t.id && this.assessTaskRisk(rt) === 'low')
            );
        }

        // Parallelism limits
        if (parallelism === 'minimal') {
            return executableTasks.slice(0, 1);
        } else if (parallelism === 'moderate') {
            return executableTasks.slice(0, Math.min(3, executableTasks.length));
        } else {
            return executableTasks;
        }
    }

    private assessTaskRisk(task: TaskNode): 'low' | 'medium' | 'high' {
        if (task.complexity === 'complex') return 'high';
        if (task.complexity === 'medium') return 'medium';
        if (task.type === 'command' && task.command?.includes('rm') || task.command?.includes('delete')) return 'high';
        if (task.type === 'command' && task.command?.includes('npm install') || task.command?.includes('pip install')) return 'medium';
        return 'low';
    }

    private async executeTaskWithEnhancedContext(
        task: TaskNode,
        contextQuery: string,
        analysis: EnhancedAnalysisResult
    ): Promise<any> {
        // Enhanced task execution with context awareness
        const agentName = task.assignedAgent || 'Executor';
        
        if (agentName === 'CodeGenerator') {
            const singleTaskPlan: TaskPlannerResult = {
                taskGraph: [task],
                executionOrder: [task.id],
                validationCommands: [],
                criticalPath: []
            };
            
            return await this.codeGenerator.execute({
                taskPlan: singleTaskPlan,
                codePlan: { 
                    fileStructure: [], 
                    interfaces: [],
                    dependencies: [],
                    devDependencies: [],
                    configFiles: [],
                    folderPurposes: []
                }, 
                context: { 
                    knowledge: analysis.contextualKnowledge.relevantFiles.map(r => ({
                        summary: r.reason,
                        relevance: r.confidence
                    }))
                }
            });
        } else if (agentName === 'Executor') {
            const commandToRun = task.command || (task.type === 'command' ? task.description : null);
            if (commandToRun) {
                return await this.executorAgent.execute({
                    command: commandToRun,
                    cwd: this.workspaceRoot
                });
            }
        } else if (agentName === 'CodeModifier') {
            // Enhanced modification with analysis context
            const modifications = [{
                filePath: task.filePath || '',
                searchBlock: '',
                replaceBlock: '',
                action: 'replace' as const,
                startLine: -1,
                endLine: -1
            }];
            
            return await this.codeModifier.execute({
                modifications,
                dryRun: false,
                createCheckpoint: false
            });
        }

        throw new Error(`Unknown agent: ${agentName}`);
    }

    private async performComprehensiveValidation(
        tasks: TaskNode[],
        options: EnhancedExecutionOptions
    ): Promise<any[]> {
        const validationResults: any[] = [];

        for (const task of tasks) {
            if (task.validationCommand) {
                try {
                    const result = await this.executorAgent.execute({
                        command: task.validationCommand,
                        cwd: this.workspaceRoot
                    });
                    
                    validationResults.push({
                        taskId: task.id,
                        success: result.status === 'success',
                        result
                    });
                } catch (error) {
                    validationResults.push({
                        taskId: task.id,
                        success: false,
                        error: error as Error
                    });
                }
            }
        }

        // Additional quality assurance for strict mode
        if (options.validationMode === 'strict') {
            const qaResults = await this.performQualityAssurance(tasks);
            validationResults.push(...qaResults);
        }

        return validationResults;
    }

    private async performQualityAssurance(tasks: TaskNode[]): Promise<any[]> {
        // Implement quality assurance checks
        return [];
    }

    private async generateRecommendations(
        analysis: EnhancedAnalysisResult,
        executionResults: any,
        validationResults: any[]
    ): Promise<string[]> {
        const recommendations: string[] = [];

        // Performance recommendations
        if (executionResults.executionTime > 30000) {
            recommendations.push('Consider increasing parallelism for faster execution');
        }

        // Risk recommendations
        if (analysis.executionStrategy.riskLevel === 'high') {
            recommendations.push('High-risk operation detected - ensure adequate testing');
        }

        // Validation recommendations
        const failedValidations = validationResults.filter(v => !v.success);
        if (failedValidations.length > 0) {
            recommendations.push(`${failedValidations.length} validation(s) failed - review and fix issues`);
        }

        // Architecture recommendations
        if (analysis.codebaseInsights.optimizationOpportunities.length > 0) {
            recommendations.push(`Consider optimizing: ${analysis.codebaseInsights.optimizationOpportunities.join(', ')}`);
        }

        return recommendations;
    }

    private calculateParallelizationEfficiency(tasks: TaskNode[], executionTime: number): number {
        // Simplified efficiency calculation
        const totalComplexity = tasks.reduce((sum, task) => {
            const complexityWeight = task.complexity === 'simple' ? 1 : task.complexity === 'medium' ? 2 : 3;
            return sum + complexityWeight;
        }, 0);
        
        return Math.min(1, totalComplexity / (executionTime / 1000));
    }

    private async attemptGracefulRecovery(
        query: string,
        error: Error,
        activeFilePath: string | undefined,
        options: EnhancedExecutionOptions
    ): Promise<EnhancedExecutionResult> {
        console.log('[EnhancedOrchestrator] Attempting graceful recovery...');

        try {
            // Rollback to checkpoint if available
            await this.versionController.execute({
                action: 'rollback',
                sessionId: 'current'
            });

            // Retry with conservative options
            const conservativeOptions = { ...options, riskTolerance: 'conservative' as const, parallelism: 'minimal' as const };
            return await this.executeEnhanced(query, conservativeOptions, activeFilePath);
        } catch (recoveryError) {
            throw new Error(`Recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
        }
    }

    private async attemptTaskRecovery(
        failedTask: TaskNode,
        error: Error,
        contextQuery: string
    ): Promise<{ success: boolean, result?: any }> {
        console.log(`[EnhancedOrchestrator] Attempting task recovery for: ${failedTask.id}`);

        try {
            const recoveryQuery = `Recover from failed task "${failedTask.description}" with error: ${error.message}. Original context: ${contextQuery}`;
            
            const recoveryPlan = await this.taskPlanner.execute({
                query: recoveryQuery,
                projectType: 'recovery',
                fileStructure: [],
                activeFilePath: failedTask.filePath,
                interfaces: []
            });

            if (recoveryPlan.status === 'success' && recoveryPlan.payload && recoveryPlan.payload.taskGraph.length > 0) {
                // Execute recovery task
                const recoveryTask = recoveryPlan.payload.taskGraph[0];
                const mockAnalysis: EnhancedAnalysisResult = {
                    intentClassification: { primaryIntent: 'Fix', confidence: 0.7, subIntents: [], complexity: 'simple' },
                    codebaseInsights: { architecture: 'Unknown', patterns: [], dependencies: [], potentialIssues: [], optimizationOpportunities: [] },
                    executionStrategy: { approach: 'targeted', riskLevel: 'low', recommendedAgents: [], parallelizableTasks: [], criticalPath: [] },
                    contextualKnowledge: { relevantFiles: [], similarPatterns: [], bestPractices: [], securityConsiderations: [] }
                };
                const result = await this.executeTaskWithEnhancedContext(recoveryTask, recoveryQuery, mockAnalysis);
                
                return { success: true, result };
            }
        } catch (recoveryError) {
            console.error('Task recovery failed:', recoveryError);
        }

        return { success: false };
    }

    // Helper methods
    private async getFileStructure(): Promise<string[]> {
        if (!this.workspaceRoot) return [];
        try {
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.workspaceRoot));
            return files.map(([name]) => name);
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
}