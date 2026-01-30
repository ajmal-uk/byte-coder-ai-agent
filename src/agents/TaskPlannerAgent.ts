/**
 * TaskPlannerAgent - Executable task generator
 * Creates dependency graphs and validation commands using LLM-driven planning
 */

import { BaseAgent, AgentOutput, TaskNode } from '../core/AgentTypes';
import { ByteAIClient } from '../byteAIClient';
import { PersonaManager } from '../core/PersonaManager';
import { ArchitectureDesign } from './ArchitectAgent';

export interface TaskPlannerInput {
    query: string;
    projectType: string;
    fileStructure: string[];
    interfaces: string[];
    apiEndpoints?: { method: string; path: string; description: string }[];
    activeFilePath?: string;
    design?: ArchitectureDesign;
}

export interface TaskPlannerResult {
    taskGraph: TaskNode[];
    executionOrder: string[];
    validationCommands: { task: string; command: string }[];
    criticalPath: string[];
}

export class TaskPlannerAgent extends BaseAgent<TaskPlannerInput, TaskPlannerResult> {
    private taskIdCounter = 0;
    private client: ByteAIClient;

    constructor() {
        super({ name: 'TaskPlanner', timeout: 30000 });
        this.client = new ByteAIClient();
    }

    async execute(input: TaskPlannerInput): Promise<AgentOutput<TaskPlannerResult>> {
        const startTime = Date.now();
        this.taskIdCounter = 0;

        try {
            // 1. Generate task graph using pure LLM approach
            const taskGraph = await this.generateTaskGraph(input);

            // 2. Apply recursive decomposition for complex tasks
            const refinedGraph = await this.recursiveDecomposition(taskGraph, input);

            // 3. Calculate execution order (topological sort)
            const executionOrder = this.topologicalSort(refinedGraph);

            // 4. Generate validation commands
            const validationCommands = this.generateValidationCommands(refinedGraph, input.projectType);

            // 5. Identify critical path
            const criticalPath = this.identifyCriticalPath(refinedGraph, executionOrder);

            const result: TaskPlannerResult = {
                taskGraph: refinedGraph,
                executionOrder,
                validationCommands,
                criticalPath
            };

            return this.createOutput('success', result, 0.85, startTime, {
                reasoning: `Generated ${refinedGraph.length} tasks with ${criticalPath.length} on critical path`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Generate task graph from input using LLM
     */
    private async generateTaskGraph(input: TaskPlannerInput): Promise<TaskNode[]> {
        const prompt = this.constructPlanningPrompt(input);
        
        try {
            const response = await this.client.streamResponse(
                prompt,
                () => {},
                (err: Error) => console.warn('Planning LLM error:', err)
            );

            const tasks = this.parseTaskResponse(response);
            if (tasks.length > 0) return tasks;
            
            return this.generateFallbackTask(input);
        } catch (error) {
            console.error('Planning failed:', error);
            return this.generateFallbackTask(input);
        }
    }
    private constructPlanningPrompt(input: TaskPlannerInput): string {
        let designContext = '';
        if (input.design) {
            designContext = `
### Architecture Design (MANDATORY TO FOLLOW):
- **Architecture**: ${input.design.architecture}
- **Tech Stack**: ${input.design.techStack.join(', ')}
- **Proposed File Structure**: ${input.design.fileStructure.join(', ')}
- **Components**: 
${input.design.components.map(c => `  - ${c.name}: ${c.description} (Responsibilities: ${c.responsibilities.join(', ')})`).join('\n')}
- **Data Models**: 
${input.design.dataModels.map(d => `  - ${d.name}: ${d.fields.join(', ')}`).join('\n')}
`;
        }

        return `You are an Elite Software Architect and Project Manager.
User Request: "${input.query}"
Project Type: ${input.projectType}
Existing Files: ${input.fileStructure.slice(0, 100).join(', ')}
Current Active File: ${input.activeFilePath || 'None'}${designContext}

Your goal is to create a detailed, dependency-aware execution plan to fulfill the user's request.
You must analyze the request and break it down into atomic, executable tasks.

### Rules:
1. **Atomicity**: Each task should do ONE thing (e.g., "Create file", "Run command", "Edit function").
2. **Dependencies**: Define dependencies explicitly.
   - If Task B requires Task A's output (e.g., file creation), Task B depends on Task A.
   - If tasks are independent, they can run in parallel (leave dependencies empty).
3. **Parallel Optimization**: MAXIMIZE parallelism. 
   - Assign the same 'parallelGroup' ID to tasks that can run simultaneously (e.g., creating 5 different component files).
   - Independent file creations should NEVER depend on each other.
4. **Verification**: Every task MUST have a 'validationCommand' to verify success (e.g., 'ls file.ts', 'npm test', 'node --check file.js').
5. **Environment**: 
   - Use 'pip install' for Python, 'npm install' for Node.
   - **CRITICAL**: For ALL file creation or modification (including new files, configs, readmes), use 'type': 'code' and assign to 'CodeGenerator'.
   - **DESCRIPTION**: For 'code' tasks, the description MUST be detailed. 
     - BAD: "Update file"
     - GOOD: "Add 'calculateTotal' function to Utils class that sums the order items"
   - **NEVER** use 'command' type for creating files (e.g. do NOT use 'touch', 'mkdir', 'echo', 'cat'). These are platform-dependent and fragile.
   - Use 'type': 'command' ONLY for running scripts, installing dependencies, or starting servers.
   - **Command Generation**:
     - Assign to **'Executor'** if you know the exact command (e.g. \`npm install\`, \`ls -la\`).
     - Assign to **'CommandGenerator'** if the command is platform-specific or requires complex construction (e.g. file operations if not using CodeGenerator, or complex system calls).
   - For 'command' tasks, you MUST provide the specific shell command in the "command" field.
6. **Completeness**: The plan must be end-to-end (Setup -> Implementation -> Verification).
7. **Alignment**: Ensure all tasks align with the provided Architecture Design (if any). Create files exactly as specified in the design.

### Output Format:
Return a JSON array of task objects. NO markdown formatting.
[
  {
    "id": "unique_id_1",
    "description": "Clear description of what to do",
    "type": "code" | "command" | "test",
    "command": "actual shell command (REQUIRED if type is 'command')",
    "dependencies": [], 
    "filePath": "path/to/target.ext",
    "validationCommand": "shell command",
    "parallelGroup": "optional_group_id",
    "assignedAgent": "CodeGenerator" | "Executor" | "CodeModifier" | "CommandGenerator" | "QualityAssurance",
    "complexity": "simple" | "medium" | "complex",
    "reasoning": "Brief explanation of why this task is necessary",
    "successCriteria": ["Criterion 1", "Criterion 2"]
  }
]`;
    }

    private generateFallbackTask(input: TaskPlannerInput): TaskNode[] {
        // Try to extract file path from query
        const fileMatch = input.query.match(/(?:create|make|generate|add)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_./-]+\.[a-z0-9]+)/i);
        const extractedPath = fileMatch ? fileMatch[1] : undefined;
        const filePath = extractedPath || input.activeFilePath || 'generated_code.txt';

        return [{
            id: 'fallback_1',
            description: input.query,
            type: 'code',
            status: 'pending',
            dependencies: [],
            filePath: filePath,
            complexity: 'medium',
            assignedAgent: 'CodeGenerator',
            reasoning: 'Fallback task generated due to planning failure',
            successCriteria: ['Code generated successfully']
        }];
    }

    /**
     * Recursively decompose tasks marked as 'complex' into sub-tasks
     */
    private async recursiveDecomposition(tasks: TaskNode[], input: TaskPlannerInput, depth: number = 0): Promise<TaskNode[]> {
        if (depth > 2) return tasks;

        const resultTasks: TaskNode[] = [];

        // Group tasks for parallel decomposition
        const decompositionPromises = tasks.map(async (task) => {
            // Only decompose if marked complex AND has a description (not a simple command)
            if (task.complexity === 'complex' && task.type !== 'command' && !task.description.includes('mkdir')) {
                const subTasks = await this.decomposeTask(task, input);
                
                if (subTasks.length > 0) {
                    // Recursively decompose the subtasks if they are still complex
                    return this.recursiveDecomposition(subTasks, input, depth + 1);
                } else {
                    return task;
                }
            } else {
                return task;
            }
        });

        const results = await Promise.all(decompositionPromises);
        
        results.forEach(res => {
            if (Array.isArray(res)) {
                resultTasks.push(...res);
            } else {
                resultTasks.push(res);
            }
        });

        return resultTasks;
    }

    /**
     * Decompose a single complex task into smaller steps
     */
    private async decomposeTask(parentTask: TaskNode, input: TaskPlannerInput): Promise<TaskNode[]> {
        const prompt = `
You are a Senior Technical Lead.
Parent Task: "${parentTask.description}"
Target File: "${parentTask.filePath || 'Unknown'}"
Project Context: ${input.projectType}

The parent task is too complex to be executed as a single unit. 
Decompose it into 2-5 smaller, atomic sub-tasks.
You MUST specify dependencies explicitly to enable parallel execution where possible.

Output a JSON array of task objects.
Format:
[
  {
    "id": "subtask_1",
    "description": "Specific sub-task action",
    "type": "code" | "command" | "test",
    "command": "actual shell command (REQUIRED if type is 'command')",
    "dependencies": ["subtask_id_of_dependency"], 
    "filePath": "src/path/to/file.ts",
    "validationCommand": "shell command to verify",
    "parallelGroup": "${parentTask.parallelGroup || ''}",
    "assignedAgent": "${parentTask.assignedAgent || 'CodeGenerator'}",
    "complexity": "simple" | "medium"
  }
]
Rules:
1. Sub-tasks must be concrete and actionable.
2. Maintain the intent of the parent task.
3. Inherit context (file path, agent) if applicable, but refine if needed.
4. Define 'dependencies' carefully. If Task B depends on Task A, put Task A's ID in Task B's dependencies.
5. If tasks are independent, leave dependencies empty (they will run in parallel).
6. Output ONLY JSON.
`;

        try {
            const response = await this.client.streamResponse(
                prompt,
                () => {},
                (err: Error) => console.warn('Decomposition LLM error:', err)
            );

            const subTasks = this.parseTaskResponse(response);
            
            if (subTasks.length > 0) {
                // 1. Create ID Map to ensure unique IDs relative to parent
                const idMap = new Map<string, string>();
                
                subTasks.forEach((task, index) => {
                    const newId = `${parentTask.id}_sub_${index + 1}`;
                    idMap.set(task.id, newId);
                    task.id = newId;
                });

                // 2. Update internal dependencies using the map
                subTasks.forEach(task => {
                    const newDeps: string[] = [];
                    task.dependencies.forEach(depId => {
                        if (idMap.has(depId)) {
                             // It's an internal dependency (a sibling subtask)
                             newDeps.push(idMap.get(depId)!);
                        } else {
                             // It's an external dependency (parent's dependency or global)
                             // Keep it as is
                             newDeps.push(depId);
                        }
                    });
                    task.dependencies = newDeps;
                });

                // 3. Handle Entry Nodes (inherit parent's dependencies)
                const subTaskIds = new Set(subTasks.map(t => t.id));
                const entryNodes = subTasks.filter(t => t.dependencies.every(d => !subTaskIds.has(d)));

                entryNodes.forEach(node => {
                    node.dependencies = [...new Set([...node.dependencies, ...(parentTask.dependencies || [])])];
                });

                // 4. Handle Exit Nodes (parent's dependents should wait for these)
                // We create a Sync Node that reuses the Parent's ID.
                const internalDependents = new Set<string>();
                subTasks.forEach(t => t.dependencies.forEach(d => internalDependents.add(d)));
                
                const exitNodes = subTasks.filter(t => !internalDependents.has(t.id));

                const syncNode: TaskNode = {
                    id: parentTask.id, // Reuse parent ID so downstream tasks automatically wait for this
                    description: `Verify completion of: ${parentTask.description}`,
                    type: 'test',
                    status: 'pending',
                    dependencies: exitNodes.map(t => t.id),
                    filePath: parentTask.filePath,
                    validationCommand: parentTask.validationCommand,
                    complexity: 'simple',
                    assignedAgent: 'QualityAssurance'
                };

                return [...subTasks, syncNode];
            }

            return [];
        } catch (error) {
            console.warn('Decomposition failed:', error);
            return [];
        }
    }

    /**
     * Parse LLM JSON response for tasks
     */
    private parseTaskResponse(response: string): TaskNode[] {
        try {
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const tasks = JSON.parse(jsonMatch[0]);
                // Ensure default fields
                return tasks.map((t: any) => ({
                    ...t,
                    status: 'pending',
                    dependencies: t.dependencies || [],
                    complexity: t.complexity || 'simple'
                }));
            }
            return [];
        } catch (e) {
            console.error('Failed to parse task response:', e);
            return [];
        }
    }

    /**
     * Helper to create a task node (compatibility helper)
     */
    private createTask(description: string, filePath?: string, dependencies: string[] = [], validationCommand?: string): TaskNode {
        return {
            id: `task_${++this.taskIdCounter}`,
            description,
            type: 'code',
            status: 'pending',
            dependencies,
            filePath,
            validationCommand,
            complexity: 'simple',
            assignedAgent: 'CodeGenerator'
        };
    }

    /**
     * Topologically sort the task graph to determine execution order
     */
    private topologicalSort(graph: TaskNode[]): string[] {
        const visited = new Set<string>();
        const temp = new Set<string>();
        const order: string[] = [];

        const visit = (nodeId: string) => {
            if (temp.has(nodeId)) return; // Cycle detected, ignore
            if (visited.has(nodeId)) return;

            temp.add(nodeId);

            const node = graph.find(n => n.id === nodeId);
            if (node) {
                for (const depId of node.dependencies) {
                    visit(depId);
                }
            }

            temp.delete(nodeId);
            visited.add(nodeId);
            order.push(nodeId);
        };

        for (const node of graph) {
            if (!visited.has(node.id)) {
                visit(node.id);
            }
        }

        return order;
    }

    /**
     * Identify the critical path in the task graph
     */
    private identifyCriticalPath(graph: TaskNode[], executionOrder: string[]): string[] {
        // Simple longest path implementation
        const pathLength = new Map<string, number>();
        const predecessor = new Map<string, string>();
        let maxLen = 0;
        let endNode = '';

        for (const nodeId of executionOrder) {
            const node = graph.find(n => n.id === nodeId);
            if (!node) continue;

            let currentMax = 0;
            let currentPred = '';

            for (const depId of node.dependencies) {
                const len = pathLength.get(depId) || 0;
                if (len > currentMax) {
                    currentMax = len;
                    currentPred = depId;
                }
            }

            pathLength.set(nodeId, currentMax + 1);
            predecessor.set(nodeId, currentPred);

            if (currentMax + 1 > maxLen) {
                maxLen = currentMax + 1;
                endNode = nodeId;
            }
        }

        const path: string[] = [];
        let curr = endNode;
        while (curr) {
            path.unshift(curr);
            curr = predecessor.get(curr) || '';
        }

        return path;
    }

    private generateValidationCommands(graph: TaskNode[], projectType: string): { task: string; command: string }[] {
        return graph
            .filter(t => t.validationCommand)
            .map(t => ({ task: t.id, command: t.validationCommand! }));
    }
}
