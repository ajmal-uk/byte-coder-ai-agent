/**
 * PipelineEngine - Dynamic pipeline executor for Byte Coder
 * Executes agent pipelines with parallel support, dependency resolution, and error recovery
 */

import * as vscode from 'vscode';
import {
    PipelineStep,
    AgentOutput,
    ManagerDecision,
    ExecutionResult,
    Checkpoint,
    TaskNode,
    PipelineStatus
} from './AgentTypes';

// Agent type imports
import { IntentAnalyzer, SearchIntent } from '../agents/IntentAnalyzer';
import { FileFinderAgent, FileMatch } from '../agents/FileFinderAgent';
import { ContextPlanner, ContextPlan } from '../agents/ContextPlanner';
import { ContextAnalyzer, AnalyzedContext } from '../agents/ContextAnalyzer';
import { ContextSearchAgent } from '../agents/ContextSearchAgent';
import { FilePartSearcherAgent } from '../agents/FilePartSearcherAgent';
import { ProcessPlannerAgent, ProcessPlannerInput } from '../agents/ProcessPlannerAgent';
import { CodePlannerAgent } from '../agents/CodePlannerAgent';
import { TaskPlannerAgent, TaskPlannerResult } from '../agents/TaskPlannerAgent';
import { VersionControllerAgent } from '../agents/VersionControllerAgent';
import { CommandGeneratorAgent } from '../agents/CommandGeneratorAgent';
import { CodeModifierAgent, CodeModifierInput } from '../agents/CodeModifierAgent';
import { CodeGeneratorAgent } from '../agents/CodeGeneratorAgent';
import { ExecutorAgent } from '../agents/ExecutorAgent';
import { DocWriterAgent } from '../agents/DocWriterAgent';
import { TodoManagerAgent, TodoManagerInput } from '../agents/TodoManagerAgent';
import { ArchitectAgent } from '../agents/ArchitectAgent';
import { QualityAssuranceAgent } from '../agents/QualityAssuranceAgent';
import { WebSearchAgent } from '../agents/WebSearchAgent';

export interface PipelineContext {
    query: string;
    activeFilePath?: string;
    selectionText?: string;
    decision: ManagerDecision;
    results: Map<string, AgentOutput>;
    checkpoints: Checkpoint[];
    startTime: number;
    currentPlan?: TaskNode[];
}

type StatusCallback = (status: PipelineStatus) => void;

export class PipelineEngine {
    private intentAnalyzer: IntentAnalyzer;
    private fileFinder: FileFinderAgent;
    private contextPlanner: ContextPlanner;
    private contextAnalyzer: ContextAnalyzer;
    private contextSearch: ContextSearchAgent;
    private filePartSearcher: FilePartSearcherAgent;
    private processPlanner: ProcessPlannerAgent;
    private codePlanner: CodePlannerAgent;
    private taskPlanner: TaskPlannerAgent;
    private versionController: VersionControllerAgent;
    private commandGenerator: CommandGeneratorAgent;
    private codeGenerator: CodeGeneratorAgent;
    private codeModifier: CodeModifierAgent;
    private executor: ExecutorAgent;
    private docWriter: DocWriterAgent;
    private todoManager: TodoManagerAgent;
    private architect: ArchitectAgent;
    private qualityAssurance: QualityAssuranceAgent;
    private webSearch: WebSearchAgent;

    // Agent registry for dynamic dispatch
    private agents: Map<string, any> = new Map();

    constructor() {
        // Initialize agents
        this.intentAnalyzer = new IntentAnalyzer();
        this.fileFinder = new FileFinderAgent();
        this.contextPlanner = new ContextPlanner();
        this.contextAnalyzer = new ContextAnalyzer();
        this.contextSearch = new ContextSearchAgent();
        this.filePartSearcher = new FilePartSearcherAgent();
        this.processPlanner = new ProcessPlannerAgent();
        this.codePlanner = new CodePlannerAgent();
        this.taskPlanner = new TaskPlannerAgent();
        this.versionController = new VersionControllerAgent();
        this.commandGenerator = new CommandGeneratorAgent();
        this.codeGenerator = new CodeGeneratorAgent();
        this.codeModifier = new CodeModifierAgent();
        this.executor = new ExecutorAgent();
        this.docWriter = new DocWriterAgent();
        this.todoManager = new TodoManagerAgent();
        this.architect = new ArchitectAgent();
        this.qualityAssurance = new QualityAssuranceAgent();
        this.webSearch = new WebSearchAgent();

        // Register agents
        this.agents.set('IntentAnalyzer', this.intentAnalyzer);
        this.agents.set('FileSearch', this.fileFinder);
        this.agents.set('ContextPlanner', this.contextPlanner);
        this.agents.set('ContextAnalyzer', this.contextAnalyzer);
        this.agents.set('ContextSearch', this.contextSearch);
        this.agents.set('FilePartSearcher', this.filePartSearcher);
        this.agents.set('WebSearch', this.webSearch);
        this.agents.set('ProcessPlanner', this.processPlanner);
        this.agents.set('CodePlanner', this.codePlanner);
        this.agents.set('TaskPlanner', this.taskPlanner);
        this.agents.set('VersionController', this.versionController);
        this.agents.set('CommandGenerator', this.commandGenerator);
        this.agents.set('CodeGenerator', this.codeGenerator);
        this.agents.set('CodeModifier', this.codeModifier);
        this.agents.set('Executor', this.executor);
        this.agents.set('DocWriter', this.docWriter);
        this.agents.set('TodoManager', this.todoManager);
        this.agents.set('Architect', this.architect);
        this.agents.set('QualityAssurance', this.qualityAssurance);
        this.agents.set('ContentRetriever', { name: 'ContentRetriever' });
    }

