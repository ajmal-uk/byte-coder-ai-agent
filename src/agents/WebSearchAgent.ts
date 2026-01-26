
import { BaseAgent, AgentOutput } from '../core/AgentTypes';
import * as child_process from 'child_process';
import * as util from 'util';

const exec = util.promisify(child_process.exec);

export interface WebSearchInput {
    query: string;
    type?: 'general' | 'package' | 'code' | 'docs';
}

export interface WebSearchResult {
    source: string;
    content: string;
    url?: string;
    commandUsed?: string;
}

export class WebSearchAgent extends BaseAgent<WebSearchInput, WebSearchResult> {
    
    constructor() {
        super({ name: 'WebSearch', timeout: 45000 }); // Longer timeout for network
    }

    async execute(input: WebSearchInput): Promise<AgentOutput<WebSearchResult>> {
        const startTime = Date.now();
        const query = input.query;
        let result: WebSearchResult;

        try {
            // 1. Analyze query to determine best search strategy
            const strategy = this.determineStrategy(input);

            // 2. Execute search based on strategy
            switch (strategy) {
                case 'cheat.sh':
                    result = await this.searchCheatSh(query);
                    break;
                case 'npm':
                    result = await this.searchNpm(query);
                    break;
                case 'pip':
                    result = await this.searchPip(query);
                    break;
                case 'wikipedia':
                    result = await this.searchWikipedia(query);
                    break;
                case 'curl':
                default:
                    result = await this.searchGeneral(query);
                    break;
            }

            return this.createOutput('success', result, 0.85, startTime, {
                reasoning: `Executed web search via ${result.source} using command: ${result.commandUsed}`
            });

        } catch (error) {
            // Fallback to a helpful message if network/command fails
            return this.createOutput('failed', {
                source: 'error',
                content: `Failed to perform web search: ${(error as Error).message}. \nTip: Ensure you have internet access and standard tools (curl, npm) installed.`,
                commandUsed: 'unknown'
            }, 0, startTime);
        }
    }

