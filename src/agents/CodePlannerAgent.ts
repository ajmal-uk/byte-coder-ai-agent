/**
 * CodePlannerAgent - Low-level implementation designer
 * Generates file structures, interfaces, and API specifications
 */

import * as vscode from 'vscode';
import { BaseAgent, AgentOutput, CodePlan } from '../core/AgentTypes';
import { AnalyzedContext } from './ContextAnalyzer';
import { ByteAIClient } from '../byteAIClient';
import { ArchitectureDesign } from './ArchitectAgent';

export interface CodePlannerInput {
    query: string;
    projectType: string;
    existingFiles?: string[];
    contextAnalysis?: AnalyzedContext; // Added for context integration
    contextKnowledge?: any[]; // Knowledge base results
    techStack?: {
        frontend?: string;
        backend?: string;
        database?: string;
    };
    features?: string[];
    architecture?: ArchitectureDesign;
}

export interface CodePlannerResult extends CodePlan {
    dependencies: string[];
    devDependencies: string[];
    configFiles: { name: string; purpose: string }[];
    folderPurposes: { folder: string; purpose: string }[];
    fileSpecs?: { filePath: string; spec: string }[];
    techStack?: {
        frontend?: string;
        backend?: string;
        database?: string;
    };
}

export class CodePlannerAgent extends BaseAgent<CodePlannerInput, CodePlannerResult> {
    private client: ByteAIClient;

    // Common folder structures by project type
    private readonly FOLDER_TEMPLATES: Record<string, string[]> = {
        'web': [
            'src/',
            'src/components/',
            'src/components/ui/',
            'src/pages/',
            'src/hooks/',
            'src/utils/',
            'src/styles/',
            'src/types/',
            'public/',
            'public/images/'
        ],
        'api': [
            'src/',
            'src/routes/',
            'src/controllers/',
            'src/services/',
            'src/models/',
            'src/middleware/',
            'src/utils/',
            'src/types/',
            'src/config/',
            'tests/'
        ],
        'fullstack': [
            'src/',
            'src/app/',
            'src/components/',
            'src/components/ui/',
            'src/lib/',
            'src/hooks/',
            'src/types/',
            'src/styles/',
            'prisma/',
            'public/'
        ]
    };

    constructor() {
        super({ name: 'CodePlanner', timeout: 10000 });
        this.client = new ByteAIClient();
    }