    /**
     * Execute a pipeline from a manager decision
     */
    async execute(
        decision: ManagerDecision,
        query: string,
        activeFilePath?: string,
        selectionText?: string,
        onStatus?: StatusCallback
    ): Promise<{
        context: string;
        results: Map<string, AgentOutput>;
        debugSummary: string;
    }> {
        const context: PipelineContext = {
            query,
            activeFilePath,
            selectionText,
            decision,
            results: new Map(),
            checkpoints: [],
            startTime: Date.now(),
            currentPlan: undefined
        };

        const totalSteps = decision.pipeline.length;
        let completedSteps = 0;

        // Group steps by parallel execution capability
        const stepGroups = this.groupSteps(decision.pipeline);
        const executionQueue = [...stepGroups];

        while (executionQueue.length > 0) {
            const group = executionQueue.shift()!;

            // Update plan status to in_progress
            group.forEach(step => this.updatePlanStatus(context, step.agent, 'in_progress'));

            // Emit status
            this.emitStatus(onStatus, {
                phase: this.getPhaseForAgent(group[0].agent),
                currentAgent: group.map(s => s.agent).join(', '),
                progress: Math.round((completedSteps / totalSteps) * 100),
                message: group.length > 1
                    ? `Running parallel agents: ${group.map(s => s.agent).join(', ')}`
                    : `Running ${group[0].agent}...`,
                isComplete: false,
                hasError: false,
                plan: context.currentPlan,
                activeTaskId: this.getActiveTaskId(context, group[0].agent)
            });

            if (group.length === 1) {
                // Sequential execution
                await this.executeStep(group[0], context);
            } else {
                // Parallel execution
                await Promise.all(group.map(step => this.executeStep(step, context)));
            }

            // Check for QA failures and handle loop
            if (group.some(step => step.agent === 'QualityAssurance')) {
                 const qaResult = context.results.get('QualityAssurance');
                 if (qaResult && qaResult.status === 'success' && qaResult.payload && !qaResult.payload.passed) {
                     // QA failed (logical failure)
                     // Check retry count
                     const retryCount = (context as any).retryCount || 0;
                     if (retryCount < 3) {
                         (context as any).retryCount = retryCount + 1;
                         
                         const qaIssues = (qaResult.payload.issues || []).map((i: any) => i.description).join('; ');
                         
                         this.emitStatus(onStatus, {
                            phase: 'Quality Assurance',
                            currentAgent: 'QualityAssurance',
                            progress: Math.round((completedSteps / totalSteps) * 100),
                            message: `QA Failed. Retrying (Attempt ${retryCount + 1}/3)... Issues: ${qaIssues}`,
                            isComplete: false,
                            hasError: false,
                            plan: context.currentPlan,
                            activeTaskId: this.getActiveTaskId(context, 'QualityAssurance')
                         });

                         // Create recovery steps
                         // We need to re-run CodeModifier -> Executor -> QualityAssurance
                         // We pass the QA issues as instruction to CodeModifier
                         // Since CodeModifier usually takes input from CodeGenerator, we need to adapt it.
                         // But CodeModifier is designed to take `modifications` list.
                         // Here we want it to "Fix issues".
                         // We might need to run `CodeGenerator` again to generate the fix first.
                         
                         // Let's invoke CodeGenerator with a specific "Fix" task
                         const fixTask: TaskNode = {
                             id: `qa-fix-${Date.now()}`,
                             description: `Fix QA issues: ${qaIssues}`,
                             dependencies: [],
                             status: 'pending'
                         };

                         // We can't easily invoke CodeGenerator here directly as a step without arguments.
                         // But we can add steps to the queue.
                         
                         // We need a way to pass arguments to the steps in the queue.
                         // The `PipelineStep` has `args`.
                         
                         // 1. CodeGenerator (to generate fix modifications)
                         const existingCodePlan = context.results.get('CodePlanner')?.payload;
                         const codeGenStep: PipelineStep = {
                             step: 900 + retryCount * 3,
                             agent: 'CodeGenerator',
                             parallel: false,
                             args: { 
                                 taskPlan: { taskGraph: [fixTask], executionOrder: [fixTask.id] },
                                 codePlan: existingCodePlan || { fileStructure: [], interfaces: [] }, // Fallback
                                 context: {
                                     knowledge: [{ summary: `Fix QA Issues: ${qaIssues}`, relevance: 1 }]
                                 }
                             }
                         };

                         // 2. CodeModifier (to apply fixes)
                         const codeModStep: PipelineStep = {
                             step: 900 + retryCount * 3 + 1,
                             agent: 'CodeModifier',
                             parallel: false
                         };

                         // 3. Executor (to verify)
                         const execStep: PipelineStep = {
                             step: 900 + retryCount * 3 + 2,
                             agent: 'Executor',
                             parallel: false,
                             args: { runTests: true }
                         };

                         // 4. QualityAssurance (to re-verify)
                         const qaStep: PipelineStep = {
                             step: 900 + retryCount * 3 + 3,
                             agent: 'QualityAssurance',
                             parallel: false,
                             args: { originalRequirements: context.query }
                         };

                         // Add to queue
                         executionQueue.unshift([codeGenStep], [codeModStep], [execStep], [qaStep]);
                     } else {
                         this.emitStatus(onStatus, {
                            phase: 'Quality Assurance',
                            currentAgent: 'QualityAssurance',
                            progress: Math.round((completedSteps / totalSteps) * 100),
                            message: `QA Failed. Max retries reached. Stopping.`,
                            isComplete: false,
                            hasError: true
                         });
                     }
                 }
            }

            // Check for failures
            const groupResults = group.map(step => context.results.get(step.agent));
            const failedStep = group.find(step => {
                const res = context.results.get(step.agent);
                return res?.status === 'failed';
            });

            if (failedStep) {
                const failureRes = context.results.get(failedStep.agent);
                this.updatePlanStatus(context, failedStep.agent, 'failed');

                // Emit failure status
                this.emitStatus(onStatus, {
                    phase: 'Error',
                    currentAgent: failedStep.agent,
                    progress: Math.round((completedSteps / totalSteps) * 100),
                    message: `Pipeline stopped: ${failureRes?.error?.message || 'Unknown error'}`,
                    isComplete: false,
                    hasError: true,
                    plan: context.currentPlan,
                    activeTaskId: this.getActiveTaskId(context, failedStep.agent)
                });

                // Add a dynamic "Fix/Recovery" task if we have a plan
                if (context.currentPlan) {
                    const failedTaskIndex = this.getTaskIndexForAgent(failedStep.agent);
                    if (failedTaskIndex >= 0) {
                        // Add recovery task
                        const recoveryTask: TaskNode = {
                            id: `recovery-${Date.now()}`,
                            description: `Fix issues from ${failedStep.agent} failure`,
                            dependencies: [context.currentPlan[failedTaskIndex].id],
                            status: 'pending'
                        };
                        context.currentPlan.splice(failedTaskIndex + 1, 0, recoveryTask);

                        // Emit updated plan
                        this.emitStatus(onStatus, {
                            phase: 'Planning',
                            currentAgent: 'TaskPlanner',
                            progress: Math.round((completedSteps / totalSteps) * 100),
                            message: 'Added recovery task to plan',
                            isComplete: false,
                            hasError: true, // Keep error flag so UI knows
                            plan: context.currentPlan
                        });
                    }
                }

                // Stop execution for now (until we implement actual recovery agent loop)
                break;
            }

            // Update plan status to completed for successful steps
            group.forEach(step => this.updatePlanStatus(context, step.agent, 'completed'));

            // Update plan if TaskPlanner was executed
            if (context.results.has('TaskPlanner')) {
                const taskResult = context.results.get('TaskPlanner')?.payload as TaskPlannerResult;
                if (taskResult && taskResult.taskGraph) {
                    context.currentPlan = taskResult.taskGraph;

                    // Retroactively update plan for steps that already ran
                    this.retroactivePlanUpdate(context);

                    // Emit status with new plan
                    this.emitStatus(onStatus, {
                        phase: 'Planning',
                        currentAgent: 'TaskPlanner',
                        progress: Math.round(((completedSteps + 1) / totalSteps) * 100),
                        message: 'Implementation plan generated',
                        isComplete: false,
                        hasError: false,
                        plan: context.currentPlan
                    });
                }
            }

            completedSteps += group.length;
        }

        // Build final context output
        let contextOutput = '';
        if (context.results.has('ContextAnalyzer')) {
            const analysis = context.results.get('ContextAnalyzer')?.payload as AnalyzedContext;
            contextOutput = analysis ? analysis.summary : await this.buildContext(context);
        } else {
            contextOutput = await this.buildContext(context);
        }

        const debugSummary = this.buildDebugSummary(context);

        this.emitStatus(onStatus, {
            phase: 'Complete',
            currentAgent: '',
            progress: 100,
            message: 'Pipeline execution complete',
            isComplete: true,
            hasError: false,
            plan: context.currentPlan
        });

        return {
            context: contextOutput,
            results: context.results,
            debugSummary
        };
    }

