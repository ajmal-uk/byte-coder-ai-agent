# ByteAiCoder Architecture Refactoring Plan

## Goal
Transform ByteAiCoder into a top-tier coding agent capable of robust planning, execution, and self-correction, mimicking the capabilities of advanced agents like Trae.

## Core Philosophy: The "Think-Act-Verify" Loop
The current architecture is too linear (Manager -> Pipeline -> Result). The new architecture will be circular and state-driven:
1.  **Think**: Analyze intent, break down tasks, generate a dependency graph.
2.  **Act**: Execute tasks (create files, run commands) in dependency order (parallel where possible).
3.  **Verify**: actively check the result (linter, compiler, runtime).
4.  **Refine**: If verification fails, analyze the error and self-correct (Loop back to Act).

## Component Upgrades

### 1. AgentOrchestrator (The Controller)
- **Current**: Reactive, event-driven, linear parsing of XML.
- **New**: State Machine (`State: Planning | Executing | Verifying | Recovering`).
- **Feature**: `runLifecycle()` method that orchestrates the loop.
- **Context**: Maintains a rich `SessionContext` (created files, errors, command outputs).

### 2. TaskPlannerAgent (The Brain)
- **Current**: Heuristic-based (Regex/If-else) task detection. Fragile.
- **New**: Pure LLM-driven planning.
- **Output**: Strict JSON `ExecutionGraph`:
    ```json
    {
      "nodes": [
        { "id": "1", "type": "create_file", "path": "game.py", "description": "Main game loop" },
        { "id": "2", "type": "run_command", "command": "pip install pygame", "dependencies": [] },
        { "id": "3", "type": "run_command", "command": "python game.py", "dependencies": ["1", "2"] }
      ]
    }
    ```
- **Capability**: Recursive breakdown for complex tasks (e.g., "Make a game" -> "Setup env", "Create sprites", "Write logic").

### 3. PipelineEngine (The Workflow)
- **Current**: Linear execution of agent steps.
- **New**: Dynamic Execution Engine.
- **Feature**: `executeGraph(graph)`
    - Topological sort of tasks.
    - Parallel execution of independent nodes.
    - **Stop-on-Failure**: If a node fails, pause and trigger Recovery.

### 4. CodeGeneratorAgent (The Builder)
- **Current**: Generates code based on task description.
- **New**: Context-Aware Generation.
- **Feature**: explicit `imports` awareness. When generating `game.py`, it must know it depends on `sprites.py` (if created previously).

### 5. ExecutorAgent (The Doer)
- **Current**: Basic command execution.
- **New**: Interactive Terminal Manager.
- **Feature**: `runInteractive(command, validationRegex)`.
- **Capability**: Can read linter output and feed it back to the loop.

## Implementation Steps

1.  **Phase 1: Planning Overhaul**
    - Refactor `TaskPlannerAgent` to remove heuristics and use LLM for graph generation.
    - Define `ExecutionGraph` schema.

2.  **Phase 2: Orchestrator Logic**
    - Rewrite `AgentOrchestrator` to implement the `runLifecycle` loop.
    - Integrate `PersonaManager` for role-based planning.

3.  **Phase 3: Execution Engine**
    - Update `PipelineEngine` to handle the new `ExecutionGraph`.
    - Implement "Smart Parallelism".

4.  **Phase 4: Self-Correction**
    - Implement `ErrorAnalyzerAgent` (or enhance `QualityAssuranceAgent`) to parse errors and generate "Fix Tasks".

## Success Criteria
- User request: "Create a Python game"
- Agent:
    1.  Plans: `requirements.txt`, `main.py`, `player.py`.
    2.  Executes: Creates files.
    3.  Runs: `pip install -r requirements.txt`.
    4.  Verifies: Runs `python main.py`.
    5.  Fixes: If `ModuleNotFoundError`, installs missing package and retries.
