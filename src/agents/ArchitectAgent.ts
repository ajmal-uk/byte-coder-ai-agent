
import { BaseAgent, AgentOutput } from '../core/AgentTypes';
import { ByteAIClient } from '../byteAIClient';
import { PersonaManager } from '../core/PersonaManager';

export interface ArchitectInput {
    query: string;
    projectType?: string;
    existingFiles?: string[];
}

export interface ArchitectureDesign {
    architecture: string;
    techStack: string[];
    fileStructure: string[];
    components: {
        name: string;
        description: string;
        responsibilities: string[];
    }[];
    dataModels: {
        name: string;
        fields: string[];
        relationships?: string[];
    }[];
    apiEndpoints?: {
        method: string;
        path: string;
        description: string;
    }[];
    designPatterns: string[];
}

export class ArchitectAgent extends BaseAgent<ArchitectInput, ArchitectureDesign> {
    private client: ByteAIClient;
    private personaManager: PersonaManager;

    constructor() {
        super({ name: 'Architect', timeout: 45000 });
        this.client = new ByteAIClient();
        this.personaManager = new PersonaManager();
    }

    async execute(input: ArchitectInput): Promise<AgentOutput<ArchitectureDesign>> {
        const startTime = Date.now();
        
        const persona = this.personaManager.getPersona('SystemArchitect');
        
        const prompt = `
${persona.systemPrompt}

User Request: "${input.query}"
Project Type: ${input.projectType || 'Generic'}
Existing Files: ${(input.existingFiles || []).join(', ')}

Design a software architecture for this request.
1. Choose the best architecture pattern (e.g., MVC, Layered, Component-Based, Microservices).
2. Define the file structure (new files to create).
3. Identify key components and their responsibilities.
4. Define core Data Models (entities, schemas) with fields and relationships.
5. Define key API Endpoints (if applicable) with methods and paths.
6. Recommend design patterns.

Output ONLY a JSON object with this structure:
{
  "architecture": "Name of architecture",
  "techStack": ["List", "of", "technologies"],
  "fileStructure": ["path/to/file1.ts", "path/to/file2.ts"],
  "components": [
    { "name": "Component Name", "description": "What it does", "responsibilities": ["Task 1", "Task 2"] }
  ],
  "dataModels": [
    { "name": "User", "fields": ["id: string", "email: string"], "relationships": ["HasMany Orders"] }
  ],
  "apiEndpoints": [
    { "method": "GET", "path": "/api/users", "description": "List users" }
  ],
  "designPatterns": ["Pattern 1", "Pattern 2"]
}
`;

        try {
            const response = await this.client.generateResponse(prompt);
            const design = this.parseResponse(response);

            return this.createOutput('success', design, 1.0, startTime, {
                reasoning: `Generated ${design.architecture} architecture with ${design.fileStructure.length} files based on deep analysis.`
            });
        } catch (error) {
            console.error("Architect Agent failed:", error);
            // Fallback to basic design if LLM fails
            const design = this.getGenericDesign();
            return this.createOutput('partial', design, 0.5, startTime, {
                reasoning: "LLM failed, reverted to generic design."
            });
        }
    }

    private parseResponse(response: string): ArchitectureDesign {
        try {
            // Extract JSON from potential markdown blocks
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : response;
            return JSON.parse(jsonStr);
        } catch (e) {
            throw new Error("Failed to parse Architect JSON response");
        }
    }

    private getGenericDesign(): ArchitectureDesign {
        return {
            architecture: "Modular Monolith",
            techStack: ["TypeScript", "Node.js"],
            fileStructure: ["src/index.ts", "src/utils.ts"],
            components: [{ name: "Core", description: "Main logic", responsibilities: ["Processing"] }],
            dataModels: [],
            designPatterns: ["Module Pattern"]
        };
    }
}