    /**
     * Smart Context Search (New Architecture)
     */
    async search(
        query: string,
        activeFilePath?: string,
        onStatus?: (phase: string, message: string) => void
    ): Promise<string> {
        const statusAdapter: StatusCallback = (status) => {
            onStatus?.(status.phase, status.message);
        };

        const startTime = Date.now();

        // 1. Planning Phase
        this.emitStatus(statusAdapter, {
            phase: 'Planning',
            currentAgent: 'ContextPlanner',
            progress: 10,
            message: 'Thought: Analyzing query to determine context strategy...',
            isComplete: false,
            hasError: false
        });

        const plan = this.contextPlanner.analyze(query, activeFilePath);

        this.emitStatus(statusAdapter, {
            phase: 'Discovery',
            currentAgent: 'FileSearch',
            progress: 30,
            message: `Thought: Strategy determined. Searching for files (Scope: ${plan.scope})...`,
            isComplete: false,
            hasError: false
        });

        // 2. Discovery Phase (Parallel Search)
        // Convert Plan to Search Intent for legacy FileFinder compatibility for now
        // Ideally FileFinder should accept the Plan directly
        const searchIntent: SearchIntent = {
            keywords: plan.searchTerms,
            queryType: mapScopeToQueryType(plan.scope),
            codeTerms: [],
            filePatterns: plan.filePatterns,
            complexity: 'simple',
            mentionedFiles: [],
            symbols: plan.symbolSearch
        };

        const fileMatches = await this.fileFinder.find(searchIntent, activeFilePath) || [];

        // Filter by plan's file patterns if strict
        const filteredFiles = fileMatches.filter(f => {
            // Simple extension check from plan.filePatterns
            if (plan.filePatterns.length === 0) return true;
            return plan.filePatterns.some(pat => f.uri.fsPath.endsWith(pat.replace('*', '')));
        });

        if (filteredFiles.length === 0) {
            return "No relevant files found. Please try clarifying your request.";
        }

        // 3. Analysis Phase (Parallel Processing)
        this.emitStatus(statusAdapter, {
            phase: 'Analysis',
            currentAgent: 'ContextAnalyzer',
            progress: 60,
            message: `Thought: Analyzing ${filteredFiles.length} files for relevance...`,
            isComplete: false,
            hasError: false
        });

        // Read files in parallel
        const fileContents = await Promise.all(filteredFiles.map(async f => {
            try {
                const doc = await vscode.workspace.openTextDocument(f.uri);
                return {
                    uri: f.uri,
                    relativePath: f.relativePath,
                    content: doc.getText(),
                    languageId: doc.languageId
                };
            } catch (e) {
                return null;
            }
        }));

        const validFiles = fileContents.filter(f => f !== null) as any[];

        // Analyze
        const analysis = this.contextAnalyzer.analyze(
            validFiles,
            plan.searchTerms,
            plan.symbolSearch,
            20000 // Token limit
        );

        this.emitStatus(statusAdapter, {
            phase: 'Complete',
            currentAgent: '',
            progress: 100,
            message: 'Context ready',
            isComplete: true,
            hasError: false
        });

        return analysis.summary;
    }