    private determineStrategy(input: WebSearchInput): 'cheat.sh' | 'npm' | 'pip' | 'curl' | 'wikipedia' {
        const q = input.query.toLowerCase();
        
        // Clean query for analysis
        const cleanQ = q.replace(/search|web|for|find|look|up|check/g, '').trim();

        // Package managers
        if (q.includes('npm') || (input.type === 'package' && !q.includes('pip'))) return 'npm';
        if (q.includes('pip') || (input.type === 'package' && q.includes('python'))) return 'pip';

        // Code patterns / How-to (Best for cheat.sh)
    // Check for languages or frameworks
    const techTerms = [
        'how to', 'code', 'example', 'syntax', 'hook', 'api', 'function', 'method', 'class',
        'react', 'vue', 'angular', 'node', 'python', 'java', 'javascript', 'typescript',
        'cpp', 'c++', 'go', 'rust', 'ruby', 'php', 'sql', 'shell', 'bash', 'linux'
    ];
    
    // Knowledge questions
    if (q.startsWith('what is') || q.startsWith('who') || q.startsWith('define') || q.includes('history of') || q.includes('meaning of')) {
        return 'wikipedia';
    }

    if (techTerms.some(term => q.includes(term)) || input.type === 'code') {
        return 'cheat.sh';
    }

    return 'curl';
}

private async searchWikipedia(query: string): Promise<WebSearchResult> {
    const cleanQuery = query.replace(/what is|who is|define|history of|meaning of/g, '').trim();
    // 1. Search for page
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&format=json`;
    
    try {
        const { stdout } = await exec(`curl -sL "${searchUrl}"`);
        const data = JSON.parse(stdout);
        
        if (!data.query?.search?.length) {
            throw new Error('No Wikipedia results found');
        }
        
        const topResult = data.query.search[0];
        const pageId = topResult.pageid;
        
        // 2. Get content
        const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&pageids=${pageId}&format=json`;
        const { stdout: contentOut } = await exec(`curl -sL "${contentUrl}"`);
        const contentData = JSON.parse(contentOut);
        
        const page = contentData.query?.pages?.[pageId];
        if (!page) throw new Error('Failed to fetch page content');
        
        return {
            source: 'wikipedia',
            content: `Title: ${page.title}\n\n${page.extract}`,
            url: `https://en.wikipedia.org/?curid=${pageId}`,
            commandUsed: `curl "${searchUrl}"`
        };
        
    } catch (e) {
        // Fallback to simple search snippet if extract fails
        return {
            source: 'wikipedia (search)',
            content: `Search failed to get full article. ${(e as Error).message}`,
            commandUsed: 'curl wikipedia'
        };
    }
}

    private async searchCheatSh(query: string): Promise<WebSearchResult> {
        // Format query for cheat.sh: "python/read+file" or "javascript/reverse+array"
        // Heuristic: try to find language
        const languages = [
            'python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'go', 'rust', 'ruby', 'php', 
            'bash', 'shell', 'sql', 'html', 'css', 'lua', 'scala', 'swift', 'kotlin',
            'react', 'node', 'angular', 'vue', 'flutter', 'django', 'flask', 'spring'
        ];
        
        const words = query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        let language = words.find(w => languages.includes(w));
        
        // Remove language from query to get topic
        // Filter out common stop words
        const stopWords = ['how', 'to', 'in', 'get', 'code', 'for', 'example', 'show', 'me', 'search', 'web', 'find', 'make', 'create', 'usage', 'using', 'with'];
        let topicWords = words.filter(w => w !== language && !stopWords.includes(w));
        
        let topic = topicWords.join('+');
        
        if (!language) {
            // If no language found, try to guess from topic words or use global search
            // For cheat.sh, if we send "react+hook", it might work globally
            language = ''; 
        }

        // Construct URL: cheat.sh/language/topic
        // If language is empty, path is just topic (global search)
        // If topic is empty, path is language (language main page)
        const path = language ? (topic ? `${language}/${topic}` : language) : topic;
        
        if (!path) {
             return this.searchGeneral(query);
        }

        const command = `curl -sL "https://cheat.sh/${path}?T"`; // ?T removes ANSI colors

        try {
            const { stdout } = await exec(command);
            
            // Check for errors or empty output
            if (!stdout || stdout.includes('Unknown topic') || stdout.includes('Unknown cheat sheet') || stdout.includes('404 NOT FOUND') || stdout.includes('Internal Server Error') || stdout.length < 50) {
                // If specific search failed, try simpler search or general fallback
                if (language && topic) {
                    // Try just language
                    const simpleCommand = `curl -sL "https://cheat.sh/${language}?T"`;
                    const { stdout: simpleOut } = await exec(simpleCommand);
                    if (simpleOut && !simpleOut.includes('Internal Server Error') && !simpleOut.includes('Unknown topic')) {
                         return {
                            source: 'cheat.sh',
                            content: `Specific topic '${topic}' not found. Here is the general cheat sheet for ${language}:\n\n${simpleOut.slice(0, 3000)}`,
                            url: `https://cheat.sh/${language}`,
                            commandUsed: simpleCommand
                        };
                    }
                }
                
                // Fallback to general search
                return this.searchGeneral(query);
            }

            return {
                source: 'cheat.sh',
                content: stdout.slice(0, 3000), // Limit size
                url: `https://cheat.sh/${path}`,
                commandUsed: command
            };
        } catch (e) {
            throw new Error('Cheat.sh lookup failed');
        }
    }

    private async searchNpm(query: string): Promise<WebSearchResult> {
        // Extract package name
        const cleanQuery = query.replace(/npm|install|package|info|search|about/g, '').trim();
        const pkg = cleanQuery.split(' ')[0]; // Take first word as package name

        if (!pkg) throw new Error('No package name found');

        const command = `npm view ${pkg} name description keywords repository.url homepage --json`;
        
        try {
            const { stdout } = await exec(command);
            const data = JSON.parse(stdout);
            
            let content = `Package: ${data.name}\nDescription: ${data.description}\nKeywords: ${data.keywords?.join(', ')}\nRepo: ${data.repository?.url}\nHomepage: ${data.homepage}`;
            
            return {
                source: 'npm',
                content,
                url: `https://www.npmjs.com/package/${pkg}`,
                commandUsed: command
            };
        } catch (e) {
            // Fallback to search
            const searchCmd = `npm search ${pkg} --json --limit 3`;
            const { stdout } = await exec(searchCmd);
            return {
                source: 'npm search',
                content: `Search Results:\n${stdout}`,
                commandUsed: searchCmd
            };
        }
    }

    private async searchPip(query: string): Promise<WebSearchResult> {
        // Pip search is often disabled/deprecated, so we might skip or use PyPI API via curl
        // But let's try a simple curl to pypi json api
        const cleanQuery = query.replace(/pip|install|python|package|info|search/g, '').trim();
        const pkg = cleanQuery.split(' ')[0];

        const command = `curl -sL "https://pypi.org/pypi/${pkg}/json"`;

        try {
            const { stdout } = await exec(command);
            const data = JSON.parse(stdout);
            const info = data.info;
            
            let content = `Package: ${info.name}\nSummary: ${info.summary}\nHome: ${info.home_page}\nAuthor: ${info.author}`;
            
            return {
                source: 'pypi',
                content,
                url: info.package_url,
                commandUsed: command
            };
        } catch (e) {
            throw new Error('PyPI lookup failed');
        }
    }

    private async searchGeneral(query: string): Promise<WebSearchResult> {
        // 1. If query is a URL, fetch it
        if (/^https?:\/\//.test(query)) {
            try {
                // Use curl with a user agent to avoid blocking
                const command = `curl -sL -A "Mozilla/5.0" "${query}" | head -n 500`; 
                const { stdout } = await exec(command);
                
                // Simple HTML stripping (very basic)
                const textContent = stdout.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);

                return {
                    source: 'curl',
                    content: textContent || "No text content found",
                    url: query,
                    commandUsed: command
                };
            } catch (e) {
                return {
                    source: 'curl',
                    content: `Failed to fetch URL: ${(e as Error).message}`,
                    commandUsed: `curl ${query}`
                };
            }
        }

        // 2. Try ddgr (DuckDuckGo CLI) if installed
        try {
            const { stdout } = await exec('which ddgr');
            if (stdout) {
                const command = `ddgr --json --num 3 "${query}"`;
                const { stdout: searchOut } = await exec(command);
                return {
                    source: 'ddgr',
                    content: searchOut,
                    commandUsed: command
                };
            }
        } catch (e) {
            // Ignore
        }

        // 3. Fallback: Use cheat.sh global search (~query)
        // This is a good developer-focused fallback
        try {
            const cleanQuery = query.replace(/\s+/g, '+');
            const command = `curl -sL "https://cheat.sh/~${cleanQuery}?T"`;
            const { stdout } = await exec(command);
            
            if (stdout && !stdout.includes('Unknown topic') && !stdout.includes('Internal Server Error') && stdout.length > 50) {
                 return {
                    source: 'cheat.sh (search)',
                    content: stdout.slice(0, 3000),
                    url: `https://cheat.sh/~${cleanQuery}`,
                    commandUsed: command
                };
            }
        } catch (e) {
            // Ignore
        }

        // 4. Try Wikipedia search as a general knowledge fallback
        try {
             const wikiResult = await this.searchWikipedia(query);
             if (!wikiResult.content.includes('Search failed') && !wikiResult.content.includes('No Wikipedia results')) {
                 return wikiResult;
             }
        } catch (e) {
            // Ignore
        }

        // 5. Try NPM if it looks like a package name (single word)
        if (/^[a-z0-9-]+$/.test(query.trim()) && query.trim().length < 30) {
            try {
                // Only use if we find an exact package match
                const npmResult = await this.searchNpm(query);
                if (npmResult.source === 'npm') {
                    return npmResult;
                }
            } catch (e) {}
        }

        // 6. Final fallback
        return {
            source: 'system',
            content: `No terminal-based search tool found (ddgr) and cheat.sh search failed.\n\nSuggested actions:\n1. Install 'ddgr' (DuckDuckGo CLI) for full web search capabilities.\n2. Use specific keywords like 'npm <pkg>' or 'python <topic>'.\n\nCommand to open browser:\nopen "https://www.google.com/search?q=${encodeURIComponent(query)}"`,
            commandUsed: 'check_capabilities'
        };
    }
}
