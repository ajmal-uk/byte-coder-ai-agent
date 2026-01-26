
/**
 * Complex Logic Test File
 * Contains nested structures to test FilePartSearcherAgent
 */

class DataProcessor {
    private config: any;

    constructor(config: any) {
        this.config = config;
        console.log("Initialized with", config);
    }

    /**
     * Validates user input
     * @param input string
     */
    public validate(input: string): boolean {
        // Simple check
        if (!input) return false;
        
        if (input.length < 5) {
            console.log("Input too short");
            return false;
        }

        // Nested function
        const checkChars = (str: string) => {
            return /^[a-zA-Z0-9]+$/.test(str);
        };

        return checkChars(input);
    }

    public async process(data: any) {
        try {
            if (this.validate(data.id)) {
                await this.save(data);
            }
        } catch (e) {
            this.logError(e);
        }
    }

    private logError(e: any) {
        console.error("Error occurred:", e);
        // TODO: Send to monitoring
    }

    private async save(data: any) {
        console.log("Saving data...");
        // Simulation
        return new Promise(resolve => setTimeout(resolve, 100));
    }

    public tricky() {
        const s = "{"; // Should not confuse the block finder
        const c = "}"; 
        /* { */ // Comment should not confuse
        return s + c;
    }
}

// Helper function outside class
function helper(x: number) {
    return x * 2;
}

export default DataProcessor;