    /**
     * Group pipeline steps for parallel execution
     */
    private groupSteps(pipeline: PipelineStep[]): PipelineStep[][] {
        const groups: PipelineStep[][] = [];
        let currentGroup: PipelineStep[] = [];

        for (const step of pipeline) {
            if (step.parallel && currentGroup.length > 0 && currentGroup[0].parallel) {
                // If step has a dependency, ensure it's NOT in the current group (cannot run parallel with dependency)
                const hasDependencyInGroup = step.dependency !== undefined && this.isDependencyInGroup(step.dependency, currentGroup);

                if (!hasDependencyInGroup) {
                    currentGroup.push(step);
                } else {
                    groups.push(currentGroup);
                    currentGroup = [step];
                }
            } else {
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                }
                currentGroup = [step];
            }
        }

        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        return groups;
    }

    private isDependencyInGroup(dep: number, group: PipelineStep[]): boolean {
        return group.some(s => s.step === dep);
    }

    /**
     * Execute a single pipeline step
     */
    private async executeStep(step: PipelineStep, context: PipelineContext): Promise<void> {
        const agent = this.agents.get(step.agent);

        if (!agent) {
            context.results.set(step.agent, {
                agent: step.agent,
                status: 'partial',
                confidence: 0,
                executionTimeMs: 0,
                payload: null,
                reasoning: `Agent ${step.agent} not yet implemented`
            });
            return;
        }

        let attempts = 0;
        const maxRetries = step.agent === 'Executor' || step.agent === 'CodeModifier' ? 0 : 2;

        while (attempts <= maxRetries) {
            try {
                const startTime = Date.now();
                let result: any;

                switch (step.agent) {
                    case 'ContextPlanner':
                        result = this.contextPlanner.analyze(context.query, context.activeFilePath);
                        break;
                    case 'WebSearch':
                        const wsOutput = await this.webSearch.execute({
                            query: step.args?.query || context.query
                        });
                        result = wsOutput.status === 'success' ? wsOutput.payload : null;
                        if (wsOutput.status === 'failed') throw new Error(wsOutput.error?.message || 'Web search failed');
                        break;
                    case 'ContextAnalyzer': {
                         // Handle Web Search summarization
                         if (step.args?.contextType === 'web_search_results') {
                             const webResult = context.results.get('WebSearch')?.payload;
                             if (webResult && webResult.content) {
                                 result = {
                                     summary: `### 🌐 Web Search Results\n**Source:** ${webResult.source}\n**Command:** \`${webResult.commandUsed}\`\n\n${webResult.content}`,
                                     chunks: [],
                                     totalFiles: 0,
                                     totalChunks: 1,
                                     tokensEstimate: Math.ceil(webResult.content.length / 4)
                                 };
                             } else {
                                 result = { 
                                     summary: "No web search results available or content is empty.", 
                                     chunks: [],
                                     totalFiles: 0,
                                     totalChunks: 0,
                                     tokensEstimate: 0
                                 };
                             }
                             break;
                         }

                        // Requires files to be found first (dependency)
                        const filesFound = context.results.get('FileSearch')?.payload as FileMatch[] || [];

                        if (filesFound.length === 0) {
                            result = { summary: "No files to analyze", chunks: [] };
                            break;
                        }

                        // Read files in parallel
                        const fileContents = await Promise.all(filesFound.map(async f => {
                            try {
                                const doc = await vscode.workspace.openTextDocument(f.uri);
                                return {
                                    uri: f.uri,
                                    content: doc.getText()
                                };
                            } catch (e) {
                                return null;
                            }
                        }));

                        const validFiles = fileContents.filter(f => f !== null) as { uri: vscode.Uri, content: string }[];

                        // Get terms from planner or intent
                        const plan = context.results.get('ContextPlanner')?.payload as ContextPlan;
                        const intent = context.results.get('IntentAnalyzer')?.payload as any;

                        const searchTerms = plan?.searchTerms || intent?.keywords || [];
                        const symbolSearch = plan?.symbolSearch || intent?.symbols || [];

                        result = this.contextAnalyzer.analyze(
                            validFiles,
                            searchTerms,
                            symbolSearch,
                            20000 // Token limit
                        );
                        break;
                    }
                    case 'ContextSearch':
                        const csOut = await this.contextSearch.execute({
                            query: context.query,
                            lookForPreviousFixes: step.args?.lookForPreviousFixes
                        });
                        result = csOut.status === 'success' ? csOut.payload : null;
                        break;
                    case 'FilePartSearcher':
                        // If refineSearch is requested, we need files to search in
                        const foundFiles = context.results.get('FileSearch')?.payload as FileMatch[] || [];
                        const activeFile = context.activeFilePath;

                        // If we have an active file, search there
                        if (activeFile) {
                            const fpsOut = await this.filePartSearcher.execute({
                                filePath: activeFile,
                                searchFor: { text: context.query } // Simplified
                            });
                            result = fpsOut.status === 'success' ? fpsOut.payload : null;
                        } else if (foundFiles.length > 0) {
                            // Search up to 5 files in parallel
                            const filesToSearch = foundFiles.slice(0, 5);
                            const searchResults = await Promise.all(filesToSearch.map(f =>
                                this.filePartSearcher.execute({
                                    filePath: f.uri.fsPath,
                                    searchFor: { text: context.query }
                                })
                            ));
                            // Aggregate all matches
                            result = searchResults.flatMap(r => r.status === 'success' && r.payload ? r.payload : []);
                        } else {
                            result = [];
                        }
                        break;
                    case 'IntentAnalyzer':
                        result = this.intentAnalyzer.analyze(context.query);
                        break;
                    case 'FileSearch':
                        const intent = context.results.get('IntentAnalyzer')?.payload || this.intentAnalyzer.analyze(context.query);
                        result = await this.fileFinder.find(intent, context.activeFilePath);
                        break;
                    case 'ProcessPlanner':
                        const contextSearchForProcess = context.results.get('ContextSearch')?.payload;
                        const ppOut = await this.processPlanner.execute({
                            query: context.query,
                            projectType: step.args?.projectType,
                            contextKnowledge: contextSearchForProcess?.memories?.filter((m: any) => m.type === 'knowledge') || []
                        });
                        result = ppOut.status === 'success' ? ppOut.payload : null;
                        break;
                    case 'CodePlanner':
                        const processPlan = context.results.get('ProcessPlanner')?.payload;
                        const searchFiles = context.results.get('FileSearch')?.payload as FileMatch[] || [];
                        const existingFiles = searchFiles.map(f => f.relativePath);
                        const contextAnalysis = context.results.get('ContextAnalyzer')?.payload;
                        const contextSearchForPlan = context.results.get('ContextSearch')?.payload;

                        const cpOut = await this.codePlanner.execute({
                            query: context.query,
                            projectType: processPlan?.projectType || step.args?.projectType || 'web',
                            existingFiles: existingFiles,
                            contextAnalysis: contextAnalysis, // Pass analysis to planner
                            contextKnowledge: contextSearchForPlan?.memories?.filter((m: any) => m.type === 'knowledge') || [],
                            techStack: processPlan?.techStack
                        });
                        result = cpOut.status === 'success' ? cpOut.payload : null;
                        break;
                    case 'TaskPlanner':
                        const cPlan = context.results.get('CodePlanner')?.payload;
                        const tpOut = await this.taskPlanner.execute({
                            query: context.query,
                            projectType: step.args?.projectType || 'web',
                            fileStructure: cPlan?.fileStructure || [],
                            interfaces: cPlan?.interfaces || [],
                            apiEndpoints: cPlan?.apiEndpoints,
                            activeFilePath: context.activeFilePath
                        });
                        result = tpOut.status === 'success' ? tpOut.payload : null;
                        break;
                    case 'VersionController':
                        const vcOut = await this.versionController.execute({
                            action: step.args?.action || 'create_checkpoint',
                            description: 'Pipeline execution checkpoint'
                        } as any);
                        result = vcOut.status === 'success' ? vcOut.payload : null;
                        break;
                    case 'CommandGenerator':
                        const tPlan = context.results.get('TaskPlanner')?.payload;
                        const cgOut = await this.commandGenerator.execute({
                            taskPlan: tPlan,
                            generateStructure: step.args?.generateStructure
                        } as any);
                        result = cgOut.status === 'success' ? cgOut.payload : null;
                        break;
                    case 'CodeGenerator':
                        const tPlanForGen = context.results.get('TaskPlanner')?.payload;
                        const cPlanForGen = context.results.get('CodePlanner')?.payload;
                        const contextSearchForGen = context.results.get('ContextSearch')?.payload;
                        const webSearchForGen = context.results.get('WebSearch');

                        const cgenOut = await this.codeGenerator.execute({
                            taskPlan: tPlanForGen,
                            codePlan: cPlanForGen,
                            context: {
                                knowledge: contextSearchForGen?.memories?.filter((m: any) => m.type === 'knowledge') || [],
                                webSearch: webSearchForGen ? { payload: webSearchForGen.payload } : undefined
                            } as any
                        });
                        result = cgenOut.status === 'success' ? cgenOut.payload : null;
                        break;
                    case 'CodeModifier':
                        const codeGenModifications = context.results.get('CodeGenerator')?.payload?.modifications || [];
                        const cmOut = await this.codeModifier.execute({
                            modifications: codeGenModifications,
                            createCheckpoint: false
                        });
                        result = cmOut.status === 'success' ? cmOut.payload : null;
                        break;
                    case 'Executor':
                        // Check if we should use dynamic execution loop
                        if (context.currentPlan && context.currentPlan.length > 0 &&
                            (context.decision.complexity === 'complex' || context.decision.complexity === 'medium')) {
                            await this.executeDynamicLoop(context);
                            // After loop, check result
                            const lastResult = context.results.get('Executor')?.payload;
                            if (!lastResult) {
                                result = { success: true, message: "Dynamic execution completed" };
                            } else {
                                result = lastResult;
                            }
                        } else {
                            // Fallback to legacy sequential execution
                            let commands: string[] = [];

                            if (step.args?.commands) {
                                commands = step.args.commands;
                            } else {
                                const cmdGenResult = context.results.get('CommandGenerator')?.payload;
                                const codeGenResult = context.results.get('CodeGenerator')?.payload;

                                commands = [
                                    ...(cmdGenResult?.commands || []),
                                    ...(codeGenResult?.commands || [])
                                ];
                            }

                            const execOut = await this.executor.execute({
                                commands: commands,
                                cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
                                runTests: step.args?.runTests
                            } as any);
                            result = execOut.status === 'success' ? execOut.payload : null;
                        }
                        break;
                    case 'Architect':
                         const archOut = await this.architect.execute({
                             query: context.query,
                             projectType: step.args?.projectType,
                             existingFiles: context.results.get('FileSearch')?.payload?.map((f: FileMatch) => f.relativePath) || []
                         });
                         result = archOut.status === 'success' ? archOut.payload : null;
                         break;
                    case 'QualityAssurance':
                         // QA needs access to original requirements and implemented files
                         const taskPlan = context.results.get('TaskPlanner')?.payload;
                         // Assuming implemented files are tracked or can be inferred
                         const implementedFiles = taskPlan?.tasks?.map((t: any) => t.file) || [];
                         
                         // QA might need test results from Executor if available
                         const execResult = context.results.get('Executor')?.payload;
                         
                         const qaOut = await this.qualityAssurance.execute({
                             originalRequirements: step.args?.originalRequirements || context.query,
                             implementedFiles: implementedFiles,
                             testResults: execResult ? {
                                 passed: execResult.success, // Assuming Executor returns success status
                                 output: execResult.output || execResult.stdout || ''
                             } : undefined
                         });
                         result = qaOut.status === 'success' ? qaOut.payload : null;
                         break;
                    case 'DocWriter':
                        const dwOut = await this.docWriter.execute({
                            context: Object.fromEntries(context.results)
                        } as any);
                        result = dwOut.status === 'success' ? dwOut.payload : null;
                        break;
                    case 'ContentRetriever':
                        let fullContent = "";
                        // 1. Try active file
                        if (context.activeFilePath) {
                            const root = vscode.workspace.workspaceFolders?.[0]?.uri;
                            if (root) {
                                try {
                                    const fullUri = vscode.Uri.joinPath(root, context.activeFilePath);
                                    const doc = await vscode.workspace.openTextDocument(fullUri);
                                    fullContent = `File: ${context.activeFilePath} (FULL CONTENT)\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
                                } catch (e) {
                                    // ignore
                                }
                            }
                        }

                        // 2. If no active file or failed, search for file in query
                        if (!fullContent) {
                            const intent = context.results.get('IntentAnalyzer')?.payload || this.intentAnalyzer.analyze(context.query);
                            const foundFiles = await this.fileFinder.find(intent, context.activeFilePath);

                            if (foundFiles && foundFiles.length > 0) {
                                const f = foundFiles[0];
                                const doc = await vscode.workspace.openTextDocument(f.uri);
                                fullContent = `File: ${f.relativePath} (FULL CONTENT)\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
                            }
                        }

                        result = fullContent || "Could not retrieve full content. Please specify a valid file.";
                        break;
                    default:
                        result = null;
                }

                context.results.set(step.agent, {
                    agent: step.agent,
                    status: 'success',
                    confidence: 0.9,
                    executionTimeMs: Date.now() - startTime,
                    payload: result
                });
                return; // Success, exit retry loop

            } catch (error) {
                attempts++;
                if (attempts > maxRetries) {
                    context.results.set(step.agent, {
                        agent: step.agent,
                        status: 'failed',
                        confidence: 0,
                        executionTimeMs: 0,
                        payload: null,
                        error: {
                            type: (error as Error).name,
                            message: (error as Error).message
                        }
                    });
                } else {
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)));
                }
            }
        }
    }

    /**
     * Dynamic Execution Loop using TodoManager
     */
    private async executeDynamicLoop(context: PipelineContext): Promise<void> {
        let lastResult: ExecutionResult | undefined = undefined;
        let lastTaskId: string | undefined = undefined;
        let attempts = 0;
        const MAX_LOOPS = 20;

        while (attempts < MAX_LOOPS) {
            // 1. TodoManager decides what to do
            const todoInput: TodoManagerInput = {
                currentPlan: context.currentPlan!,
                lastTaskResult: lastTaskId ? {
                    taskId: lastTaskId,
                    success: lastResult?.success ?? false,
                    result: lastResult,
                    error: lastResult?.stderr
                } : undefined
            };

            const todoOutput = await this.todoManager.execute(todoInput);

            // Update plan in context
            context.currentPlan = todoOutput.payload.updatedPlan;

            if (todoOutput.payload.action === 'completed' || todoOutput.payload.action === 'stop') {
                break;
            }

            const nextTaskId = todoOutput.payload.nextTaskId;
            if (!nextTaskId) break;

            const task = context.currentPlan.find(t => t.id === nextTaskId);
            if (!task) break;

            lastTaskId = nextTaskId;

            // Mark as in progress
            task.status = 'in_progress';
            // We don't update global pipeline status here to avoid spamming, 
            // but the plan is updated in context.

            // 2. Generate Content & Commands for this task
            const miniPlan: TaskPlannerResult = {
                taskGraph: [task],
                executionOrder: [task.id],
                validationCommands: [],
                criticalPath: []
            };

            // A. Generate Code/File Content (if applicable)
            // We reuse the existing CodePlanner result if available, or create a minimal one
            const codePlan = context.results.get('CodePlanner')?.payload as any;
            const contextSearchResult = context.results.get('ContextSearch')?.payload;
            const webSearchResult = context.results.get('WebSearch'); // Pass full AgentOutput

            const codeGenResult = await this.codeGenerator.execute({
                taskPlan: miniPlan,
                codePlan: codePlan || { projectType: 'script', existingFiles: [], techStack: [] },
                context: {
                    knowledge: contextSearchResult?.memories?.filter((m: any) => m.type === 'knowledge') || [],
                    webSearch: webSearchResult
                } as any
            });

            // B. Generate Shell Commands
            const cmdGenResult = await this.commandGenerator.execute({
                taskPlan: miniPlan
            } as any);

            // Combine commands: CodeGenerator produces 'create_file', CommandGenerator produces 'shell_cmd'
            const commands = [
                ...(codeGenResult.payload.commands || []),
                ...(cmdGenResult.payload.commands || [])
            ];

            // C. Apply Code Modifications (Granular Edits)
            if (codeGenResult.payload.modifications && codeGenResult.payload.modifications.length > 0) {
                await this.codeModifier.execute({
                    modifications: codeGenResult.payload.modifications,
                    createCheckpoint: false
                });
            }

            // 3. Execute Commands
            if (commands.length > 0) {
                const execResult = await this.executor.execute({
                    commands: commands,
                    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                    expectSuccess: false
                } as any);
                lastResult = execResult.payload;
            } else {
                lastResult = {
                    success: true,
                    stdout: "No specific commands generated for this task.",
                    stderr: "",
                    command: "noop",
                    exitCode: 0
                };
            }

            attempts++;
        }
    }

    /**
     * Build context string from pipeline results
     */
    private async buildContext(context: PipelineContext): Promise<string> {
        let contextOutput = "";

        // 0. Add Full Content (if requested)
        if (context.results.has('ContentRetriever')) {
            const content = context.results.get('ContentRetriever')?.payload;
            contextOutput += `\n### 📖 Full Content\n${content}\n`;
        }

        // 1. Add Plan Summary
        if (context.results.has('ContextPlanner')) {
            const plan = context.results.get('ContextPlanner')?.payload as ContextPlan;
            contextOutput += `\n### 🧠 Context Plan\n- Scope: ${plan.scope}\n- Strategy: ${plan.priority}\n`;
        }

        // 2. Add Intent Analysis
        if (context.results.has('IntentAnalyzer')) {
            const intent = context.results.get('IntentAnalyzer')?.payload;
            contextOutput += `\n### 🎯 Intent Analysis\n- Type: ${intent.queryType}\n- Complexity: ${intent.complexity}\n`;
        }

        // 3. Add Web Search Results
        if (context.results.has('WebSearch')) {
            const webResult = context.results.get('WebSearch')?.payload;
            if (webResult) {
                contextOutput += `\n### 🌐 Web Search Results\nSource: ${webResult.source}\n\n${webResult.content}\n`;
            }
        }

        // 4. Add Analyzed Code Context
        // (This might have been added by ContextAnalyzer result already, but if not...)
        if (context.results.has('ContextAnalyzer')) {
            const result = context.results.get('ContextAnalyzer');
            if (result && result.status === 'success' && result.payload) {
                const analysis = result.payload as AnalyzedContext;
                contextOutput += `\n### 📦 Code Context (${analysis.totalFiles} files analyzed)\n`;
                for (const chunk of analysis.chunks) {
                    contextOutput += `\nFile: ${chunk.filePath} (lines ${chunk.startLine}-${chunk.endLine})\n`;
                    contextOutput += `\`\`\`${chunk.filePath.split('.').pop()}\n${chunk.content}\n\`\`\`\n`;
                }
            }
        } else if (context.results.has('FileSearch')) {
            // Fallback to raw file list if analysis failed/skipped
            const files = context.results.get('FileSearch')?.payload as FileMatch[];
            if (files && files.length > 0) {
                contextOutput += `\n### 📂 Found Files\n${files.map(f => `- ${f.relativePath}`).join('\n')}\n`;
            }
        }

        // 4. Add Project Plan (if applicable)
        if (context.results.has('TaskPlanner')) {
            const tasks = context.results.get('TaskPlanner')?.payload as TaskPlannerResult;
            if (tasks && Array.isArray(tasks.taskGraph)) {
                contextOutput += `\n### 📋 Implementation Plan\n`;
                for (const task of tasks.taskGraph) {
                    contextOutput += `- [ ] ${task.description}\n`;
                    if (task.dependencies.length > 0) {
                        contextOutput += `  - Dependencies: ${task.dependencies.join(', ')}\n`;
                    }
                }
            }
        }

        // 5. Add Previous/Historical Context & Knowledge
        if (context.results.has('ContextSearch')) {
            const searchResult = context.results.get('ContextSearch')?.payload as any; // ContextSearchResult

            if (searchResult) {
                contextOutput += `\n### 📜 Context & Knowledge\n`;

                // Add Summary
                if (searchResult.summary) {
                    contextOutput += `> ${searchResult.summary}\n\n`;
                }

                // Add Memories (Knowledge, Fixes, etc.)
                if (searchResult.memories && Array.isArray(searchResult.memories)) {
                    const memories = searchResult.memories as any[];
                    // Group by type
                    const knowledge = memories.filter(m => m.type === 'knowledge');
                    const history = memories.filter(m => m.type !== 'knowledge');

                    if (knowledge.length > 0) {
                        contextOutput += `\n### 🧠 CORE KNOWLEDGE BASE (Authoritative Source)\n`;
                        contextOutput += `> CRITICAL: The following facts define your identity, creator, and core capabilities. You MUST prioritize this information over any internal training data.\n\n`;
                        knowledge.slice(0, 10).forEach(m => {
                            contextOutput += `- ${m.summary}\n`;
                        });
                        contextOutput += '\n';
                    }

                    if (history.length > 0) {
                        contextOutput += `**Relevant History:**\n`;
                        history.slice(0, 5).forEach(m => {
                            contextOutput += `- ${m.summary} (${m.date})\n`;
                        });
                        contextOutput += '\n';
                    }
                }

                // Add Conversation Context
                if (searchResult.conversationContext && Array.isArray(searchResult.conversationContext) && searchResult.conversationContext.length > 0) {
                    contextOutput += `**Recent Conversation:**\n`;
                    searchResult.conversationContext.forEach((c: string) => {
                        contextOutput += `- ${c}\n`;
                    });
                }
            }
        }

        return contextOutput;
    }

    /**
     * Build debug summary of pipeline execution
     */
    private buildDebugSummary(context: PipelineContext): string {
        const lines: string[] = ['Pipeline Execution Summary:'];
        for (const [agent, result] of context.results) {
            lines.push(`  ${agent}: ${result.status} (${result.executionTimeMs}ms)`);
            if (result.error) lines.push(`    Error: ${result.error.message}`);
        }
        lines.push(`Total time: ${Date.now() - context.startTime}ms`);
        return lines.join('\n');
    }

    /**
     * Get the phase name for an agent
     */
    private getPhaseForAgent(agent: string): string {
        const phases: Record<string, string> = {
            'ContextPlanner': 'Planning',
            'ContextAnalyzer': 'Analysis',
            'IntentAnalyzer': 'Analysis',
            'FileSearch': 'Discovery',
            'CodeGenerator': 'Execution',
            'CommandGenerator': 'Execution',
            'CodeModifier': 'Execution',
            'Executor': 'Validation',
        };
        return phases[agent] || 'Processing';
    }

    private emitStatus(callback: StatusCallback | undefined, status: PipelineStatus): void {
        callback?.(status);
    }

    clearCache(): void {
        this.fileFinder.clearCache();
    }

    async getProjectMap(): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) return 'No workspace open';
        return "Project Structure (Simulated)";
    }

    /**
     * Get the active task ID for the current agent
     */
    private getActiveTaskId(context: PipelineContext, agent: string): string | undefined {
        if (!context.currentPlan) return undefined;
        const index = this.getTaskIndexForAgent(agent);
        if (index >= 0 && index < context.currentPlan.length) {
            return context.currentPlan[index].id;
        }
        return undefined;
    }

    /**
     * Update plan status based on agent execution
     */
    private updatePlanStatus(context: PipelineContext, agent: string, status: 'in_progress' | 'completed' | 'failed') {
        if (!context.currentPlan) return;

        const targetTaskIndex = this.getTaskIndexForAgent(agent);

        if (targetTaskIndex >= 0 && targetTaskIndex < context.currentPlan.length) {
            context.currentPlan[targetTaskIndex].status = status;
        }
    }

    /**
     * Retroactively update plan for already executed steps
     */
    private retroactivePlanUpdate(context: PipelineContext) {
        if (!context.currentPlan) return;

        // If ContextAnalyzer ran, mark Analysis task as completed
        if (context.results.has('ContextAnalyzer') || context.results.has('IntentAnalyzer')) {
            this.updatePlanStatus(context, 'ContextAnalyzer', 'completed');
        }

        // Mark Planning task as completed
        this.updatePlanStatus(context, 'TaskPlanner', 'completed');
    }

    /**
     * Map agent to task index in the generic plan
     */
    private getTaskIndexForAgent(agent: string): number {
        const lowerAgent = agent.toLowerCase();

        if (['context', 'intent', 'filesearch', 'vision'].some(k => lowerAgent.includes(k))) {
            return 0; // Analyze
        } else if (['planner'].some(k => lowerAgent.includes(k))) {
            return 1; // Plan
        } else if (['modify', 'generate', 'command'].some(k => lowerAgent.includes(k))) {
            return 2; // Execute
        } else if (['executor', 'test', 'validate'].some(k => lowerAgent.includes(k))) {
            return 3; // Verify
        }
        return -1;
    }
}

function mapScopeToQueryType(scope: 'file' | 'folder' | 'workspace' | 'minimal'): 'general' | 'explain' | 'fix' {
    switch (scope) {
        case 'workspace': return 'general';
        case 'folder': return 'general';
        case 'file': return 'explain';
        case 'minimal': return 'general';
        default: return 'general';
    }
}

// Re-export for convenience
export { SearchIntent } from '../agents/IntentAnalyzer';