    async execute(input: CodePlannerInput): Promise<AgentOutput<CodePlannerResult>> {
        const startTime = Date.now();

        try {
            // Generate file structure
            const fileStructure = this.generateFileStructure(input);

            // Generate interfaces
            const interfaces = await this.generateInterfaces(input);

            // Generate API endpoints (if applicable)
            const apiEndpoints = await this.generateApiEndpoints(input);

            // Generate state flows (if applicable)
            const stateFlows = this.generateStateFlows(input);

            // Determine dependencies
            const { dependencies, devDependencies } = this.determineDependencies(input);

            // Generate config files list
            const configFiles = this.determineConfigFiles(input);

            // Generate folder purposes
            const folderPurposes = this.generateFolderPurposes(input.projectType);

            // Generate detailed file specifications (NEW)
            const fileSpecs = await this.generateFileSpecs(input, fileStructure, interfaces);

            const result: CodePlannerResult = {
                fileStructure,
                interfaces,
                apiEndpoints,
                stateFlows,
                dependencies,
                devDependencies,
                configFiles,
                folderPurposes,
                fileSpecs
            };

            const keyFiles = fileStructure.slice(0, 3).map(f => `\`${f}\``).join(', ');
            const remainingCount = Math.max(0, fileStructure.length - 3);
            const fileSummary = remainingCount > 0 ? `${keyFiles} and ${remainingCount} others` : keyFiles;

            return this.createOutput('success', result, 0.85, startTime, {
                reasoning: `Generated ${fileStructure.length} files/folders including ${fileSummary}. Defined ${interfaces.length} interfaces.`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Generate detailed specifications for key files
     */
    private async generateFileSpecs(input: CodePlannerInput, files: string[], interfaces: string[]): Promise<{ filePath: string; spec: string }[]> {
        if (files.length === 0) return [];
        
        // Only generate specs for the most important files to save tokens/time
        // Filter out config files, simple indexes, etc.
        const importantFiles = files.filter(f => 
            !f.endsWith('.json') && 
            !f.endsWith('.d.ts') && 
            !f.includes('test') &&
            (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.py'))
        ).slice(0, 10); // Limit to top 10 files

        if (importantFiles.length === 0) return [];

        const prompt = `
You are a Lead Software Engineer.
User Request: "${input.query}"
Proposed Files: ${importantFiles.join(', ')}
Key Interfaces: ${interfaces.slice(0, 5).join('\n')}

For each file, write a concise "Specification".
The spec should include:
1. **Exports**: What functions/classes it exports.
2. **Key Logic**: Brief pseudo-code or description of complex algorithms.
3. **Dependencies**: What other files/libraries it likely needs.

Output ONLY a JSON array of objects:
[
  { "filePath": "path/to/file.ts", "spec": "Exports User class with save() method. Uses mongoose model..." }
]
`;
        try {
            const response = await this.client.generateResponse(prompt);
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('Spec generation failed', e);
        }
        return [];
    }

    /**
     * Generate file structure based on project type and features
     */
    private generateFileStructure(input: CodePlannerInput): string[] {
        const structure: string[] = [];

        // 1. Use Architect's structure if available
        if (input.architecture?.fileStructure) {
            structure.push(...input.architecture.fileStructure);
        } else {
            // Fallback to templates
            const baseStructure = this.FOLDER_TEMPLATES[input.projectType] || this.FOLDER_TEMPLATES['web'];
            structure.push(...baseStructure);
        }

        // Add base folders if using templates or if architect didn't provide them
        if (!input.architecture) {
             // Add feature-specific files
            const lowerQuery = input.query.toLowerCase();
            const features = input.features || this.extractFeatures(lowerQuery);

            for (const feature of features) {
                structure.push(...this.getFeatureFiles(feature, input.projectType));
            }

            // Add entry point files
            if (input.projectType === 'web' || input.projectType === 'fullstack') {
                structure.push('src/App.tsx');
                structure.push('src/main.tsx');
                structure.push('src/index.css');
            } else if (input.projectType === 'api') {
                structure.push('src/index.ts');
                structure.push('src/app.ts');
            }
        }

        // Filter existing files if provided
        if (input.existingFiles && input.existingFiles.length > 0) {
            return structure.filter(f => !input.existingFiles!.some(e => e.includes(f.replace('/', ''))));
        }

        return [...new Set(structure)].sort();
    }

    /**
     * Extract features from query and knowledge
     */
    private extractFeatures(query: string, knowledge?: any[]): string[] {
        const features: string[] = [];
        const featureKeywords: Record<string, string> = {
            'auth': 'authentication',
            'login': 'authentication',
            'cart': 'cart',
            'checkout': 'checkout',
            'product': 'products',
            'user': 'users',
            'profile': 'profile',
            'dashboard': 'dashboard',
            'admin': 'admin',
            'settings': 'settings',
            'notification': 'notifications',
            'chat': 'chat',
            'payment': 'payments',
            'search': 'search'
        };

        for (const [keyword, feature] of Object.entries(featureKeywords)) {
            if (query.includes(keyword)) {
                features.push(feature);
            }
        }

        // Extract from knowledge base if available
        if (knowledge && knowledge.length > 0) {
            knowledge.forEach(k => {
                const summary = k.summary.toLowerCase();
                if (summary.includes('product') || summary.includes('item')) features.push('products');
                if (summary.includes('service')) features.push('services');
                if (summary.includes('blog') || summary.includes('article')) features.push('blog');
                if (summary.includes('contact')) features.push('contact');
                if (summary.includes('about') || summary.includes('mission')) features.push('about');
                if (summary.includes('dashboard') || summary.includes('admin')) features.push('dashboard');
            });
        }

        return [...new Set(features)];
    }

    /**
     * Get files for a specific feature
     */
    private getFeatureFiles(feature: string, projectType: string): string[] {
        const files: string[] = [];
        const capitalFeature = feature.charAt(0).toUpperCase() + feature.slice(1);

        if (projectType === 'web' || projectType === 'fullstack') {
            files.push(`src/components/${capitalFeature}/`);
            files.push(`src/components/${capitalFeature}/${capitalFeature}Container.tsx`);
            files.push(`src/hooks/use${capitalFeature}.ts`);
        }

        if (projectType === 'api' || projectType === 'fullstack') {
            files.push(`src/routes/${feature}.routes.ts`);
            files.push(`src/controllers/${feature}.controller.ts`);
            files.push(`src/services/${feature}.service.ts`);
            files.push(`src/models/${feature}.model.ts`);
        }

        return files;
    }

    /**
     * Generate TypeScript interfaces using LLM with fallback
     */
    private async generateInterfaces(input: CodePlannerInput): Promise<string[]> {
        // 1. Use Architect's data models if available
        if (input.architecture?.dataModels) {
            return input.architecture.dataModels.map(model => {
                const fields = model.fields.join('; ');
                return `interface ${model.name} { ${fields} }`;
            });
        }

        const features = input.features || this.extractFeatures(input.query.toLowerCase(), input.contextKnowledge);
        
        // 1. Try LLM Generation
        try {
            const prompt = `
You are a Senior TypeScript Architect.
Generate a list of TypeScript interfaces for a project with these features: ${features.join(', ')}
Query: "${input.query}"
Project Type: ${input.projectType}

Requirements:
1. Include core data models.
2. Include API response types.
3. Use strict typing (no any).
4. Output ONLY a JSON array of strings, where each string is a full interface definition.

Example Output:
[
  "interface User { id: string; name: string; }",
  "interface AuthResponse { token: string; user: User; }"
]
`;
            const response = await this.client.generateResponse(prompt);
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed) && parsed.every(i => typeof i === 'string')) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('LLM Interface generation failed, falling back to heuristics');
        }

        // 2. Fallback to Heuristics
        const interfaces: string[] = [];

        // Common base interfaces
        interfaces.push('interface ApiResponse<T> { success: boolean; data?: T; error?: string }');
        interfaces.push('interface PaginatedResponse<T> extends ApiResponse<T[]> { total: number; page: number; pageSize: number }');

        // Feature-specific interfaces
        if (features.includes('authentication') || features.includes('users')) {
            interfaces.push('interface User { id: string; email: string; name: string; createdAt: Date }');
            interfaces.push('interface AuthCredentials { email: string; password: string }');
            interfaces.push('interface AuthContext { user: User | null; login: (creds: AuthCredentials) => Promise<void>; logout: () => void }');
        }

        if (features.includes('products')) {
            interfaces.push('interface Product { id: string; name: string; price: number; description: string; imageUrl: string; stock: number }');
        }

        if (features.includes('cart')) {
            interfaces.push('interface CartItem { productId: string; quantity: number; price: number }');
            interfaces.push('interface Cart { items: CartItem[]; total: number }');
        }

        if (features.includes('payments')) {
            interfaces.push('interface PaymentIntent { id: string; amount: number; currency: string; status: string }');
        }

        return interfaces;
    }

    /**
     * Generate API endpoints using LLM with fallback
     */
    private async generateApiEndpoints(input: CodePlannerInput): Promise<{ method: string; path: string; description: string }[] | undefined> {
        // 1. Use Architect's endpoints if available
        if (input.architecture?.apiEndpoints) {
            return input.architecture.apiEndpoints;
        }

        if (input.projectType === 'web') return undefined;

        const features = input.features || this.extractFeatures(input.query.toLowerCase());

        // 1. Try LLM Generation
        try {
            const prompt = `
You are a Senior API Designer.
Define REST API endpoints for: ${features.join(', ')}
Query: "${input.query}"

Requirements:
1. Follow RESTful conventions.
2. Cover CRUD operations where appropriate.
3. Output ONLY a JSON array of objects.

Format:
[
  { "method": "GET", "path": "/api/resource", "description": "List resources" }
]
`;
            const response = await this.client.generateResponse(prompt);
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('LLM API generation failed, falling back to heuristics');
        }

        // 2. Fallback to Heuristics
        const endpoints: { method: string; path: string; description: string }[] = [];
        
        if (features.includes('authentication') || features.includes('users')) {
            endpoints.push(
                { method: 'POST', path: '/api/auth/register', description: 'User registration' },
                { method: 'POST', path: '/api/auth/login', description: 'User login' },
                { method: 'POST', path: '/api/auth/logout', description: 'User logout' },
                { method: 'GET', path: '/api/auth/me', description: 'Get current user' },
                { method: 'PUT', path: '/api/users/:id', description: 'Update user profile' }
            );
        }

        if (features.includes('products')) {
            endpoints.push(
                { method: 'GET', path: '/api/products', description: 'List all products' },
                { method: 'GET', path: '/api/products/:id', description: 'Get product by ID' },
                { method: 'POST', path: '/api/products', description: 'Create product' },
                { method: 'PUT', path: '/api/products/:id', description: 'Update product' },
                { method: 'DELETE', path: '/api/products/:id', description: 'Delete product' }
            );
        }

        if (features.includes('cart')) {
            endpoints.push(
                { method: 'GET', path: '/api/cart', description: 'Get cart' },
                { method: 'POST', path: '/api/cart/items', description: 'Add item to cart' },
                { method: 'PUT', path: '/api/cart/items/:id', description: 'Update cart item' },
                { method: 'DELETE', path: '/api/cart/items/:id', description: 'Remove from cart' }
            );
        }

        return endpoints.length > 0 ? endpoints : undefined;
    }

    /**
     * Generate state flow descriptions
     */
    private generateStateFlows(input: CodePlannerInput): string[] | undefined {
        if (input.projectType === 'api') return undefined;

        const flows: string[] = [];
        const features = input.features || this.extractFeatures(input.query.toLowerCase());

        if (features.includes('authentication')) {
            flows.push('Auth Flow: Login → Validate → Store Token → Redirect to Dashboard');
            flows.push('Session: Check Token → Refresh if Expired → Logout if Invalid');
        }

        if (features.includes('cart')) {
            flows.push('Cart Flow: Add Item → Update Count → Calculate Total → Persist');
        }

        if (features.includes('checkout')) {
            flows.push('Checkout: Validate Cart → Enter Address → Select Payment → Confirm → Process');
        }

        return flows;
    }

    /**
     * Determine project dependencies
     */
    private determineDependencies(input: CodePlannerInput): { dependencies: string[]; devDependencies: string[] } {
        const deps: string[] = [];
        const devDeps: string[] = [];
        const type = input.projectType;
        const stack = input.techStack;

        // Base dependencies by type
        if (type === 'web') {
            deps.push('react', 'react-dom', 'react-router-dom');
            devDeps.push('typescript', '@types/react', '@types/react-dom', 'vite', '@vitejs/plugin-react');
        } else if (type === 'api') {
            deps.push('express', 'cors', 'dotenv');
            devDeps.push('typescript', '@types/node', '@types/express', 'ts-node', 'nodemon');
        } else if (type === 'fullstack') {
            deps.push('next', 'react', 'react-dom');
            devDeps.push('typescript', '@types/node', '@types/react', '@types/react-dom');
        }

        // Stack-specific deps
        if (stack?.database?.includes('Prisma')) {
            deps.push('@prisma/client');
            devDeps.push('prisma');
        }

        if (stack?.frontend?.includes('Tailwind')) {
            deps.push('tailwindcss');
            devDeps.push('postcss', 'autoprefixer');
        }

        // Feature deps
        const features = input.features || this.extractFeatures(input.query.toLowerCase());

        if (features.includes('authentication')) {
            deps.push('jsonwebtoken', 'bcryptjs');
            devDeps.push('@types/jsonwebtoken', '@types/bcryptjs');
        }

        if (features.includes('payments')) {
            deps.push('stripe');
        }

        return { dependencies: deps, devDependencies: devDeps };
    }

    /**
     * Determine required config files
     */
    private determineConfigFiles(input: CodePlannerInput): { name: string; purpose: string }[] {
        const configs: { name: string; purpose: string }[] = [
            { name: 'package.json', purpose: 'Project dependencies and scripts' },
            { name: 'tsconfig.json', purpose: 'TypeScript configuration' },
            { name: '.gitignore', purpose: 'Git ignore patterns' },
            { name: '.env.example', purpose: 'Environment variable template' }
        ];

        if (input.projectType === 'web') {
            configs.push({ name: 'vite.config.ts', purpose: 'Vite bundler configuration' });
        }

        if (input.projectType === 'fullstack') {
            configs.push({ name: 'next.config.js', purpose: 'Next.js configuration' });
        }

        if (input.techStack?.frontend?.includes('Tailwind')) {
            configs.push({ name: 'tailwind.config.js', purpose: 'Tailwind CSS configuration' });
            configs.push({ name: 'postcss.config.js', purpose: 'PostCSS configuration' });
        }

        if (input.techStack?.database?.includes('Prisma')) {
            configs.push({ name: 'prisma/schema.prisma', purpose: 'Database schema' });
        }

        return configs;
    }

    /**
     * Generate folder purpose descriptions
     */
    private generateFolderPurposes(projectType: string): { folder: string; purpose: string }[] {
        const purposes: Record<string, { folder: string; purpose: string }[]> = {
            'web': [
                { folder: 'src/components', purpose: 'Reusable React components' },
                { folder: 'src/components/ui', purpose: 'Base UI primitives (Button, Card, etc.)' },
                { folder: 'src/pages', purpose: 'Page-level components / routes' },
                { folder: 'src/hooks', purpose: 'Custom React hooks' },
                { folder: 'src/utils', purpose: 'Utility functions' },
                { folder: 'src/types', purpose: 'TypeScript type definitions' },
                { folder: 'public', purpose: 'Static assets' }
            ],
            'api': [
                { folder: 'src/routes', purpose: 'Express route definitions' },
                { folder: 'src/controllers', purpose: 'Request handlers' },
                { folder: 'src/services', purpose: 'Business logic' },
                { folder: 'src/models', purpose: 'Data models / ORM entities' },
                { folder: 'src/middleware', purpose: 'Express middleware' },
                { folder: 'tests', purpose: 'Test files' }
            ],
            'fullstack': [
                { folder: 'src/app', purpose: 'Next.js App Router pages' },
                { folder: 'src/components', purpose: 'React components' },
                { folder: 'src/lib', purpose: 'Shared utilities and server actions' },
                { folder: 'prisma', purpose: 'Database schema and migrations' }
            ]
        };

        return purposes[projectType] || purposes['web'];
    }
}
